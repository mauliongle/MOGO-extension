/**
 * MOGO Background Service Worker
 * Handles profile detection, email generation, tab management.
 * No external API calls - everything is local.
 */

const LINKEDIN_URL_REGEX = new RegExp(/^https:\/\/www.linkedin.com\//);

// Professional title suffixes to strip from names
const TITLE_SUFFIXES = ["MBACP (Snr Accred.)","Academic Assoc CIPD","MBACP (Accred.)","Chartered MCIPD","MMathCompSci","HonFIMarEST","DSportExPsy","DSportExSci","Assoc CIPD","Master CSP","MA or M.A.","Hon. FRIBA","Int. FRIBA","DClinPsych","DHealthPsy","EdChPsychD","SHRM-SCP","SHRM-CP","PMI-ACP","Ph.D.","M.B.A.","M.P.A.","M.F.A.","M.S.","MBA","MSc","BSc","PhD","CPA","CFP","CFA","PMP","CSM","CISSP","CISA","CCNA","CCNP","AWS","PgMP","CSPO","J.D.","Esq.","M.D.","D.O.","RN","LPN","OBE","MBE","CBE","CQP","FCCA","ACCA","FCA","ACA","FRICS","MRICS","MCIPD","FCIPD","FRSA","CEng","IEng","MBCS","CITP"];

// Email pattern generator
const EmailGenerator = {
  generate(firstName, lastName, domain) {
    if (!firstName || !domain) return { emails: [], primary: null };
    firstName = this._clean(firstName).toLowerCase();
    lastName = lastName ? this._clean(lastName).toLowerCase() : '';
    domain = this._cleanDomain(domain).toLowerCase();
    if (!domain || domain.length < 3) return { emails: [], primary: null };
    const patterns = [];
    if (firstName && lastName) {
      patterns.push(`${firstName}.${lastName}@${domain}`);
      patterns.push(`${firstName}${lastName}@${domain}`);
      patterns.push(`${firstName[0]}${lastName}@${domain}`);
      patterns.push(`${firstName}${lastName[0]}@${domain}`);
      patterns.push(`${firstName}_${lastName}@${domain}`);
      patterns.push(`${firstName}@${domain}`);
    } else if (firstName) {
      patterns.push(`${firstName}@${domain}`);
    }
    return { emails: patterns, primary: patterns[0] || null };
  },
  fromFullName(name, domain) {
    if (!name || !domain) return { emails: [], primary: null };
    const parts = name.trim().split(/\s+/);
    return this.generate(parts[0], parts.slice(1).join(' '), domain);
  },
  _clean(s) { return s.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim(); },
  _cleanDomain(d) { return d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].split('?')[0].trim(); }
};

// Name cleaner - strips titles and suffixes
String.prototype.ucwords = function() {
  let str = this.toLowerCase();
  return str.replace(/(^([a-zA-Z\p{M}]))|([ -][a-zA-Z\p{M}])/g, function(s) { return s.toLocaleUpperCase(); });
};

function cleanPersonName(name) {
  let cleaned = stripEmojis(name.ucwords());
  cleaned = cleaned.replaceAll(/ *\([^)]*\) */g, '');
  cleaned = cleaned.replaceAll(/◆|►|☀|◌️|️/g, '').trim();
  cleaned = cleaned.replaceAll(/Dr\. |Dr |/g, '').trim();
  for (let suffix of TITLE_SUFFIXES) {
    cleaned = cleaned.replace(' ' + suffix, '');
    if (cleaned === suffix) cleaned = '';
  }
  cleaned = cleaned.split('◆')[0];
  cleaned = cleaned.split('-')[0];
  cleaned = cleaned.split('/')[0];
  cleaned = cleaned.split('►')[0].trim();
  return cleaned.ucwords().trim();
}

function stripEmojis(str = '') {
  return str
    .replaceAll(/\p{Emoji_Presentation}/gu, '')
    .replaceAll(/([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2580-\u27BF]|\uD83E[\uDD10-\uDDFF])/g, '')
    .replaceAll(/\p{S}/gu, '')
    .replaceAll('"', "'")
    .replaceAll(',', '|')
    .replaceAll('✴', '')
    .trim();
}

