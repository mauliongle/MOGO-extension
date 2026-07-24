/**
 * MOGO Popup Script
 * No login/auth required. Directly handles profile enrichment and navigation.
 */

const linkedinProfileRegex = new RegExp(/^https:\/\/www.linkedin.com\/in\//);
const salesNavProfileRegex = new RegExp(/^https:\/\/www.linkedin.com\/sales\/lead\//);
const salesNavPeopleRegex = new RegExp(/^https:\/\/www.linkedin.com\/sales\/people\//);
const apolloRegex = new RegExp(/^https:\/\/app.apollo.io\/#\/people/);
const salesNavSearchRegex = new RegExp(/^https:\/\/www.linkedin.com\/sales\/search\//);
const linkedinSearchRegex = new RegExp(/^https:\/\/www.linkedin.com\/search\/results\/people/);
const postsRegex = new RegExp(/^https:\/\/www.linkedin.com\/posts\//);

function isSalesNavProfile(url) {
  return salesNavProfileRegex.test(url) || salesNavPeopleRegex.test(url);
}

// ========== Email Generator (inline for popup context) ==========
const EmailGen = {
  generate(firstName, lastName, domain) {
    if (!firstName || !domain) return { emails: [], primary: null };
    firstName = firstName.replace(/[^\w\s-]/g, '').trim().toLowerCase();
    lastName = lastName ? lastName.replace(/[^\w\s-]/g, '').trim().toLowerCase() : '';
    domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    if (!domain || domain.length < 3) return { emails: [], primary: null };
    const p = [];
    if (firstName && lastName) {
      p.push(`${firstName}.${lastName}@${domain}`);
      p.push(`${firstName}${lastName}@${domain}`);
      p.push(`${firstName[0]}${lastName}@${domain}`);
      p.push(`${firstName}${lastName[0]}@${domain}`);
      p.push(`${firstName}_${lastName}@${domain}`);
      p.push(`${firstName}@${domain}`);
    } else if (firstName) {
      p.push(`${firstName}@${domain}`);
    }
    return { emails: p, primary: p[0] || null };
  },
  fromFullName(fullName, domain) {
    if (!fullName || !domain) return { emails: [], primary: null };
    const parts = fullName.trim().split(/\s+/);
    return this.generate(parts[0] || '', parts.slice(1).join(' ') || '', domain);
  }
};

// ========== Utility: Load HTML component ==========
function loadComponent(path, container, replace) {
  return fetch(chrome.runtime.getURL(path))
    .then(r => r.text())
    .then(html => {
      if (replace) container.innerHTML = '';
      container.appendChild(document.createRange().createContextualFragment(html));
    });
}

// Clipboard fallback for Chrome 109 / Windows 7
function copyTextFallback(text) {
  try {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.getElementById('dynamic-content').appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.getElementById('dynamic-content').removeChild(textarea);
  } catch (e) {
    console.warn('[MOGO] Copy fallback failed:', e);
  }
}

// ========== Local Lists Management ==========
function getLocalLists() {
  return new Promise(resolve => {
    chrome.storage.local.get(['mogo_lists'], data => {
      resolve(data.mogo_lists || [{ id: 0, name: 'All contacts', contacts: [] }]);
    });
  });
}

function saveLocalLists(lists) {
  return chrome.storage.local.set({ mogo_lists: lists });
}

function createLocalList(name) {
  return getLocalLists().then(lists => {
    const newList = { id: Date.now(), name: name, contacts: [] };
    lists.push(newList);
    return saveLocalLists(lists).then(() => newList);
  });
}

function addContactToList(listId, contact) {
  return getLocalLists().then(lists => {
    const list = lists.find(l => l.id == listId) || lists[0];
    if (list) {
      list.contacts.push(contact);
    }
    return saveLocalLists(lists);
  });
}

// ========== Handle Tab State ==========
function sendMessageToTab(tabId, message, scriptFile, callback) {
  chrome.tabs.sendMessage(tabId, message, function(response) {
    if (chrome.runtime.lastError) {
      // Content script not loaded â€” try injecting it first
      if (chrome.scripting && scriptFile) {
        chrome.scripting.executeScript(
          { target: { tabId: tabId }, files: [scriptFile] },
          function() {
            if (chrome.runtime.lastError) {
              // Injection failed (e.g. chrome:// page) â€” just show popup
              console.warn('[MOGO] Script injection failed:', chrome.runtime.lastError.message);
              if (callback) callback(false);
              return;
            }
            // Retry message after injection
            setTimeout(function() {
              chrome.tabs.sendMessage(tabId, message, function() {
                if (chrome.runtime.lastError) {
                  console.warn('[MOGO] Retry sendMessage failed:', chrome.runtime.lastError.message);
                }
                if (callback) callback(false);
              });
            }, 400);
          }
        );
      } else {
        console.warn('[MOGO] sendMessage failed:', chrome.runtime.lastError.message);
        if (callback) callback(false);
      }
    } else {
      if (callback) callback(true);
    }
  });
}

function checkCurrentTab(tab) {
  if (!tab || !tab.url) { showReadyOrProfile(); return; }

  if (apolloRegex.test(tab.url)) {
    sendMessageToTab(tab.id, { msg: 'showExportModal' }, 'apollo.js', function(sent) {
      if (sent) {
        window.close();
      } else {
        // Content script couldn't be reached â€” show ready state
        showReady();
      }
    });
  } else if (salesNavSearchRegex.test(tab.url) || linkedinSearchRegex.test(tab.url) || postsRegex.test(tab.url)) {
    sendMessageToTab(tab.id, { msg: 'showExportModal' }, 'linkedin.js', function(sent) {
      if (sent) {
        window.close();
      } else {
        showReady();
      }
    });
  } else {
    showReadyOrProfile();
  }
}


// ========== Show enrichment result ==========
function showEnrichmentResult(result) {
  if (result.email) {
    loadComponent('components/profile-enrichment-completed.html', document.getElementById('dynamic-content'), true).then(() => {
      if (result.name) document.getElementById('profileName').innerText = result.name;
      if (result.company) document.getElementById('profileCompany').innerText = result.company;
      document.getElementById('profileEmail').innerText = result.email;
      
      document.getElementById('copyEmailBtn').onclick = function() {
        var textEl = document.getElementById('profileEmail');
        // Use clipboard API with fallback for Chrome 109 / Windows 7
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(result.email).catch(function() {
            copyTextFallback(result.email);
          });
        } else {
          copyTextFallback(result.email);
        }
        textEl.innerText = 'copied!';
        setTimeout(function() { textEl.innerText = result.email; }, 1300);
      };

      document.getElementById('openContactListBtn').onclick = () => {
        // Open local contacts view
        chrome.storage.local.get(['mogo_lists'], data => {
          const lists = data.mogo_lists || [];
          const allContacts = lists.flatMap(l => l.contacts);
          console.log('All contacts:', allContacts);
        });
      };

      document.querySelectorAll('.closeBtn').forEach(e => e.onclick = () => window.close());
      document.getElementById('backBtn').onclick = showReadyOrProfile;
    });
  } else if (result.phone_number) {
    loadComponent('components/profile-enrichment-completed.html', document.getElementById('dynamic-content'), true).then(() => {
      if (result.name) document.getElementById('profileName').innerText = result.name;
      if (result.company) document.getElementById('profileCompany').innerText = result.company;
      document.getElementById('profileEmail').innerText = result.phone_number;
      document.getElementById('foundLabel').innerText = 'Phone found';
      document.getElementById('copyOrContactLabel').innerText = '';
      
      document.getElementById('copyEmailBtn').onclick = function() {
        var textEl = document.getElementById('profileEmail');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(result.phone_number).catch(function() {
            copyTextFallback(result.phone_number);
          });
        } else {
          copyTextFallback(result.phone_number);
        }
        textEl.innerText = 'copied!';
        setTimeout(function() { textEl.innerText = result.phone_number; }, 1300);
      };

      document.querySelectorAll('.closeBtn').forEach(e => e.onclick = () => window.close());
      document.getElementById('backBtn').onclick = showReadyOrProfile;
    });
  } else {
    loadComponent('components/profile-enrichment-notfound.html', document.getElementById('dynamic-content'), true).then(() => {
      if (result.name) document.getElementById('profileName').innerText = result.name;
      if (result.company) document.getElementById('profileCompany').innerText = result.company;
      document.querySelectorAll('.closeBtn').forEach(e => e.onclick = () => window.close());
      document.getElementById('backBtn').onclick = showReadyOrProfile;
    });
  }
}

// ========== Show Profile Enrichment View ==========
function showProfileView() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const tab = tabs[0];
    if (!tab || (!linkedinProfileRegex.test(tab.url) && !isSalesNavProfile(tab.url))) {
      showReady();
      return;
    }

    loadComponent('/components/linkedin-profile.html', document.getElementById('dynamic-content'), true).then(() => {
      // Load stored profile data for this tab
      chrome.storage.sync.get(['linkedin_profiles'], function(data) {
        const profiles = data.linkedin_profiles || {};
        const profile = profiles[tab.id];
        if (profile) {
          document.getElementById('profileName').innerText = profile.name || '';
          document.getElementById('profileCompany').innerText = profile.company || '';
        }
      });

      // Populate local lists dropdown
      getLocalLists().then(lists => {
        const select = document.getElementById('findyListSelect');
        while (select.childNodes.length > 1) select.removeChild(select.lastChild);
        lists.forEach(list => {
          const option = document.createElement('option');
          option.value = list.id;
          option.innerHTML = list.name;
          select.appendChild(option);
        });
      });

      // Credits display - show "Unlimited"
      document.getElementById('finderCreditsBalance').innerText = 'âˆž Unlimited';

      // Close button
      document.getElementById('closeBtn').onclick = () => window.close();

      // Create list button
      document.getElementById('createListBtn').onclick = () => {
        loadComponent('/components/create-list-profile.html', document.getElementById('dynamic-content'), true).then(() => {
          document.getElementById('cancelBtn').onclick = showReadyOrProfile;
          document.getElementById('createListConfirmBtn').onclick = () => {
            const name = document.getElementById('listnameInput').value;
            if (name) {
              createLocalList(name).then(newList => {
                chrome.storage.sync.set({ autoSelectContactList: newList.id }, function() {
                  showReadyOrProfile();
                });
              });
            }
          };
        });
      };

      // Get Email button
      document.getElementById('getEmailBtn').onclick = handleGetEmail;

      // Get Phone button
      document.getElementById('getPhoneBtn').onclick = handleGetPhone;
    });
  });
}

// ========== Handle Get Email ==========
function handleGetEmail() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const tab = tabs[0];
    if (!tab) return;

    chrome.storage.sync.get(['linkedin_profiles'], function(data) {
      const profiles = data.linkedin_profiles || {};
      const profile = profiles[tab.id] || {};
      if (!profile || !profile.name) return;

      profile.list = document.getElementById('findyListSelect')?.value || 0;

      // Send to background script (which calls local API + fallback)
      chrome.runtime.sendMessage({
        to: 'bg',
        command: 'request',
        tab: tab.id.toString(),
        profile: profile,
        tabUrl: tab.url
      }, function() {
        if (chrome.runtime.lastError) {
          console.warn('[MOGO] sendMessage to bg failed:', chrome.runtime.lastError.message);
        }
      });

      loadComponent('/components/profile-enrichment-loading.html', document.getElementById('dynamic-content'), true);
    });
  });
}

