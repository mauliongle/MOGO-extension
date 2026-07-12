/**
 * MOGO LinkedIn Content Script
 * Handles LinkedIn Sales Navigator search scraping, bulk export, and CSV generation.
 * All Findymail API calls replaced with local email pattern generation.
 */

const mogoState = {
  storage: { currentPage: null, maxPages: null },
  csvTitlesSn: ["linkedin_url","full_name","first_name","last_name","email","job_title","job_title_match","company","company_size","company_size_match","company_domain","industry","industry_match","salesnav_url","open_inmail","summary","keyword_match","company_city","company_region","company_country","contact_city","contact_region","contact_country","linkedin_company_url","is_premium","company_description","years_in_position","months_in_position","year_in_company","month_in_company","started_on_year","started_on_month"],
  csvTitles: ["linkedin_url","first_name","last_name","email","job_title","company","location"],
  csvTitlesAccounts: ["linkedin_url","company_name","description","industry","employee_range","employee_count"],
  csvTitlesCommenters: ["linkedin_url","first_name","last_name","email","job_title","company","company_domain"],
  exportButtonChecker: null,
  maxesSetFromPage: null,
  collectPeopleFailTimer: null,
  eventDuplicationsTimer: null,
  commenters: []
};
mogoState.peopleList = [mogoState.csvTitles];
mogoState.emailList = [];

const domainBlacklistForScraping = ['linktr.ee','bit.ly','cutt.ly','t.ly','ow.ly','facebook.com','linkedin.com','instagram.com','amazon.com'];
const shortLinkDomains = ['linktr.ee','bit.ly'];

// Professional title suffixes
const titleSuffixes = ["MBACP (Snr Accred.)","Academic Assoc CIPD","MBACP (Accred.)","Chartered MCIPD","PhD","MBA","MSc","BSc","CPA","CFA","PMP","CSM","CISSP","J.D.","Esq.","M.D.","D.O.","Ph.D.","M.B.A.","M.S.","M.F.A.","OBE","MBE","CBE"];

// ========== Email Generator (Local) ==========
const LocalEmailGen = {
  generate(firstName, lastName, domain) {
    if (!firstName || !domain) return { email: null, emails: [] };
    firstName = firstName.replace(/[^\w]/g, '').toLowerCase();
    lastName = lastName ? lastName.replace(/[^\w]/g, '').toLowerCase() : '';
    domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    if (!domain || domain.length < 3 || !domain.includes('.')) return { email: null, emails: [] };
    const patterns = [];
    if (firstName && lastName) {
      patterns.push(`${firstName}.${lastName}@${domain}`);
      patterns.push(`${firstName}${lastName}@${domain}`);
      patterns.push(`${firstName[0]}${lastName}@${domain}`);
      patterns.push(`${firstName}${lastName[0]}@${domain}`);
    } else if (firstName) {
      patterns.push(`${firstName}@${domain}`);
    }
    return { email: patterns[0] || null, emails: patterns };
  },
  fromFullName(name, domain) {
    if (!name || !domain) return { email: null, emails: [] };
    const parts = name.trim().split(/\s+/);
    return this.generate(parts[0], parts.slice(1).join(''), domain);
  }
};

// Timeout helper
const createAbortController = (seconds) => {
  let controller = new AbortController();
  setTimeout(() => controller.abort(), seconds * 1000);
  return controller;
};

function uniqueFilter(value, index, self) {
  return self.indexOf(value) === index;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(msg);
  if (msg.msg === 'showExportModal') {
    showExportModal();
  }
});

// Reference anchor for events
const eventAnchor = document.createElement('a');

// ========== Widget Setup ==========
function setupWidget(findyUrl, authUrl, authStatus, widgetSize, widgetX, widgetY) {
  const widget = document.createElement('div');
  widget.className = `findy--widget findy--flex findy--flex-col findy--flex-str ${widgetSize === 'min' ? 'findy--min' : ''}`;
  widget.style.transform = `translate(${widgetX}px, ${widgetY}px)`;

  const header = document.createElement('div');
  header.className = 'findy--header-widget';

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'findy--content-wrapper-widget';
  contentWrapper.innerHTML = '<div class="findy--content-widget findy--flex findy--flex-col"></div>';

  const contentWidget = contentWrapper.querySelector('.findy--content-widget');
  updateContentForUrl(document.location.href, contentWidget);

  // Show authorized state immediately - no login needed
  chrome.storage.sync.get(['exportStatus'], function({ exportStatus }) {
    if (exportStatus) {
      contentWidget.innerHTML = exportStatus;
      setExportStatusUI(contentWidget, 'loading');
    }
  });

  widget.appendChild(header);
  widget.appendChild(contentWrapper);
  document.body.appendChild(widget);

  // Make widget draggable
  makeDraggable('.findy--widget', '.findy--header-widget');

  // Setup modal
  loadHTML('components/modal.html', document.body).then(() =>
    loadHTML('pages/export-modal.html', querySelector('.findy--modal'), true).then(() => {
      loadHTML('components/export-status.html', querySelector('.findy--laptop-loading-container')).then(() => {
        setExportStatusUI(querySelector('.findy--export-inprogress'), 'loading');
      });
      loadHTML('components/export-status.html', querySelector('.findy--laptop-success-container')).then(() => {
        setExportStatusUI(querySelector('.findy--export-success'), 'success');
      });
      loadHTML('components/export-status.html', querySelector('.findy--laptop-error-container')).then(() => {
        setExportStatusUI(querySelector('.findy--export-error'), 'error');
      });

      // Save export buttons
      document.querySelectorAll('.findy--button-save-export').forEach(btn => {
        btn.onclick = () => finishExport();
      });

      querySelector('.findy--button-continue').onclick = function() {
        collectPeople();
      };

      const inputEl = querySelector('.findy--innput-people-export');
      
      document.querySelectorAll('.findy--button-cancel').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          resetExportState();
          querySelector('.findy--modal-wrapper').classList.remove('findy--modal-shown');
        };
      });

      inputEl.onkeyup = function() {
        chrome.storage.sync.set({ peopleToExport: this.value });
      };
      inputEl.onchange = function() {
        chrome.storage.sync.set({ peopleToExport: this.value });
      };

      chrome.storage.sync.get('peopleToExport', function(data) {
        let { peopleToExport } = data;
        if (!isNaN(peopleToExport) && peopleToExport > 0) {
          inputEl.value = peopleToExport;
        } else {
          inputEl.value = 0;
        }
      });

      querySelector('.findy--export-form').onsubmit = (e) => {
        e.preventDefault();
        collectPeople();
      };

      querySelector('#findyCreditsUsed').style.display = 'none';

      querySelector('#createListBtn').onclick = function() {
        loadHTML('/components/create-list.html', querySelector('.findy--modal'), true).then(() => {
          document.getElementById('cancelBtn').onclick = () => {
            chrome.storage.sync.get(null, ({ findy_url, auth_url, authorization_status, widget_size, widgetX, widgetY }) => {
              setupWidget(findy_url, auth_url, authorization_status, widget_size, widgetX, widgetY);
              populateListDropdowns();
            });
          };
          document.getElementById('createListBtn').onclick = () => {
            const name = document.getElementById('listnameInput').value;
            if (name) {
              createLocalListFromWidget(name).then(() => {
                chrome.storage.sync.get(null, ({ findy_url, auth_url, authorization_status, widget_size, widgetX, widgetY }) => {
                  setupWidget(findy_url, auth_url, authorization_status, widget_size, widgetX, widgetY);
                  populateListDropdowns();
                });
              });
            }
          };
        });
      };

      // Start export button
      querySelector('.findy--button-start-export').onclick = (e) => {
        e.preventDefault();
        collectPeople();
      };
    })
  );
}