// ========== Component HTML Cache ==========
chrome.runtime.onInstalled.addListener(function(details) {
  cacheComponent('exportStatus', '/components/export-status.html');
  cacheComponent('loadingSpinner', '/components/loading-spinner.html');
  cacheComponent('exportButton', '/components/export-button.html');
  cacheComponent('modal', '/components/modal.html');

  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // Mark onboarding as complete - no login needed
    chrome.storage.sync.set({ onboardingFlag: true });
  }
});

function cacheComponent(key, path) {
  fetch(chrome.runtime.getURL(path))
    .then(r => r.text())
    .then(html => chrome.storage.sync.set({ [key]: html }));
}

// ========== Tab Management ==========
const contentPorts = {};

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'content_script') {
    contentPorts[port.sender.tab.id] = port;
    port.onMessage.addListener(msg => {
      console.log('Message from content script:', msg.msg);
    });
    port.onDisconnect.addListener(() => {
      delete contentPorts[port.sender.tab.id];
      chrome.storage.sync.get(['linkedin_profiles', 'enrichment_statuses'], function(data) {
        const profiles = data.linkedin_profiles || {};
        const statuses = data.enrichment_statuses || {};
        delete profiles[port.sender.tab.id];
        delete statuses[port.sender.tab.id];
        chrome.storage.sync.set({ linkedin_profiles: profiles, enrichment_statuses: statuses });
      });
    });
  }
});

chrome.tabs.onRemoved.addListener(function(tabId) {
  chrome.storage.sync.get(['linkedin_profiles', 'enrichment_statuses'], function(data) {
    const profiles = data.linkedin_profiles || {};
    const statuses = data.enrichment_statuses || {};
    delete profiles[tabId];
    delete statuses[tabId];
    
    const profileKeys = Object.keys(profiles);
    const cleanedProfiles = {};
    const cleanedStatuses = {};
    
    chrome.tabs.query({}, function(tabs) {
      const tabIds = tabs.map(t => t.id.toString());
      profileKeys.forEach(k => {
        if (tabIds.includes(k)) {
          cleanedProfiles[k] = profiles[k];
          cleanedStatuses[k] = statuses[k];
        }
      });
      chrome.storage.sync.set({ linkedin_profiles: cleanedProfiles, enrichment_statuses: cleanedStatuses });
    });
  });
});

let lastUrl = null;

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  chrome.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
    const tab = tabs[0];
    if (!tab) return;

    if (tab && tabId === tab.id && LINKEDIN_URL_REGEX.test(tab.url)) {
      if (changeInfo.status === 'loading') {
        chrome.storage.sync.set({ current_tab_url: tab.url });
        const state = {};
        state[tabId] = { status: 'pending' };
        chrome.storage.sync.set({ state: state });
      }

      if (changeInfo.status === 'complete' && 
          (/^https:\/\/www.linkedin.com\/in\//.test(tab.url) || /^https:\/\/www.linkedin.com\/sales\/lead/.test(tab.url))) {
        chrome.storage.sync.get(['linkedin_profiles', 'enrichment_statuses'], function(data) {
          const profiles = data.linkedin_profiles || {};
          const statuses = data.enrichment_statuses || {};
          delete profiles[tabId];
          delete statuses[tabId];
          chrome.storage.sync.set({ linkedin_profiles: profiles, enrichment_statuses: statuses });
        });
        chrome.tabs.sendMessage(tab.id, { msg: 'page_loaded' });
      }
    }
    if (tab) lastUrl = tab.url;
  });
});