// ========== Handle Get Phone ==========
function handleGetPhone() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const tab = tabs[0];
    if (!tab) return;

    chrome.storage.sync.get(['linkedin_profiles'], function(data) {
      const profiles = data.linkedin_profiles || {};
      const profile = profiles[tab.id] || {};
      if (!profile || !profile.name) return;

      profile.list = document.getElementById('findyListSelect')?.value || 0;

      // Send to background script
      chrome.runtime.sendMessage({
        to: 'bg',
        command: 'phone_request',
        tab: tab.id.toString(),
        profile: profile,
        tabUrl: tab.url
      }, function() {
        if (chrome.runtime.lastError) {
          console.warn('[MOGO] sendMessage to bg failed:', chrome.runtime.lastError.message);
        }
      });

      loadComponent('/components/profile-enrichment-loading.html', document.getElementById('dynamic-content'), true).then(() => {
        var label = document.getElementById('lookingLabel');
        if (label) label.innerText = 'Looking for a phone...';
      });
    });
  });
}

// ========== Show Ready State ==========
function showReady() {
  var container = document.getElementById('dynamic-content');
  if (container) {
    container.innerHTML = `
      <div class="content" id="ready-view">
        <div class="title">MOGO extension is active</div>
        <div class="subtitle">Visit a <b>LinkedIn</b>, <b>Sales Navigator</b>, or <b>Apollo.io</b> search page to extract contacts.</div>
        <div class="badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E84C4B" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          No login required &mdash; unlimited access
        </div>
      </div>
    `;
  }
}