function createLocalListFromWidget(name) {
  return new Promise(resolve => {
    chrome.storage.local.get(['mogo_lists'], data => {
      const lists = data.mogo_lists || [{ id: 0, name: 'All contacts', contacts: [] }];
      const newList = { id: Date.now(), name, contacts: [] };
      lists.push(newList);
      chrome.storage.local.set({ mogo_lists: lists }, () => {
        chrome.storage.sync.set({ autoSelectContactList: newList.id }, resolve);
      });
    });
  });
}

function populateListDropdowns() {
  chrome.storage.local.get(['mogo_lists'], data => {
    const lists = data.mogo_lists || [{ id: 0, name: 'All contacts', contacts: [] }];
    const select = querySelector('#findyListSelect');
    if (!select) return;
    while (select.childNodes.length > 1) select.removeChild(select.lastChild);
    querySelector('#findyListSelect option').innerText = 'All contacts';
    lists.forEach(list => {
      if (list.id === 0) return;
      const option = document.createElement('option');
      option.value = list.id;
      option.innerHTML = list.name;
      select.appendChild(option);
    });
  });

  // SN list
  const isSN = /^https:\/\/www.linkedin.com\/sales/.test(document.location.href);
  if (isSN) {
    querySelector('#findySelectLabelSN').style.display = 'block';
    querySelector('#findyListSelectSN').style.display = 'block';
    fetchSalesNavLists().then(data => {
      const select = querySelector('#findyListSelectSN');
      if (!select) return;
      querySelector('#findyListSelectSN option').innerText = '-- no list --';
      while (select.childNodes.length > 1) select.removeChild(select.lastChild);
      if (data && data.elements) {
        data.elements.forEach(el => {
          const opt = document.createElement('option');
          opt.value = el.id;
          opt.innerHTML = el.name;
          select.appendChild(opt);
        });
      }
    });
  }
}

// ========== Content Update ==========
function updateContentForUrl(url, contentWidget) {
  if (url === undefined) url = window.localStorage.href;
  
  if (/^https:\/\/www.linkedin.com\/search\/results\/people/.test(url) ||
      /^https:\/\/www.linkedin.com\/sales\/search\/people/.test(url) ||
      /^https:\/\/www.linkedin.com\/sales\/lists\/people/.test(url) ||
      /^https:\/\/www.linkedin.com\/sales\/search\/company/.test(url) ||
      /^https:\/\/www.linkedin.com\/posts\//.test(url)) {
    showInstructions('authorized', contentWidget);
    setProfileTab(false);
  } else {
    mogoState.storage.currentPage = null;
    mogoState.storage.maxPages = null;
    eventAnchor.dispatchEvent(new CustomEvent('findyEvent', { detail: { name: 'hide-export-button' } }));
    showInstructions('authorized', contentWidget);
    setProfileTab(false);
  }
}

function showInstructions(state, container) {
  const widget = container || document.querySelector('.findy--content-widget');
  if (!widget) return;
  
  if (state === 'authorized') {
    eventAnchor.dispatchEvent(new CustomEvent('findyEvent', { detail: { name: 'show-export-button' } }));
  }
}

function setProfileTab(enabled) {
  const tab = querySelector('[data-findy-tab="profile"]');
  if (!tab) return;
  if (enabled) tab.classList.remove('findy--tab-disabled');
  else tab.classList.add('findy--tab-disabled');
}

// ========== Export Button ==========
function setupExportButton() {
    try { mogoState.exportButtonChecker.disconnect(); } catch(e) {}
    try { if (mogoState.snObserver) mogoState.snObserver.disconnect(); } catch(e) {}
  
    chrome.storage.sync.get(['exportButton', 'isSN', 'current_tab_url'], function({ exportButton, isSN, current_tab_url }) {
      if (!exportButton) return;
      
      let container = querySelector('.search-results-container');
  
      if (current_tab_url !== undefined && current_tab_url.includes('/posts/')) {
        container = querySelector('.comments-comment-box') || querySelector('.comments-comment-box--cr');
      }
  
      const render = () => {
        if (document.querySelector('.findy--search-export-holder')) return true; // Already placed
  
        const holder = document.createElement('div');
        holder.innerHTML = exportButton;
        const exportElement = holder.firstElementChild;
  
        if (isSN) {
          // Robust Sales Navigator Targets
          const targets = [
            document.querySelector('.search-results__global-actions'),
            document.querySelector('#search-results-container header'),
            document.querySelector('.bulk-actions'),
            document.querySelector('.artdeco-card')
          ];
          
          const target = targets.find(t => t !== null);
          if (target) {
            target.insertBefore(exportElement, target.firstChild);
            return true;
          }
          return false;
        } else {
          const target = container ? container.querySelector('h2') : null;
          if (target && target.parentElement) {
            target.parentElement.insertBefore(exportElement, target);
            return true;
          }
        }
        return false;
      };
  
      if (isSN) {
        render();
        mogoState.snObserver = new MutationObserver(() => {
          if (!document.querySelector('.findy--search-export-holder')) {
             render();
          }
        });
        mogoState.snObserver.observe(document.body, { childList: true, subtree: true });
      } else if (container) {
        render();
        mogoState.exportButtonChecker = new MutationObserver(mutations => {
          let timeout;
          mutations.forEach(mutation => {
            if (mutation.target.tagName === 'H2' || !document.querySelector('.findy--search-export-holder')) {
              clearTimeout(timeout);
              timeout = setTimeout(() => { render(); }, 100);
            }
          });
        });
        mogoState.exportButtonChecker.observe(container, { childList: true, subtree: true });
      } else {
        setTimeout(() => setupExportButton(), 1000);
      }
    });
}

function removeExportButton() {
  try {
    const btn = document.getElementById('findy-overlay-btn');
    if (btn) btn.remove();
  } catch(e) {}
}

// ========== Pagination ==========
function flipPage() {
  chrome.storage.sync.get(['export_status'], function({ export_status }) {
    if (export_status === 'finished') return;
    
    const { maxPages, currentPage } = mogoState.storage;
    let nextBtn = document.querySelector('.artdeco-pagination__button--next');
    if (!nextBtn) nextBtn = document.querySelector('[data-testid="pagination-controls-next-button-visible"]');
    if (!nextBtn) return;
    
    const isDisabled = nextBtn.classList.contains('artdeco-button--disabled');
    if (isDisabled) {
      finishExport();
      return;
    }
    nextBtn.click();
  });
}

// ========== Reset State ==========
function resetExportState() {
  const inputEl = querySelector('.findy--innput-people-export');
  if (inputEl) { inputEl.max = 0; inputEl.value = 0; }
  chrome.storage.sync.set({
    peopleToExport: 0,
    exportOption: false,
    out_of_credits: false,
    autoSelectContactList: null,
    scrape_commenters: false,
    scrape_likers: false
  });
  const maxEl = querySelector('.findy--max-people');
  if (maxEl) maxEl.innerText = 0;
  mogoState.peopleList = [mogoState.csvTitles];
  mogoState.emailList = [];
  chrome.storage.sync.set({ export_status: 'waiting' });
  mogoState.maxesSetFromPage = false;
  mogoState.commenters = [];
}