// ========== Message Handling ==========
chrome.runtime.onMessage.addListener(function(msg, sender) {
  if (msg.command !== undefined) {
    // Email request
    if (msg.command === 'request' && msg.tab && msg.profile) {
      handleEmailRequest(msg.tab, msg.profile, msg.tabUrl);
      return true;
    }
    // Phone request
    if (msg.command === 'phone_request' && msg.tab && msg.profile) {
      handlePhoneRequest(msg.tab, msg.profile, msg.tabUrl);
      return true;
    }
  }

  // LinkedIn profile detected by content script
  if (msg.msg === 'linkedin_profile') {
    msg.profile.name = cleanPersonName(msg.profile.name);
    msg.profile.linkedin_url = lastUrl;

    chrome.storage.sync.get(['linkedin_profiles'], function(data) {
      const profiles = data.linkedin_profiles || {};
      profiles[sender.tab.id] = msg.profile;
      
      // Keep max 5 profiles
      const entries = Object.entries(profiles);
      let cleanedProfiles = profiles;
      if (entries.length > 5) {
        const sorted = entries.sort((a, b) => parseInt(b[0]) - parseInt(a[0])).slice(0, 5);
        cleanedProfiles = Object.fromEntries(sorted);
      }
      
      chrome.storage.sync.set({ linkedin_profiles: cleanedProfiles });
    });
  }

  return true;
});

// ========== Email Request Handler (Local API + Fallback) ==========
const MOGO_API_BASE = 'http://localhost:7823';

async function callFindAndVerify(name, domain) {
  try {
    const res = await fetch(`${MOGO_API_BASE}/find-and-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, domain }),
      signal: AbortSignal.timeout(18000)
    });
    if (!res.ok) throw new Error('API error');
    return await res.json();
  } catch {
    // API offline — fall back to local pattern generation
    const result = EmailGenerator.fromFullName(name, domain);
    return { email: result.primary, emails: result.emails, verified: false, confidence: 0.5, reason: 'local_fallback' };
  }
}

function handleEmailRequest(tabId, profile, tabUrl) {
  chrome.storage.sync.get(['enrichment_statuses'], function(data) {
    const statuses = data.enrichment_statuses || {};
    statuses[tabId] = 'loading';
    chrome.storage.sync.set({ enrichment_statuses: statuses }, async function() {
      const domain = profile.domain || profile.company || '';

      // Try local API first, fall back to pattern generation
      const apiResult = await callFindAndVerify(profile.name, domain);

      const enrichmentResult = {
        name: profile.name,
        company: profile.company,
        email: apiResult.email || null,
        allEmails: apiResult.emails || [],
        verified: apiResult.verified || false,
        confidence: apiResult.confidence || 0,
        verifyReason: apiResult.reason || 'local_fallback',
        domain,
        list: profile.list || 0,
        linkedin_url: tabUrl
      };

      // Save to local contacts
      if (enrichmentResult.email) {
        chrome.storage.local.get(['mogo_contacts'], function(d) {
          const contacts = d.mogo_contacts || [];
          contacts.push({ ...enrichmentResult, found_at: new Date().toISOString() });
          chrome.storage.local.set({ mogo_contacts: contacts });
        });
      }

      // Update enrichment status
      chrome.storage.sync.get(['enrichment_statuses'], function(d2) {
        const s = d2.enrichment_statuses || {};
        s[tabId] = enrichmentResult;
        chrome.storage.sync.set({ enrichment_statuses: s });
      });

      // Send result to popup
      chrome.runtime.sendMessage({
        to: 'popup',
        enrichment_result: enrichmentResult,
        tab: tabId
      });
    });
  });
}

// ========== Phone Request Handler ==========
function handlePhoneRequest(tabId, profile, tabUrl) {
  chrome.storage.sync.get(['enrichment_statuses'], function(data) {
    const statuses = data.enrichment_statuses || {};
    statuses[tabId] = 'loading';
    chrome.storage.sync.set({ enrichment_statuses: statuses }, function() {
      // Phone numbers cannot be found locally
      const result = {
        name: profile.name,
        company: profile.company,
        phone_number: null,
        list: profile.list || 0
      };

      chrome.storage.sync.get(['enrichment_statuses'], function(d2) {
        const s = d2.enrichment_statuses || {};
        s[tabId] = result;
        chrome.storage.sync.set({ enrichment_statuses: s });
      });

      chrome.runtime.sendMessage({
        to: 'popup',
        enrichment_result: result,
        tab: tabId
      });
    });
  });
}

// ========== Popup Connection Management ==========
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'popup') {
    port.onDisconnect.addListener(function() {
      // Popup closed
    });
  }
});
