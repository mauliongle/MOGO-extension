// Page sizes per platform
const APOLLO_PAGE_SIZE   = 30;  // Apollo shows 30 results per page
const SALESNAV_PAGE_SIZE = 25;  // Sales Navigator shows 25 results per page


const MOGO_API = 'http://localhost:7823';

const state = {
  storage: { currentPage: null, maxPages: null },
  csvTitles: [
    'linkedin_url','full_name','first_name','last_name','email','email_status','job_title',
    'company','company_website','city','state','country','industry','keywords',
    'employees','company_city','company_state','company_country',
    'company_linkedin_url','company_twitter_url','company_facebook_url',
    'twitter_url','facebook_url'
  ],
  statusCounts: { verified: 0, catchAll: 0, unknown: 0, invalid: 0 },
  exportButtonChecker: null,
  maxesSetFromPage: null,
  collectPeopleFailTimer: null,
  eventDuplicationsTimer: null,
  peopleList: [],
  emailList: []
};
state.peopleList = [state.csvTitles];

// Virtual anchor used as event bus
const eventBus = document.createElement('a');
let isExporting = false;

// ─── Listen for popup trigger ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.msg === 'showExportModal') {
      openExportModal();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, reason: 'unknown_message' });
    }
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
  return true; // Keep channel open
});

// ─── Local Email Finder (fallback if API offline) ────────────────────────────
function generateEmailPatterns(firstName, lastName, domain) {
  if (!firstName || !domain) return [];
  firstName = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  lastName  = (lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const d = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  if (!d || d.length < 3) return [];
  const patterns = [];
  if (firstName && lastName) {
    patterns.push(`${firstName}.${lastName}@${d}`);
    patterns.push(`${firstName}${lastName}@${d}`);
    patterns.push(`${firstName[0]}${lastName}@${d}`);
    patterns.push(`${firstName}${lastName[0]}@${d}`);
    patterns.push(`${firstName}_${lastName}@${d}`);
    patterns.push(`${firstName}@${d}`);
  } else {
    patterns.push(`${firstName}@${d}`);
  }
  return patterns;
}

// ─── Map verify reason → CSV status label ───────────────────────────────────
function reasonToStatus(reason, valid) {
  if (!reason) return 'Unknown';
  if (reason === 'smtp_verified') return 'Verified';
  if (reason.includes('catch_all') || reason === 'free_provider') return 'Catch-All';
  if (!valid || reason === 'smtp_rejected' || reason === 'domain_not_found' || reason === 'no_mx_records') return 'Invalid';
  return 'Unknown';
}

// Update live status counters in the modal UI
function updateStatusCounts() {
  const { verified, catchAll, unknown, invalid } = state.statusCounts;
  const el = id => document.getElementById(id);
  if (el('cnt-verified'))  el('cnt-verified').textContent  = verified;
  if (el('cnt-catchall'))  el('cnt-catchall').textContent  = catchAll;
  if (el('cnt-unknown'))   el('cnt-unknown').textContent   = unknown;
  if (el('cnt-invalid'))   el('cnt-invalid').textContent   = invalid;
}

// ─── API: Find Email ──────────────────────────────────────────────────────────
async function apiFindEmail(firstName, lastName, domain) {
  try {
    const res = await fetch(`${MOGO_API}/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, domain }),
      signal: (function() { var c = new AbortController(); setTimeout(function() { c.abort(); }, 8000); return c.signal; })()
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return data.email || data.emails?.[0] || null;
  } catch {
    // Fallback to local pattern generation
    const patterns = generateEmailPatterns(firstName, lastName, domain);
    return patterns[0] || null;
  }
}

// ─── API: Verify Email (returns full result) ─────────────────────────────────
async function apiVerifyEmail(email) {
  try {
    const res = await fetch(`${MOGO_API}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: (function() { var c = new AbortController(); setTimeout(function() { c.abort(); }, 15000); return c.signal; })()
    });
    if (!res.ok) throw new Error('API error');
    return await res.json(); // { valid, reason, catchAll, confidence }
  } catch {
    return { valid: true, reason: 'unknown', catchAll: false };
  }
}