// ========== Show Export Modal ==========
function showExportModal() {
  chrome.storage.sync.get(['current_tab_url', 'scrape_commenters', 'scrape_likers'], function({ current_tab_url, scrape_commenters, scrape_likers }) {
    const url = window.location.href;
    const isPostPage = url.includes('/posts/');

    if (url.includes('/sales/search/')) {
      if (/^https:\/\/www.linkedin.com\/sales\/search\/company/.test(url)) {
        // Account search
        fetchSalesNavAccountLists().then(data => {
          const select = querySelector('#findyListSelect');
          querySelector('#findyListSelect option').innerText = '-- no list --';
          while (select.childNodes.length > 1) select.removeChild(select.lastChild);
          if (data && data.elements) {
            data.elements.forEach(el => {
              const opt = document.createElement('option');
              opt.value = el.id;
              opt.innerHTML = el.name;
              select.appendChild(opt);
            });
          }
        });
        querySelector('.findy--modal-title').innerText = 'How many accounts would you like to save?';
        querySelector('#findyOptionBox').style.display = 'none';
        querySelector('#findyOptionLabel').style.display = 'none';
        querySelector('#findyOptionSubLabel').style.display = 'none';
        querySelector('#createListBtn').style.display = 'none';
        querySelector('#findySelectLabel').innerText = 'Save accounts to the LINKEDIN list:';
        querySelector('#findySelectLabelSN').style.display = 'none';
        querySelector('#findyListSelectSN').style.display = 'none';
      } else {
        // People search in SN
        populateListDropdowns();
        querySelector('#findyOptionBox').style.display = 'none';
        querySelector('#findyCreditsUsed').style.display = 'none';
        querySelector('.findy--modal-title').innerText = 'How many people would you like to export?';
        querySelector('#findyOptionLabel').style.display = 'block';
        querySelector('#findyOptionSubLabel').style.display = 'block';
        querySelector('#findySelectLabel').innerText = 'Save contacts in MOGO list:';
        querySelector('#findyOptionLabel').innerText = 'Fast mode: export faster, but finds ~10% less emails. (BETA)';
        querySelector('#findyOptionSubLabel').innerText = 'Caution - only use if you know what you\'re doing';
      }
    } else if (isPostPage) {
      populateListDropdowns();
      querySelector('.findy--export-settings').style.minWidth = '380px';
      querySelector('.findy--input').style.display = 'none';
      querySelector('.findy--max-number').style.display = 'none';
      querySelector('#findyOptionBox').style.display = 'none';
      querySelector('#findyOptionLabel').style.display = 'none';
      querySelector('#findyOptionSubLabel').style.display = 'none';
      querySelector('#findyCreditsUsed').style.display = 'none';
      querySelector('#createListBtn').style.display = 'none';
      querySelector('.findy--modal-title').textContent = 'Post';

      if (document.querySelectorAll('.findy--button-start-export').length !== 2) {
        const exportBtn = querySelector('.findy--button-start-export');
        exportBtn.textContent = 'Get likers';
        const commenterBtn = exportBtn.cloneNode(true);
        commenterBtn.textContent = 'Get commenters';
        exportBtn.parentNode.appendChild(commenterBtn);
        exportBtn.addEventListener('click', () => {
          chrome.storage.sync.set({ scrape_likers: true, scrape_commenters: false });
        });
        commenterBtn.addEventListener('click', () => {
          chrome.storage.sync.set({ scrape_likers: false, scrape_commenters: true });
        });
      }
    } else {
      // Regular LinkedIn search
      querySelector('#findyOptionLabel').style.display = 'none';
      querySelector('#findyOptionSubLabel').style.display = 'none';
      querySelector('#findyOptionBox').style.display = 'none';
      querySelector('#findyCreditsUsed').style.display = 'none';
      populateListDropdowns();
    }

    querySelector('.findy--modal-wrapper').classList.add('findy--modal-shown');
    resetExportState();
    setupPagination();
  });
}

// ========== Pagination Setup ==========
function setupPagination() {
  let container = document.querySelector('.search-results-container');
  if (!container) container = document.querySelector("[data-view-name='people-search-result']");
  let pages = document.querySelector('.artdeco-pagination__pages');
  if (!pages) pages = document.querySelector('[data-testid="pagination-controls-list"]');

  chrome.storage.sync.get(['isSN'], function({ isSN }) {
    if (isSN) {
      calculateMaxFromPage(isSN);
    } else {
      if (!container) return;
      if (pages) {
        calculateMaxFromPage();
      } else {
        document.querySelector('html').scrollTop = document.querySelector('html').scrollHeight;
        mogoState.storage.currentPage = 1;
        mogoState.storage.maxPages = 1;
        const items = container.querySelectorAll('.search-results-container ul li .linked-area')?.length;
        if (querySelector('.findy--max-people')?.textContent == 0) {
          querySelector('.findy--innput-people-export').max = items;
          querySelector('.findy--innput-people-export').value = items;
          querySelector('.findy--max-people').innerText = items;
          chrome.storage.sync.set({ peopleToExport: items });
          mogoState.maxesSetFromPage = true;
        }
      }
    }
  });
}

function calculateMaxFromPage(isSN) {
  const perPage = isSN ? 25 : 10;
  let pages = document.querySelector('.artdeco-pagination__pages');
  if (!pages) pages = document.querySelector('[data-testid="pagination-controls-list"]');
  
  let currentPage = 1, maxPages = 1;
  try {
    currentPage = pages.querySelector('.active')?.dataset.testPaginationPageBtn;
    maxPages = pages.lastElementChild?.dataset.testPaginationPageBtn;
  } catch(e) {
    try {
      currentPage = pages.querySelector("[aria-current='true']")?.textContent;
      maxPages = pages.lastElementChild?.textContent;
    } catch(e2) {}
  }
  
  mogoState.storage.currentPage = currentPage;
  mogoState.storage.maxPages = maxPages;
  
  const currentMax = querySelector('.findy--max-people')?.textContent;
  if (+currentMax === 0 || mogoState.maxesSetFromPage) {
    let total = Math.min(2500, perPage * +maxPages - (+currentPage * perPage - perPage));
    querySelector('.findy--innput-people-export').max = total;
    querySelector('.findy--innput-people-export').value = total;
    querySelector('.findy--max-people').innerText = total;
    chrome.storage.sync.set({ peopleToExport: total });
    mogoState.maxesSetFromPage = false;
  }
}

// ========== Local Email Search (replaces Findymail API) ==========
function searchEmailLocal(linkedinUrl, listId) {
  // This replaces fetch to app.findymail.com/api/search/business-profile
  return new Promise(resolve => {
    // Extract name from the URL or stored profiles
    chrome.storage.sync.get(['linkedin_profiles'], data => {
      const profiles = data.linkedin_profiles || {};
      // Find matching profile
      let profile = null;
      for (const [key, val] of Object.entries(profiles)) {
        if (val.linkedin_url && linkedinUrl.includes(val.linkedin_url)) {
          profile = val;
          break;
        }
      }
      
      if (profile && profile.domain) {
        const result = LocalEmailGen.fromFullName(profile.name, profile.domain);
        resolve({
          contact: {
            name: profile.name,
            email: result.email,
            company: profile.company,
            domain: profile.domain,
            job_title: profile.job_title
          }
        });
      } else {
        resolve({
          contact: {
            name: profile?.name || '',
            email: null,
            company: profile?.company || '',
            domain: '',
            job_title: ''
          }
        });
      }
    });
  });
}