// ========== Main: Show Ready or Profile ==========
function showReadyOrProfile() {
  chrome.storage.sync.get(['onboardingFlag'], function(data) {
    if (!data.onboardingFlag) {
      // Skip onboarding, mark as done
      chrome.storage.sync.set({ onboardingFlag: true });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const tab = tabs[0];
      if (tab && (linkedinProfileRegex.test(tab.url) || isSalesNavProfile(tab.url))) {
        showProfileView();
      } else {
        showReady();
      }
    });
  });
}

// ========== Initialize ==========
(async function() {
  chrome.runtime.connect({ name: 'popup' });
  chrome.storage.sync.set({ autoSelectContactList: null });
  
  chrome.storage.sync.get(['enrichment_statuses'], function(data) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const tab = tabs[0];
      if (!tab) { showReady(); return; }

      if (data.enrichment_statuses && (linkedinProfileRegex.test(tab.url) || isSalesNavProfile(tab.url))) {
        const status = data.enrichment_statuses[tab.id];
        if (status === 'loading') {
          loadComponent('/components/profile-enrichment-loading.html', document.getElementById('dynamic-content'), true);
        } else if (status && typeof status === 'object') {
          showEnrichmentResult(status);
        } else {
          checkCurrentTab(tab);
        }
      } else {
        checkCurrentTab(tab);
      }
    });
  });
})();

// Listen for enrichment results from background
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.enrichment_result) {
    chrome.storage.sync.get(['enrichment_statuses'], function(data) {
      const statuses = data.enrichment_statuses || {};
      statuses[msg.tab] = msg.enrichment_result;
      chrome.storage.sync.set({ enrichment_statuses: statuses }, function() {
        showEnrichmentResult(msg.enrichment_result);
        sendResponse({ success: true });
      });
    });
  } else {
    sendResponse({ success: false, reason: 'unknown_message' });
  }
  return true; // Keep message channel open for async sendResponse
});