// ─── Utility: Clean company name ──────────────────────────────────────────────
function cleanCompany(name) {
  if (!name) return '';
  return name
    .split('- ')[0]
    .replace(/ *\([^)]*\) */g, '')
    .replace(/, Inc\.|, LLC|, Ltd|, LTD|, INC\.| Inc\.| Inc| LLC| Ltd| LTD| GmbH| INC\./g, '')
    .replace(/<\/?b>/g, '')
    .replace(/&lt;b&gt;|&lt;\/b&gt;/g, '')
    .replace(/,/g, '')
    .trim();
}

// ─── Utility: Clean text for CSV ─────────────────────────────────────────────
function csvSafe(val) {
  if (val == null) return '';
  return '"' + String(val).replace(/"/g, "'") + '"';
}

// ─── Utility: Strip emoji/symbols ────────────────────────────────────────────
function cleanText(str = '') {
  return str
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{S}/gu, '')
    .replace(/,/g, ' |')
    .trim();
}

// ─── DOM: Wait for element ────────────────────────────────────────────────────
function waitFor(selector, root, timeout = 10000) {
  root = root || document;
  if (root.querySelector(selector)) return Promise.resolve(root.querySelector(selector));
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
    const obs = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { clearTimeout(to); obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

function q(selector, root) { return (root || document).querySelector(selector); }

// ─── Load HTML component ──────────────────────────────────────────────────────
function loadHTML(path, container, replace = false) {
  return fetch(chrome.runtime.getURL(path))
    .then(r => r.text())
    .then(html => {
      if (replace) container.innerHTML = '';
      container.appendChild(document.createRange().createContextualFragment(html));
    });
}

// ─── Pagination helper ────────────────────────────────────────────────────────
function getPaginationEl() {
  let el = q('.zp-button-group');
  if (!el) {
    try {
      el = document.evaluate(
        '//div[not(contains(@class,"input-container"))]/div/div[contains(@class,"Select") and contains(@class,"has-value")]',
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue?.parentElement?.parentElement;
    } catch {}
  }
  if (!el) el = q('div[aria-label="Current page"][role="combobox"]');
  return el;
}

// ─── Reset export state ───────────────────────────────────────────────────────
function resetExport() {
  const inp = q('.findy--innput-people-export');
  if (inp) { inp.max = 0; inp.value = ''; inp.placeholder = 'e.g. 150'; }
  chrome.storage.sync.set({
    export_status: 'waiting', peopleToExport: 0, exportOption: true,
    apollo_duplicates: false, apollo_tab: 'not_net_new', autoSelectContactList: null
  });
  const maxEl = q('.findy--max-people');
  if (maxEl) maxEl.innerText = 0;
  const credEl = q('#findyCreditsUsed');
  if (credEl) credEl.innerHTML = '✅ No login required — export is free';
  state.peopleList = [state.csvTitles];
  state.emailList = [];
  state.statusCounts = { verified: 0, catchAll: 0, unknown: 0, invalid: 0 };
}

// ─── Update credits label ─────────────────────────────────────────────────────
function updateCreditsLabel() {
  const credEl = q('#findyCreditsUsed');
  const inp = q('.findy--innput-people-export');
  if (!credEl || !inp) return;
  credEl.innerHTML = `Will export up to <strong>${inp.value}</strong> contacts — no credits needed`;
}

// ─── Open Export Modal ────────────────────────────────────────────────────────
function openExportModal() {
  // Remove existing modal
  q('.findy--modal-wrapper')?.remove();

  loadHTML('components/modal.html', document.body).then(() =>
    loadHTML('pages/export-modal.html', q('.findy--modal'), true).then(() => {
      // Load status panels
      loadHTML('components/export-status.html', q('.findy--laptop-loading-container'))
        .then(() => setStatusIcon(q('.findy--export-inprogress'), 'loading'));
      loadHTML('components/export-status.html', q('.findy--laptop-success-container'))
        .then(() => setStatusIcon(q('.findy--export-success'), 'success'));
      loadHTML('components/export-status.html', q('.findy--laptop-error-container'))
        .then(() => setStatusIcon(q('.findy--export-error'), 'error'));

      // Wire up buttons
      document.querySelectorAll('.findy--button-save-export').forEach(b => { b.onclick = () => finishExport(); });
      q('.findy--button-continue').onclick = () => startCollection();
      document.querySelectorAll('.findy--button-cancel').forEach(b => {
        b.onclick = e => {
          e.preventDefault();
          resetExport();
          q('.findy--modal-wrapper')?.classList.remove('findy--modal-shown');
        };
      });

      // Simple free-form input — user types exactly how many they want
      const inp = q('.findy--innput-people-export');
      inp.onkeyup = inp.onchange = function() {
        chrome.storage.sync.set({ peopleToExport: parseInt(this.value) || 0 });
        updateCreditsLabel();
      };

      // Show page size info
      const pageNote = q('#mogo-page-size-note');
      if (pageNote) pageNote.textContent = `${APOLLO_PAGE_SIZE} per page (Apollo)`;

      // Credits label
      const credEl = q('#findyCreditsUsed');
      if (credEl) credEl.innerHTML = '✅ No login required — export is free';

      // Hide the "Use Finder" option toggle (was Findymail-specific)
      const optBox = q('#findyOptionBox');
      if (optBox) {
        optBox.checked = false;
        optBox.parentElement?.style && (optBox.parentElement.style.display = 'none');
      }
      const optLabel = q('#findyOptionLabel');
      if (optLabel) optLabel.style.display = 'none';

      // Populate local lists (no remote API)
      chrome.storage.local.get(['mogo_lists'], ({ mogo_lists }) => {
        const lists = mogo_lists || [{ id: 0, name: 'All contacts', contacts: [] }];
        const sel = q('#findyListSelect');
        if (sel) {
          lists.forEach(list => {
            const opt = document.createElement('option');
            opt.value = list.id; opt.textContent = list.name;
            sel.appendChild(opt);
          });
        }
      });

      // Create list button
      const createBtn = q('#createListBtn');
      if (createBtn) {
        createBtn.onclick = () => {
          loadHTML('/components/create-list.html', q('.findy--modal'), true).then(() => {
            q('#cancelBtn').onclick = () => openExportModal();
            q('#createListBtn').onclick = () => {
              const name = q('#listnameInput')?.value;
              if (!name) return;
              chrome.storage.local.get(['mogo_lists'], ({ mogo_lists }) => {
                const lists = mogo_lists || [];
                const newList = { id: Date.now(), name, contacts: [] };
                lists.push(newList);
                chrome.storage.local.set({ mogo_lists: lists }, () => {
                  chrome.storage.sync.set({ autoSelectContactList: newList.id });
                  openExportModal();
                });
              });
            };
          });
        };
      }

      // Submit form handler
      q('.findy--export-form').onsubmit = e => { e.preventDefault(); startCollection(); };

      // Show modal
      resetExport();
      q('.findy--modal-wrapper')?.classList.add('findy--modal-shown');
      initPagination();
    })
  );
}

// ─── Set status icon ──────────────────────────────────────────────────────────
function setStatusIcon(panel, type) {
  if (!panel) return;
  const img = panel.querySelector('.findy--laptop-image');
  const loader = panel.querySelector('.findy--component-laptop-loader');
  switch (type) {
    case 'loading':
      if (img) img.src = chrome.runtime.getURL('images/dashboard.png');
      if (loader) loader.style.display = 'block';
      break;
    case 'success':
      if (img) img.src = chrome.runtime.getURL('images/success.svg');
      if (loader) loader.style.display = 'none';
      break;
    case 'error':
      if (img) img.src = chrome.runtime.getURL('images/error.svg');
      if (loader) loader.style.display = 'none';
      break;
  }
}

// ─── Init pagination info ─────────────────────────────────────────────────────
function initPagination() {
  const table = q('table') || q('div[data-shell-view="non-groupby-table"]');
  const pag = getPaginationEl();
  if (!table) return;

  if (pag) {
    readPaginationInfo();
  } else {
    const obs = new MutationObserver(() => {
      if (getPaginationEl()) { obs.disconnect(); readPaginationInfo(); }
    });
    obs.observe(table, { childList: true, subtree: true });
  }
}

function readPaginationInfo() {
  const pag = getPaginationEl();
  if (!pag) return;

  let pageText = pag.querySelector('div:not(.is-searchable) > div.Select-control .zp-select-main')?.textContent?.trim() || '';
  let totalText = pag.parentElement?.firstChild?.textContent || '';
  if (!totalText.includes('of')) totalText = pag.parentElement?.lastChild?.textContent || '';

  let total = 0;
  try {
    total = Math.min(2500, parseInt(
      totalText.split('of')[1]
        .replace(/,/g, '').replace(/\./g, '')
        .replace('K', '00').replace('M', '000').trim()
    ));
  } catch {}

  if (total > 0) {
    state.storage.currentPage = pageText;
    state.storage.maxPages = total / 25;
    const inp = q('.findy--innput-people-export');
    const maxEl = q('.findy--max-people');
    if (inp) { inp.max = total; inp.value = total; }
    if (maxEl) maxEl.innerText = total;
    chrome.storage.sync.set({ peopleToExport: total });
    updateCreditsLabel();
  }
}

// ─── Flip to next page ────────────────────────────────────────────────────────
function flipPage() {
  clearTimeout(state.collectPeopleFailTimer);
  isExporting = false;
  const pag = getPaginationEl();
  if (!pag) return;
  let nextBtn = [...pag.querySelectorAll('.zp-button')][1] ||
                [...pag.parentElement.querySelectorAll('button')][1];
  if (!nextBtn) return;
  if (!nextBtn.disabled) {
    nextBtn.click();
  } else {
    // Check if net new tab has a previous button
    chrome.storage.sync.get(['apollo_tab'], ({ apollo_tab }) => {
      if (apollo_tab === 'net_new') {
        const prevBtn = [...pag.querySelectorAll('.zp-button')][0];
        if (prevBtn && !prevBtn.disabled) { prevBtn.click(); return; }
      }
      finishExport();
    });
  }
}

// ─── Start collection ─────────────────────────────────────────────────────────
function startCollection(retryCount = 0, retryPage = 0) {
  chrome.storage.sync.get(['export_status', 'peopleToExport'], async ({ export_status, peopleToExport }) => {
    if (export_status === 'finished') return;
    chrome.storage.sync.set({ export_status: 'working' });
    setExportStatus('working');

    const profilesEl = document.getElementById('findymail-profiles');
    if (!profilesEl) {
      if (retryCount < 3) {
        setTimeout(() => startCollection(retryCount + 1, retryPage), 5000);
      } else {
        setTimeout(() => { flipPage(); setTimeout(() => startCollection(0, retryPage), 5000); }, 5000);
      }
      return;
    }

    // Set net_new tab detection
    try {
      const tabText = q('.pipeline-tabs.zp-tabs .zp_FvOcf')?.textContent || '';
      chrome.storage.sync.set({ apollo_tab: tabText.includes('Net') ? 'net_new' : 'not_net_new' });
    } catch {}

    // Fail-safe timer
    clearTimeout(state.collectPeopleFailTimer);
    state.collectPeopleFailTimer = setTimeout(() => {
      chrome.storage.sync.get(['export_status'], ({ export_status }) => {
        if (export_status === 'working' || export_status === 'completing') {
          flipPage();
          setTimeout(() => startCollection(0, retryPage), 5000);
        }
      });
    }, 300000);

    let profiles = [];
    let orgs = null;
    try { profiles = JSON.parse(profilesEl.textContent.replaceAll('\n', '')); } catch {}
    try { orgs = JSON.parse(document.getElementById('findymail-orgs')?.textContent.replaceAll('\n', '') || 'null'); } catch {}

    const limit = parseInt(peopleToExport) || 25;
    const toProcess = profiles.slice(0, Math.min(limit - retryPage, 25));
    let processed = 0;

    if (toProcess.length === 0) {
      flipPage();
      setTimeout(() => startCollection(0, retryPage), 5000);
      return;
    }

    // Use for...of with await — forEach(async) does NOT await promises inside
    for (const person of toProcess) {
      try {
        // Extract person fields
        const fullName   = cleanText(person.name || '');
        const nameParts  = fullName.trim().split(/\s+/);
        const firstName  = nameParts[0] || '';
        const lastName   = nameParts.slice(1).join(' ') || '';
        const title      = cleanText(person.title || person.headline || '');
        const linkedinUrl = person.linkedin_url || '';
        const twitterUrl  = person.twitter_url || '';
        const facebookUrl = person.facebook_url || '';
        const city    = person.city || '';
        const region  = person.state || '';
        const country = person.country || '';

        let company = '', domain = '', companyLinkedin = '', companyFacebook = '', companyTwitter = '';
        let industry = '', keywords = '', employees = '', companyCity = '', companyState = '', companyCountry = '';

        const org = person.organization || null;
        const acc = person.account || null;
        const orgId = person.organization_id;

        if (org) {
          company         = cleanCompany(org.name || '');
          domain          = org.primary_domain || org.website_url || '';
          companyLinkedin = org.linkedin_url || '';
          companyFacebook = org.facebook_url || '';
          companyTwitter  = org.twitter_url || '';
          if (orgs?.organizations) {
            const orgData = orgs.organizations.find(o => o.id === orgId) || {};
            industry    = orgData.industry || '';
            keywords    = (orgData.keywords || []).join(',');
            employees   = orgData.estimated_num_employees || '';
            companyCity = orgData.city || '';
            companyState = orgData.state || '';
            companyCountry = orgData.country || '';
          }
        } else if (acc) {
          company         = cleanCompany(person.organization_name || acc.domain || '');
          domain          = acc.domain || '';
          companyLinkedin = acc.linkedin_url || '';
          companyFacebook = acc.facebook_url || '';
          companyTwitter  = acc.twitter_url || '';
          industry    = acc.industries?.[0] || '';
          keywords    = (acc.keywords || []).join(',');
          employees   = acc.estimated_num_employees || '';
          companyCity = acc.city || '';
          companyState = acc.state || '';
          companyCountry = acc.country || '';
        }

        if (!company && person.organization_name) company = cleanCompany(person.organization_name);

        // Check if Apollo already has the email revealed
        let email = '';
        const knownEmail = person.email || '';
        if (knownEmail && knownEmail !== 'email_not_unlocked@domain.com') {
          email = knownEmail;
        } else {
          email = await apiFindEmail(firstName, lastName, domain) || '';
        }

        // Deduplicate
        if (email && state.emailList.includes(email)) {
          email = '';
        } else if (email) {
          state.emailList.push(email);
        }

        // Verify email and get status
        let emailStatus = 'Unknown';
        if (email) {
          const vResult = await apiVerifyEmail(email);
          emailStatus = reasonToStatus(vResult.reason, vResult.valid);
          // Update live counters
          if (emailStatus === 'Verified')  state.statusCounts.verified++;
          else if (emailStatus === 'Catch-All') state.statusCounts.catchAll++;
          else if (emailStatus === 'Invalid')   state.statusCounts.invalid++;
          else                                   state.statusCounts.unknown++;
        } else {
          state.statusCounts.unknown++;
        }
        updateStatusCounts();

        state.peopleList.push([
          csvSafe(linkedinUrl), csvSafe(fullName), csvSafe(firstName), csvSafe(lastName),
          csvSafe(email), csvSafe(emailStatus), csvSafe(title), csvSafe(company), csvSafe(domain),
          csvSafe(city), csvSafe(region), csvSafe(country),
          csvSafe(industry), csvSafe(keywords), csvSafe(employees),
          csvSafe(companyCity), csvSafe(companyState), csvSafe(companyCountry),
          csvSafe(companyLinkedin), csvSafe(companyTwitter), csvSafe(companyFacebook),
          csvSafe(twitterUrl), csvSafe(facebookUrl)
        ]);

        // Update progress
        const current = state.peopleList.length - 1;
        const progCur = q('.findy--export-progress-current');
        const progTot = q('.findy--export-progress-total');
        if (progCur) progCur.textContent = current;
        if (progTot) progTot.textContent = limit;

        processed++;

        if (current >= limit) {
          finishExport();
          clearTimeout(state.collectPeopleFailTimer);
          return;
        }

        if (processed >= toProcess.length) {
          clearTimeout(state.collectPeopleFailTimer);
          setTimeout(() => {
            flipPage();
            setTimeout(() => startCollection(0, retryPage + toProcess.length), 5000);
          }, Math.max(5000, Math.floor(Math.random() * 5000)));
        }
      } catch (err) {
        console.error('[MOGO] Person processing error:', err);
        state.peopleList.push(new Array(23).fill('')); // 23 columns to match csvTitles
        processed++;
      }
    } // end for...of

    profilesEl.remove();
  });
}

// ─── Finish & download CSV ────────────────────────────────────────────────────
function finishExport() {
  chrome.storage.sync.get(['export_status'], ({ export_status }) => {
    if (export_status === 'finished') return;
    chrome.storage.sync.set({ export_status: 'finished' });

    if (state.peopleList.length <= 1) {
      setExportStatus('error');
      return;
    }

    setExportStatus('success');

    // Show final stats in success panel
    const statsEl = document.getElementById('mogo-final-stats');
    if (statsEl) {
      const { verified, catchAll, unknown, invalid } = state.statusCounts;
      statsEl.innerHTML = [
        `<span style="background:#d4edda;color:#155724;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">✅ Verified: ${verified}</span>`,
        `<span style="background:#fff3cd;color:#856404;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">⚠️ Catch-All: ${catchAll}</span>`,
        `<span style="background:#e2e3e5;color:#383d41;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">❓ Unknown: ${unknown}</span>`,
        `<span style="background:#f8d7da;color:#721c24;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">❌ Invalid: ${invalid}</span>`,
      ].join('');
    }

    const csv = state.peopleList.map(row => row.join(',').replace(/#/g, '').trim()).join('\r\n');
    const uri = encodeURI('data:text/csv;charset=utf-8,' + csv);
    const a = document.createElement('a');
    a.setAttribute('href', uri);
    a.setAttribute('download', `apollo_export_${state.peopleList.length - 1}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`);
    a.click();
  });
}

// ─── Update export UI status ──────────────────────────────────────────────────
function setExportStatus(status) {
  const panels = {
    working:  { show: '.findy--export-inprogress', hide: ['.findy--export-settings', '.findy--export-error', '.findy--export-success'] },
    success:  { show: '.findy--export-success',    hide: ['.findy--export-settings', '.findy--export-error', '.findy--export-inprogress'] },
    error:    { show: '.findy--export-error',      hide: ['.findy--export-settings', '.findy--export-success', '.findy--export-inprogress'] },
    waiting:  { show: '.findy--export-settings',   hide: ['.findy--export-error', '.findy--export-success', '.findy--export-inprogress'] },
  };
  const conf = panels[status];
  if (!conf) return;
  try {
    const showEl = q(conf.show);
    if (showEl) showEl.style.display = 'block';
    conf.hide.forEach(sel => { const el = q(sel); if (el) el.style.display = 'none'; });
  } catch {}
}

// ─── Render Export Button on Apollo ──────────────────────────────────────────
function renderExportButton() {
  try { if (state.exportButtonChecker) state.exportButtonChecker.disconnect(); } catch {}

  if (q('.mogo--search-export-button')) return; // already exists

  // Only show on people search pages
  if (window.location.href.indexOf('/people') === -1) return;

  const btn = document.createElement('a');
  btn.textContent = '💌 Export to CSV';
  btn.className = 'mogo--search-export-button';
  btn.style.cssText = [
    'color:white','font-weight:600','cursor:pointer',
    'padding:10px 12px','background:#E84C4B','border-radius:8px',
    'justify-content:flex-start','align-items:center','gap:8px',
    'display:inline-flex','margin-bottom:5px','z-index:9999'
  ].join(';');
  btn.onclick = openExportModal;

  // Try multiple selectors for the toolbar — Apollo changes their DOM
  var targets = [
    'div.pipeline-tabs',
    '.finder-explorer-sidebar-shown div.zp-tabs',
    '.zp_hdLme > div',
    '.finder-results-list-panel-content > div:first-child',
    'div[class*="pipeline-tabs"]',
    'div.zp-tabs',
    'div[data-cy="people-table-toolbar"]',
    'div[class*="toolbar"]'
  ];
  var container = null;
  for (var i = 0; i < targets.length; i++) {
    container = q(targets[i]);
    if (container) break;
  }

  if (!container) {
    // If no container found yet, Apollo may still be loading — retry
    if (!renderExportButton._retries) renderExportButton._retries = 0;
    renderExportButton._retries++;
    if (renderExportButton._retries < 10) {
      setTimeout(renderExportButton, 3000);
    }
    return;
  }
  renderExportButton._retries = 0;
  container.append(btn);
}

// ─── Remove export button ─────────────────────────────────────────────────────
function removeExportButton() {
  var el = q('.mogo--search-export-button');
  if (el) el.remove();
  state.peopleList = [state.csvTitles];
  state.emailList = [];
}

// ─── Handle Apollo SPA navigation ────────────────────────────────────────────
function handleRouteChange() {
  var url = window.location.href || '';
  if (url.indexOf('/people') > -1) {
    // On people search — show export button after DOM settles
    setTimeout(renderExportButton, 2000);
  } else {
    removeExportButton();
  }
}

// ─── Listen for storage/tab changes ──────────────────────────────────────────
chrome.storage.onChanged.addListener(function(changes) {
  for (var key in changes) {
    if (!changes.hasOwnProperty(key)) continue;
    var newValue = changes[key].newValue;
    if (key === 'export_status') {
      setExportStatus(newValue);
      if (newValue === 'finished') {
        chrome.storage.sync.get(['apollo_duplicates'], function(data) {
          if (data.apollo_duplicates) {
            var warn = q('.findy--export-warning');
            if (warn) warn.style.display = 'block';
          }
        });
      }
    }
    if (key === 'current_tab_url') {
      if (/^https:\/\/app\.apollo\.io/.test(newValue)) {
        setTimeout(renderExportButton, 2000);
      } else {
        removeExportButton();
      }
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  console.log('[MOGO] Apollo content script loaded');

  // Inject the profile data extractor
  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('apollo_inject.js');
  (document.head || document.body || document.documentElement).appendChild(script);

  // Load modal components into storage cache
  chrome.storage.sync.get(null, function() {
    chrome.storage.sync.set({
      authorization_status: 'is_authorized', // Always authorized
      export_status: 'waiting'
    });
  });

  // Listen for SPA hash route changes (Apollo uses hash routing)
  window.addEventListener('hashchange', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);

  // Also watch for DOM-based navigation (React router can push without hashchange)
  var lastUrl = window.location.href;
  var routeObserver = new MutationObserver(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      handleRouteChange();
    }
  });
  routeObserver.observe(document.body, { childList: true, subtree: true });

  // Initial render after Apollo loads
  handleRouteChange();
})();