function searchEmailByName(name, domain, linkedinUrl, company, jobTitle) {
  // Replaces fetch to app.findymail.com/api/search/name
  return new Promise(resolve => {
    const result = LocalEmailGen.fromFullName(name, domain);
    resolve({
      contact: {
        name: name,
        email: result.email,
        company: company,
        domain: domain,
        job_title: jobTitle
      }
    });
  });
}

// ========== Collect People (Main Export Logic) ==========
function collectPeople(offset = 0, retryCount = 0) {
  chrome.storage.sync.get(['isSN', 'scrape_commenters', 'scrape_likers', 'export_status'], function({ isSN, scrape_commenters, scrape_likers, export_status }) {
    
    if (scrape_commenters && !isSN) {
      querySelector('.findy--export-progress-current').textContent = 0;
      collectCommenters();
      return;
    }
    
    if (scrape_likers && !isSN) {
      querySelector('.findy--export-progress-current').textContent = 0;
      collectLikers();
      return;
    }

    mogoState.peopleList[0] = isSN ? mogoState.csvTitlesSn : mogoState.csvTitles;
    clearTimeout(mogoState.collectPeopleFailTimer);

    const resultsContainer = isSN ? querySelector('.artdeco-list') : (querySelector('.search-results-container') || querySelector("[data-view-name='people-search-result']"));
    if (!resultsContainer && !isSN) return false;
    if (export_status === 'finished') return false;

    chrome.storage.sync.set({ export_status: 'working' });
    eventAnchor.dispatchEvent(new CustomEvent('findyEvent', { detail: { name: 'collect-people' } }));

    const listId = querySelector('#findyListSelect')?.value || 0;
    const snListId = querySelector('#findyListSelectSN')?.value || 0;

    if (window.location.toString().includes('search/company')) {
      collectAccounts();
      return;
    }

    chrome.storage.sync.get(['lang', 'peopleToExport', 'exportOption'], function({ lang, peopleToExport, exportOption }) {
      if (isSN) {
        // Sales Navigator scraping
        collectSalesNavPeople(offset, retryCount, peopleToExport, listId, snListId, exportOption);
      } else {
        // Regular LinkedIn search scraping
        collectRegularLinkedInPeople(offset, peopleToExport, listId);
      }
    });

    // Fail timer
    mogoState.collectPeopleFailTimer = setTimeout(function() {
      chrome.storage.sync.get(['export_status'], function({ export_status }) {
        if (export_status === 'working' || export_status === 'completing') {
          chrome.storage.sync.set({ export_status: 'error' }, function() {
            querySelectorAsync('.findy--continue_in').then(el => {
              let countdown = 5;
              el.innerHTML = `&nbsp;in ${countdown}`;
              const interval = setInterval(() => {
                if (countdown > 1) {
                  countdown--;
                  el.innerHTML = `&nbsp;in ${countdown}`;
                } else {
                  clearInterval(interval);
                  el.innerHTML = '';
                  collectPeople();
                }
              }, 1000);
            });
          });
        }
      });
    }, 20000);
  });
}

// ========== Sales Navigator People Collection ==========
function collectSalesNavPeople(offset, retryCount, peopleToExport, listId, snListId, exportOption) {
  const breakToken = {};
  let localOffset = offset;

  querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length;
  querySelector('.findy--export-progress-total').textContent = peopleToExport;

  if (mogoState.peopleList.length >= peopleToExport) {
    finishExport();
    return;
  }

  // Check if profile data from s_inj.js is available
  if (document.getElementById('findymail-profiles') === null) {
    chrome.storage.sync.get(['export_status'], function({ export_status }) {
      if (export_status !== 'finished') {
        if (retryCount > 2) {
          setTimeout(() => {
            flipPage();
            setTimeout(() => collectPeople(localOffset), Math.max(5000, Math.floor(Math.random() * 7500)));
          }, Math.max(7500, Math.floor(Math.random() * 15000)));
        } else {
          setTimeout(() => collectPeople(localOffset, retryCount + 1), 5000);
        }
      }
    });
    return;
  }

  let profiles;
  try {
    profiles = JSON.parse(document.getElementById('findymail-profiles').textContent);
    document.getElementById('findymail-profiles').remove();
  } catch(e) {
    console.error('Failed to parse profiles', e);
    return;
  }

  const profileEntries = Object.entries(profiles);
  const totalOnPage = profileEntries.length;
  
  if (totalOnPage < peopleToExport - localOffset && peopleToExport - localOffset === 25) {
    peopleToExport = localOffset + totalOnPage;
    querySelector('.findy--export-progress-total').textContent = peopleToExport;
  }

  let processedCount = 0;
  const savedToSnList = [];

  profileEntries.forEach(function([key, profile]) {
    const firstName = cleanName(profile.user_first_name).split(' ');
    let first = firstName[0];
    let last = cleanName(profile.user_last_name);
    if (firstName.length > 1) last = firstName[1] + ' ' + last;
    const fullName = first + ' ' + last;
    
    const companyName = cleanCompanyName(profile.user_company_name);
    const jobTitle = stripEmojis(profile.job_title);
    const geoRegion = profile.user_city.split(',');
    const contactCity = cleanGeoName(geoRegion[geoRegion.length - 3] || '');
    const contactRegion = (geoRegion[geoRegion.length - 2] || '').trim();
    const contactCountry = (geoRegion[geoRegion.length - 1] || '').trim();
    
    let linkedinUrl = profile.user_url.split(',')[0].replace('sales/people', 'in');
    const summary = csvSafe((profile.user_summary || '').replaceAll('"', '""'));
    const jobTitleMatch = profile.job_title_match;
    const industry = profile.industry;
    const industryMatch = profile.industry_match;
    const keywordMatch = profile.keyword_match;
    const companyId = profile.user_company_id;
    const openLink = profile.open_link;
    const salesNavUrl = profile.user_url;
    const isPremium = profile.premium;
    const yearsInPosition = profile.lead_years_position;
    const monthsInPosition = profile.lead_months_position;
    const yearsInCompany = profile.lead_years_company;
    const monthsInCompany = profile.lead_months_company;
    const startedYear = profile.lead_position_started_year;
    const startedMonth = profile.lead_position_started_month;

    localOffset += 1;

    // Save to SN list
    try {
      const memberUrn = profile.user_url.replace('https://www.linkedin.com/sales/people/', '');
      savedToSnList.push('urn:li:fs_salesProfile:(' + memberUrn + ')');
    } catch(e) {}

    if (localOffset <= peopleToExport) {
      // Fetch company info
      fetchCompanyInfo(companyId).then(companyData => {
        let companyDomain = '';
        let companyCity = '', companyRegion = '', companyCountry = '';
        let companyLinkedInUrl = '';
        let companyDescription = '';
        let employeeCount = '';
        let headcountMatch = '';

        if (companyData && companyData.status !== 404) {
          if (companyData.websiteUrl) {
            companyDomain = extractRootDomain(companyData.websiteUrl).toLowerCase();
            if (domainBlacklistForScraping.some(d => companyDomain.includes(d))) {
              companyDomain = '';
            }
          }
          if (companyData.basicCompanyInfo?.miniCompany?.universalName) {
            companyLinkedInUrl = 'https://www.linkedin.com/company/' + companyData.basicCompanyInfo.miniCompany.universalName;
          }
          companyDescription = companyData.description || '';

          // Fetch extended company data from SN API
          fetchSalesNavCompanyData(companyId).then(snCompany => {
            try {
              employeeCount = snCompany.employeeCount;
              companyCountry = snCompany.headquarters?.country || '';
              companyRegion = snCompany.headquarters?.geographicArea || '';
              companyCity = snCompany.headquarters?.city || '';
            } catch(e) {
              employeeCount = companyData.employeeCountRange;
              if (employeeCount === 'myself only') employeeCount = 1;
            }

            headcountMatch = checkHeadcountMatch(employeeCount, profile.included_headcount);

            // If no domain found, try fetching from company about page
            if (!companyDomain && companyData.basicCompanyInfo?.miniCompany?.universalName) {
              fetchCompanyAboutPage(companyData.basicCompanyInfo.miniCompany.universalName).then(pageHtml => {
                companyDomain = extractDomainFromAboutPage(pageHtml);
                generateAndPushResult();
              }).catch(() => generateAndPushResult());
            } else {
              generateAndPushResult();
            }

            function generateAndPushResult() {
              // Generate email locally
              const emailResult = LocalEmailGen.generate(first, last, companyDomain || companyName);
              const email = emailResult.email || '';
              
              if (email && !companyDomain) companyDomain = email.split('@')[1];

              const uniqueKey = first + last + companyName + jobTitle;
              if (mogoState.emailList.includes(uniqueKey)) {
                peopleToExport--;
                localOffset--;
                chrome.storage.sync.set({ peopleToExport });
              } else {
                mogoState.peopleList.push([
                  csvSafe(linkedinUrl), csvSafe(fullName), csvSafe(first), csvSafe(last),
                  email, csvSafe(jobTitle), jobTitleMatch, csvSafe(companyName),
                  csvSafe(employeeCount), headcountMatch, companyDomain, csvSafe(industry),
                  industryMatch, csvSafe(salesNavUrl), openLink, summary, keywordMatch,
                  csvSafe(companyCity), csvSafe(companyRegion), csvSafe(companyCountry),
                  csvSafe(contactCity), csvSafe(contactRegion), csvSafe(contactCountry),
                  companyLinkedInUrl, isPremium, csvSafe(companyDescription),
                  yearsInPosition, monthsInPosition, yearsInCompany, monthsInCompany,
                  startedYear, startedMonth
                ]);
                mogoState.emailList.push(uniqueKey);
              }

              querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
              querySelector('.findy--export-progress-total').textContent = peopleToExport;

              if (mogoState.peopleList.length - 1 >= +peopleToExport) {
                finishExport();
                return;
              }

              processedCount++;
              if (processedCount === totalOnPage || processedCount === peopleToExport) {
                setTimeout(() => {
                  flipPage();
                  setTimeout(() => collectPeople(localOffset), Math.max(5000, Math.floor(Math.random() * 7500)));
                }, Math.max(5000, Math.floor(Math.random() * 7500)));
              }
            }
          });
        } else {
          // No company data
          const emailResult = LocalEmailGen.generate(first, last, companyName);
          mogoState.peopleList.push([
            csvSafe(linkedinUrl), csvSafe(fullName), csvSafe(first), csvSafe(last),
            emailResult.email || '', csvSafe(jobTitle), jobTitleMatch, csvSafe(companyName),
            '', '', '', csvSafe(industry), industryMatch, csvSafe(salesNavUrl), openLink,
            summary, keywordMatch, '', '', '', csvSafe(contactCity), csvSafe(contactRegion),
            csvSafe(contactCountry), '', isPremium, '',
            yearsInPosition, monthsInPosition, yearsInCompany, monthsInCompany,
            startedYear, startedMonth
          ]);
          
          querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
          processedCount++;
          if (processedCount === totalOnPage || processedCount === peopleToExport) {
            setTimeout(() => {
              flipPage();
              setTimeout(() => collectPeople(localOffset), Math.max(5000, Math.floor(Math.random() * 7500)));
            }, Math.max(5000, Math.floor(Math.random() * 7500)));
          }
        }
      }).catch(e => {
        console.error(e);
        processedCount++;
      });
    }
  });

  // Save to SN list if selected
  if (snListId != 0 && savedToSnList.length > 0) {
    bulkSaveToSalesNavList(savedToSnList, snListId);
  }
}

// ========== Regular LinkedIn People Collection ==========
function collectRegularLinkedInPeople(offset, peopleToExport, listId) {
  let results = [...document.querySelectorAll('.search-results-container ul li .linked-area')];
  if (results.length === 0) {
    results = [...document.querySelectorAll("[data-view-name='people-search-result']")];
  }

  if (results.length < 10 && peopleToExport - mogoState.peopleList.length > 10) {
    setTimeout(() => collectPeople(offset), 1000);
    return;
  }

  const breakToken = {};
  try {
    document.querySelector('html').scrollTop = document.querySelector('html').scrollHeight;
    querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length;
    querySelector('.findy--export-progress-total').textContent = peopleToExport;

    let localOffset = offset;
    let processed = 0;

    results.slice(0, peopleToExport).forEach(function(resultItem, index) {
      let linkEl = resultItem.querySelector('span > a[data-test-app-aware-link]');
      let fullName, jobTitle, companyInfo;

      if (!linkEl) {
        linkEl = resultItem.querySelector("[data-view-name='search-result-lockup-title']");
        if (linkEl) {
          fullName = linkEl.textContent;
          jobTitle = linkEl.parentElement?.parentElement?.querySelector('p:nth-of-type(3)')?.textContent;
          companyInfo = linkEl.parentElement?.parentElement?.querySelector('p:nth-of-type(2)')?.textContent;
        }
      } else {
        fullName = linkEl.querySelector('span > span')?.textContent;
        jobTitle = resultItem.querySelector('.mb1 div:nth-of-type(3)')?.textContent;
        companyInfo = resultItem.querySelector('.mb1 div:nth-of-type(2)')?.textContent;
      }

      if (!linkEl) return;
      const profileUrl = linkEl.getAttribute('href')?.split('?')[0];
      if (!profileUrl || !profileUrl.includes('/in/')) {
        peopleToExport--;
        chrome.storage.sync.set({ peopleToExport });
        localOffset++;
        processed++;
        return;
      }

      if (fullName) {
        const nameParts = cleanFullName(fullName);
        fullName = nameParts;
      }
      if (jobTitle) jobTitle = stripEmojis(jobTitle);
      if (companyInfo) companyInfo = stripEmojis(companyInfo).split(/ at | – | - | chez |@ /);

      const first = cleanName(fullName?.[0] || '');
      const last = cleanName(fullName?.[1] || '');

      // Generate email for this person
      const domain = companyInfo?.[1] || companyInfo?.[0] || '';
      const emailResult = LocalEmailGen.generate(first, last, domain);

      const uniqueKey = first + last + (emailResult.email || '');
      if (mogoState.emailList.includes(uniqueKey)) {
        peopleToExport--;
        localOffset--;
        processed++;
        chrome.storage.sync.set({ peopleToExport });
      } else {
        localOffset++;
        processed++;
        mogoState.peopleList.push([
          csvSafe(profileUrl), csvSafe(first), csvSafe(last),
          emailResult.email || '', csvSafe(companyInfo?.[0]), csvSafe(companyInfo?.[1]),
          csvSafe(jobTitle)
        ]);
        mogoState.emailList.push(uniqueKey);
      }

      querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
      querySelector('.findy--export-progress-total').textContent = peopleToExport;

      if (mogoState.peopleList.length - 1 >= +peopleToExport) {
        finishExport();
        throw breakToken;
      }

      if (processed === results.length - 1 && mogoState.peopleList.length < peopleToExport) {
        setTimeout(() => {
          flipPage();
          setTimeout(() => collectPeople(localOffset), Math.max(3500, Math.floor(Math.random() * 5000)));
        }, Math.max(1500, Math.floor(Math.random() * 6000)));
      }
    });
  } catch(e) {
    if (e !== breakToken) console.error('MOGO extension error:', e);
  }
}

// ========== Collect Accounts ==========
function collectAccounts(offset = 0, retryCount = 0) {
  mogoState.peopleList[0] = mogoState.csvTitlesAccounts;
  const breakToken = {};
  let listId = querySelector('#findyListSelect')?.value || 0;

  chrome.storage.sync.get(['peopleToExport'], function({ peopleToExport }) {
    if (mogoState.peopleList.length - 1 >= +peopleToExport) {
      finishExport();
      return;
    }

    if (document.getElementById('findymail-profiles') === null) {
      chrome.storage.sync.get(['export_status'], function({ export_status }) {
        if (export_status !== 'finished') {
          if (retryCount > 2) {
            setTimeout(() => {
              flipPage();
              setTimeout(() => collectAccounts(offset), Math.max(5000, Math.floor(Math.random() * 7500)));
            }, Math.max(7500, Math.floor(Math.random() * 15000)));
          } else {
            setTimeout(() => collectAccounts(offset, retryCount + 1), 5000);
          }
        }
      });
      return;
    }

    let accounts;
    try {
      accounts = JSON.parse(document.getElementById('findymail-profiles').textContent);
      document.getElementById('findymail-profiles').remove();
    } catch(e) { return; }

    const companyIds = [];
    Object.entries(accounts).forEach(function([key, account]) {
      if (mogoState.peopleList.length - 1 < +peopleToExport) {
        const companyUrl = 'https://www.linkedin.com/company/' + account.companyId;
        companyIds.push(Number(account.companyId));
        mogoState.peopleList.push([
          csvSafe(companyUrl), csvSafe(cleanCompanyName(account.companyName)),
          csvSafe(account.description), csvSafe(account.industry),
          csvSafe(account.employeeCountRange), account.employeeDisplayCount
        ]);
        querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
        querySelector('.findy--export-progress-total').textContent = peopleToExport;
      }
    });

    if (listId != 0) {
      saveSalesNavAccountList(companyIds, listId);
    }

    if (mogoState.peopleList.length - 1 >= +peopleToExport) {
      finishExport();
      return;
    }

    setTimeout(() => {
      flipPage();
      setTimeout(() => collectAccounts(offset), Math.max(5000, Math.floor(Math.random() * 7500)));
    }, Math.max(1000, Math.floor(Math.random() * 2500)));
  });
}

// ========== Likers/Commenters ==========
function collectLikers() {
  chrome.storage.sync.set({ export_status: 'working' });
  mogoState.peopleList[0] = mogoState.csvTitlesCommenters;
  loadMoreLikers();
  
  setTimeout(() => {
    const listId = querySelector('#findyListSelect')?.value || 0;
    const urls = getLikerUrls();
    const total = urls.length;
    querySelector('.findy--export-progress-total').textContent = total;
    let processed = 0;

    urls.forEach(url => {
      const slug = url.split('/in/')[1]?.replaceAll('/', '') || '';
      if (mogoState.emailList.includes(slug)) {
        processed++;
        return;
      }
      mogoState.emailList.push(slug);

      // For likers we don't have enough info for email generation
      mogoState.peopleList.push([csvSafe(url), '', '', '', '', '', '']);
      querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
      processed++;

      if (processed === total) {
        finishExport();
      }
    });
  }, 2000);
}

function collectCommenters() {
  chrome.storage.sync.set({ export_status: 'working' });
  mogoState.peopleList[0] = mogoState.csvTitlesCommenters;
  loadMoreComments();

  setTimeout(() => {
    const urls = getCommenterUrls();
    const total = urls.length;
    querySelector('.findy--export-progress-total').textContent = total;
    let processed = 0;

    urls.forEach(url => {
      const slug = url.split('/in/')[1]?.replaceAll('/', '') || '';
      if (mogoState.emailList.includes(slug)) {
        processed++;
        return;
      }
      mogoState.emailList.push(slug);
      mogoState.peopleList.push([csvSafe(url), '', '', '', '', '', '']);
      querySelector('.findy--export-progress-current').textContent = mogoState.peopleList.length - 1;
      processed++;

      if (processed === total) {
        finishExport();
      }
    });
  }, 2000);
}

function loadMoreComments() {
  const btn = document.querySelector('.comments-comments-list__load-more-comments-button--cr');
  if (btn) {
    btn.click();
    setTimeout(loadMoreComments, 8000);
  }
}

function loadMoreLikers(lastTop = 0) {
  if (!document.querySelector('.artdeco-modal__content')) {
    document.querySelector('button.social-details-social-counts__count-value')?.click();
    setTimeout(loadMoreLikers, 2000);
    return;
  }
  const items = [...document.querySelectorAll('.social-details-reactors-tab-body-list-item')];
  const lastItem = items[items.length - 1];
  if (!lastItem) return;
  const top = lastItem.offsetTop;
  if (lastTop === top) return;
  document.querySelector('.artdeco-modal__content').scrollTop = top;
  setTimeout(() => loadMoreLikers(top), 3000);
}

function getCommenterUrls() {
  return [...document.querySelectorAll('.comments-comment-meta__actor > a.comments-comment-meta__image-link')]
    .map(a => a.href).filter(h => h.includes('/in/')).filter(uniqueFilter).slice(0, 300);
}

function getLikerUrls() {
  return [...document.querySelectorAll('.social-details-reactors-tab-body-list-item a')]
    .map(a => a.href.split('?')[0]).filter(h => h.includes('/in/')).filter(uniqueFilter).slice(0, 300);
}

// ========== Finish Export ==========
function finishExport() {
  chrome.storage.sync.set({ export_status: 'finished' });
  downloadCSV();
}

function downloadCSV() {
  if (mogoState.peopleList.length <= 1) return;
  
  const csv = 'data:text/csv;charset=utf-8,' + 
    mogoState.peopleList.map(row => row.join(',').replace(/#/g, '').trim()).join('\r\n');
  const encoded = encodeURI(csv);
  const link = document.createElement('a');
  link.setAttribute('href', encoded);
  link.setAttribute('download', `mogo_export_${mogoState.peopleList.length - 1}_${new Date().toISOString().slice(0, -5).replace(/[T:]/g, '-')}.csv`);
  link.click();
  mogoState.peopleList = [mogoState.csvTitles];
}

// ========== LinkedIn API Helpers ==========
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

function fetchCompanyInfo(companyId) {
  if (!companyId) return Promise.resolve({});
  return fetch('https://www.linkedin.com/voyager/api/entities/companies/' + companyId, {
    method: 'get',
    headers: new Headers({
      'csrf-token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    })
  }).then(r => r.json()).catch(() => ({}));
}

function fetchSalesNavCompanyData(companyId) {
  if (!companyId) return Promise.resolve({});
  return fetch(`https://www.linkedin.com/sales-api/salesApiCompanies/${companyId}?decoration=%28entityUrn%2Cname%2Caccount%28saved%2CnoteCount%2ClistCount%2CcrmStatus%29%2CpictureInfo%2CcompanyPictureDisplayImage%2Cdescription%2Cindustry%2CemployeeCount%2CemployeeDisplayCount%2CemployeeCountRange%2Clocation%2Cheadquarters%2Cwebsite%2Crevenue%2CformattedRevenue%2CemployeesSearchPageUrl%2CflagshipCompanyUrl%2Cemployees*~fs_salesProfile%28entityUrn%2CfirstName%2ClastName%2CfullName%2CpictureInfo%2CprofilePictureDisplayImage%29%29`, {
    method: 'get',
    headers: new Headers({
      'Csrf-Token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0'
    })
  }).then(r => r.json()).catch(() => ({}));
}

function fetchCompanyAboutPage(universalName) {
  return fetch('https://www.linkedin.com/company/' + universalName + '/about/', {
    method: 'get',
    headers: new Headers({
      'csrf-token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    })
  }).then(r => r.text());
}

function fetchSalesNavLists() {
  return fetch("https://www.linkedin.com/sales-api/salesApiLists?q=listType&listType=LEAD&listSources=List(MANUAL,SYSTEM,CRM_AT_RISK_OPPORTUNITY,CRM_SYNC,CRM_BLUEBIRD,BUYER_INTEREST,LINKEDIN_SALES_INSIGHTS,CSV_IMPORT,RECOMMENDATION,NEW_EXECS_IN_SAVED_ACCOUNTS,LEADS_TO_FOLLOW_UP,CRM_PERSON_ACCOUNT,BOOK_OF_BUSINESS)&isMetadataNeeded=true&sortCriteria=NAME&sortOrder=ASCENDING&mostRecentlyUsedListCountInMetadata=1&ownership=OWNED_BY_VIEWER&decoration=%28id%2Cname%2CentityCount%2ClistSource%2Crole%29", {
    method: 'get',
    headers: new Headers({
      'Csrf-Token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0'
    })
  }).then(r => r.json()).catch(() => ({ elements: [] }));
}

function fetchSalesNavAccountLists() {
  return fetch("https://www.linkedin.com/sales-api/salesApiLists?q=listType&listType=ACCOUNT&listSources=List(MANUAL,SYSTEM,CRM_AT_RISK_OPPORTUNITY,CRM_SYNC,CRM_BLUEBIRD,BUYER_INTEREST,LINKEDIN_SALES_INSIGHTS,CSV_IMPORT,RECOMMENDATION,NEW_EXECS_IN_SAVED_ACCOUNTS,LEADS_TO_FOLLOW_UP,CRM_PERSON_ACCOUNT,BOOK_OF_BUSINESS)&isMetadataNeeded=true&sortCriteria=NAME&sortOrder=ASCENDING&mostRecentlyUsedListCountInMetadata=1&ownership=OWNED_BY_VIEWER&decoration=%28id%2Cname%2CentityCount%2ClistSource%2Crole%29", {
    method: 'get',
    headers: new Headers({
      'Csrf-Token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0'
    })
  }).then(r => r.json()).catch(() => ({ elements: [] }));
}

function bulkSaveToSalesNavList(memberUrns, listId) {
  fetch("https://www.linkedin.com/sales-api/salesApiLeads?action=bulkSaveByMembers", {
    method: 'post',
    headers: new Headers({
      'Csrf-Token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0'
    }),
    body: JSON.stringify({ entities: memberUrns, lists: [listId] })
  }).then(r => r.json()).catch(() => {});
}

function saveSalesNavAccountList(companyIds, listId) {
  fetch("https://www.linkedin.com/sales-api/salesApiCompanies?action=save", {
    method: 'post',
    headers: new Headers({
      'Csrf-Token': getCookie('JSESSIONID')?.replaceAll('"', ''),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0'
    }),
    body: JSON.stringify({ companyIds, lists: [listId] })
  }).then(r => r.json()).catch(() => {});
}

// ========== Utilities ==========
function setExportStatusUI(container, status) {
  const img = container?.querySelector('.findy--laptop-image');
  const loader = container?.querySelector('.findy--component-laptop-loader');
  if (!img || !loader) return;
  switch(status) {
    case 'loading': img.src = chrome.runtime.getURL('images/dashboard.png'); loader.style.display = 'block'; break;
    case 'success': img.src = chrome.runtime.getURL('images/success.svg'); loader.style.display = 'none'; break;
    case 'error': img.src = chrome.runtime.getURL('images/error.svg'); loader.style.display = 'none'; break;
  }
}

function csvSafe(val) {
  if (val === undefined) return '';
  return '"' + val.toString().replaceAll('"', "'") + '"';
}

function stripEmojis(str = '') {
  return str.replaceAll(/\p{Emoji_Presentation}/gu, '').replaceAll(/([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2580-\u27BF]|\uD83E[\uDD10-\uDDFF])/g, '').replaceAll(/\p{S}/gu, '').replaceAll('"', "'").replaceAll(',', '|').replaceAll('✴', '').trim();
}

function cleanName(name) {
  let cleaned = stripEmojis(name);
  cleaned = cleaned.replaceAll(/ *\([^)]*\) */g, '');
  cleaned = cleaned.replaceAll(/◆|►|☀/g, '').trim();
  cleaned = cleaned.replaceAll(/Dr\. |Dr /g, '').trim();
  for (let s of titleSuffixes) {
    cleaned = cleaned.replace(' ' + s, '');
    if (cleaned === s) cleaned = '';
  }
  cleaned = cleaned.split('◆')[0].split('-')[0].split('/')[0].split('►')[0].trim();
  return cleaned.trim();
}

function cleanFullName(str = '') {
  const cleaned = stripEmojis(str).replace(' ', ' | ').split(' | ');
  return [cleaned[0], (cleaned[1] || '').replace(/[.,:;|/()[\]{}*?&@#№%<>\-$"]+.*/, '')];
}

function cleanCompanyName(name) {
  return stripEmojis(name.split('- ')[0].replaceAll(/ *\([^)]*\) */g, '')
    .replace(', Inc.', '').replace(' Inc.', '').replace(' Inc', '')
    .replace(' LLC', '').replace(' Ltd', '').replace(' LTD', '')
    .replace(' GmbH', '').replace(', LLC', '').replace(', Ltd', '')
    .replace(', LTD', '').trim()
    .replace('<b>', '').replace('</b>', '')
    .replace(',', '').replace('&lt;b&gt;', '').replace('&lt;/b&gt;', '')
    .replace(', INC.', '')).trim();
}

function cleanGeoName(str) {
  return str.replace('Greater ', '').replace('Metropolitan Area', '').replace('Area', '').trim();
}

function extractRootDomain(url) {
  let domain;
  if (url.indexOf('//') > -1) domain = url.split('/')[2];
  else domain = url.split('/')[0];
  domain = domain.split(':')[0].split('?')[0];
  const parts = domain.split('.');
  const len = parts.length;
  if (len > 2) {
    domain = parts[len - 2] + '.' + parts[len - 1];
    if (parts[len - 2].length <= 3 && parts[len - 1].length === 2) {
      domain = parts[len - 3] + '.' + domain;
    }
  }
  return domain;
}

function extractDomainFromAboutPage(html) {
  let match = /&quot;websiteUrl&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;headquarter/gim.exec(html);
  if (!match) {
    match = /&quot;url&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;\$type&quot;:&quot;com.linkedin.voyager.dash.organization.CallToAction&quot;/gim.exec(html);
  }
  if (match?.groups?.websiteUrl) {
    const domain = extractRootDomain(match.groups.websiteUrl).toLowerCase();
    if (domainBlacklistForScraping.some(d => domain.includes(d))) return '';
    return domain;
  }
  return '';
}

function checkHeadcountMatch(count, ranges) {
  if (!ranges || ranges.length === 0) return '';
  if (Number.isInteger(count)) {
    for (const r of ranges) {
      if (count >= r.min && count <= r.max) return 'YES';
    }
    return 'NO';
  }
  if (typeof count === 'string' && count.includes('-')) {
    try {
      const max = count.split('-')[1];
      for (const r of ranges) {
        if (max == r.max) return 'YES';
      }
      return 'NO';
    } catch(e) { return ''; }
  }
  return '';
}

function querySelector(sel, parent, waitForIt) {
  parent = parent || document;
  if (waitForIt) return querySelectorAsync(sel, parent);
  return parent.querySelector(sel);
}

function querySelectorAsync(sel, parent) {
  parent = parent || document;
  return new Promise(resolve => {
    if (parent.querySelector(sel)) return resolve(parent.querySelector(sel));
    const observer = new MutationObserver(() => {
      if (parent.querySelector(sel)) {
        resolve(parent.querySelector(sel));
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function loadHTML(path, container, replace) {
  return fetch(chrome.runtime.getURL(path))
    .then(r => r.text())
    .then(html => {
      if (replace) container.innerHTML = '';
      container.appendChild(document.createRange().createContextualFragment(html));
    });
}

function makeDraggable(widgetSel, handleSel) {
  const widget = document.querySelector(widgetSel);
  const handle = document.querySelector(handleSel);
  if (!widget || !handle) return;
  let isDragging = false, startX, startY, x, y;
  handle.addEventListener('mousedown', function(e) {
    isDragging = true;
    chrome.storage.sync.get(['widgetX', 'widgetY'], function({ widgetX, widgetY }) {
      startX = e.clientX - widgetX;
      startY = e.clientY - widgetY;
    });
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    mogoState.dragging = true;
    document.body.style.userSelect = 'none';
    x = e.clientX - startX;
    y = e.clientY - startY;
    widget.style.transform = `translate(${x}px, ${y}px)`;
  });
  document.addEventListener('mouseup', function() {
    document.body.style.userSelect = '';
    chrome.storage.sync.set({ widgetX: x, widgetY: y });
    isDragging = false;
    setTimeout(() => { mogoState.dragging = false; }, 300);
  });
}

// ========== Initialize ==========
eventAnchor.addEventListener('findyEvent', function(event) {
  clearTimeout(mogoState.eventDuplicationsTimer);
  mogoState.eventDuplicationsTimer = setTimeout(function() {
    if (event.detail.name === 'pagination-found') setupPagination();
    if (event.detail.name === 'collect-people') {
      // Wait for results to load
      let timeout;
      const observer = new MutationObserver(function() {
        clearTimeout(timeout);
        timeout = setTimeout(function() {
          const link = document.querySelector('.app-aware-link');
          if (link) {
            setupPagination();
            observer.disconnect();
          }
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (event.detail.name === 'show-export-button') setTimeout(() => setupExportButton(), 100);
    if (event.detail.name === 'hide-export-button') removeExportButton();
  }, 10);
});

// Main initialization
chrome.storage.sync.get(null, function({ widget_size, widgetX, widgetY }) {
  const isSN = /^https:\/\/www.linkedin.com\/sales/.test(document.location.href);
  
  chrome.storage.sync.set({
    export_status: 'waiting',
    isSN: isSN,
    contact_fetching: false,
    toast: null
  });

  setupWidget('', '', 'is_authorized', widget_size, widgetX, widgetY);

  if (isSN) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('s_inj.js');
    (document.head || document.body || document.documentElement).appendChild(script);
  }
});

// Storage change listener
chrome.storage.onChanged.addListener(function(changes) {
  for (let [key, { newValue }] of Object.entries(changes)) {
    if (key === 'current_tab_url') {
      updateContentForUrl(newValue);
    }
    if (key === 'export_status') {
      try {
        if (newValue === 'working' || newValue === 'completing') {
          querySelector('.findy--export-inprogress').style.display = 'block';
          querySelector('.findy--export-settings').style.display = 'none';
          querySelector('.findy--export-error').style.display = 'none';
          querySelector('.findy--export-success').style.display = 'none';
        } else if (newValue === 'finished') {
          querySelector('.findy--export-success').style.display = 'block';
          querySelector('.findy--export-settings').style.display = 'none';
          querySelector('.findy--export-error').style.display = 'none';
          querySelector('.findy--export-inprogress').style.display = 'none';
        } else if (newValue === 'waiting') {
          querySelector('.findy--export-settings').style.display = 'block';
          querySelector('.findy--export-error').style.display = 'none';
          querySelector('.findy--export-success').style.display = 'none';
          querySelector('.findy--export-inprogress').style.display = 'none';
        } else if (newValue === 'error') {
          querySelector('.findy--export-error').style.display = 'block';
          querySelector('.findy--export-settings').style.display = 'none';
          querySelector('.findy--export-success').style.display = 'none';
          querySelector('.findy--export-inprogress').style.display = 'none';
        }
      } catch(e) {}
    }
    if (key === 'toast' && newValue) {
      try {
        querySelector('.findy-toast')?.classList.add('findy--toast-shown');
        querySelector('.findy--toast-message').innerText = newValue;
        setTimeout(() => {
          querySelector('.findy-toast')?.classList.remove('findy--toast-shown');
          chrome.storage.sync.set({ toast: null });
        }, 2000);
      } catch(e) {}
    }
  }
  if (changes.widgetX && changes.widgetY) {
    const widget = document.querySelector('.findy--widget');
    if (widget) widget.style.transform = `translate(${changes.widgetX.newValue}px, ${changes.widgetY.newValue}px)`;
  }
});

String.prototype.ucwords = function() {
  let str = this.toLowerCase();
  return str.replace(/(^([a-zA-Z\p{M}]))|([ -][a-zA-Z\p{M}])/g, function(s) { return s.toLocaleUpperCase(); });
};
