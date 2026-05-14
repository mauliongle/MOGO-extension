/**
 * MOGO Popup Script
 * No login/auth required. Directly handles profile enrichment and navigation.
 */

const linkedinProfileRegex = new RegExp(/^https:\/\/www.linkedin.com\/in\//);
const salesNavProfileRegex = new RegExp(/^https:\/\/www.linkedin.com\/sales\/lead\//);
const apolloRegex = new RegExp(/^https:\/\/app.apollo.io\/#\/people/);
const salesNavSearchRegex = new RegExp(/^https:\/\/www.linkedin.com\/sales\/search\//);
const linkedinSearchRegex = new RegExp(/^https:\/\/www.linkedin.com\/search\/results\/people/);
const postsRegex = new RegExp(/^https:\/\/www.linkedin.com\/posts\//);

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
function checkCurrentTab(tab) {
  if (apolloRegex.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { msg: 'showExportModal' });
    window.close();
  } else if (salesNavSearchRegex.test(tab.url) || linkedinSearchRegex.test(tab.url) || postsRegex.test(tab.url)) {
    // Search page - show export modal
    chrome.tabs.sendMessage(tab.id, { msg: 'showExportModal' });
    window.close();
  } else {
    showReadyOrProfile();
  }
}

// ========== Show enrichment result ==========
function showEnrichmentResult(result) {
  if (result.email) {
    loadComponent('components/profile-enrichment-completed.html', document.body, true).then(() => {
      if (result.name) document.getElementById('profileName').innerText = result.name;
      if (result.company) document.getElementById('profileCompany').innerText = result.company;
      document.getElementById('profileEmail').innerText = result.email;
      
      document.getElementById('copyEmailBtn').onclick = () => {
        navigator.clipboard.writeText(result.email);
        document.getElementById('profileEmail').innerText = 'copied!';
        setTimeout(() => {
          document.getElementById('profileEmail').innerText = result.email;
        }, 1300);
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
    loadComponent('components/profile-enrichment-completed.html', document.body, true).then(() => {
      if (result.name) document.getElementById('profileName').innerText = result.name;
      if (result.company) document.getElementById('profileCompany').innerText = result.company;
      document.getElementById('profileEmail').innerText = result.phone_number;
      document.getElementById('foundLabel').innerText = 'Phone found';
      document.getElementById('copyOrContactLabel').innerText = '';
      
      document.getElementById('copyEmailBtn').onclick = () => {
        navigator.clipboard.writeText(result.phone_number);
        document.getElementById('profileEmail').innerText = 'copied!';
        setTimeout(() => {
          document.getElementById('profileEmail').innerText = result.phone_number;
        }, 1300);
      };

      document.querySelectorAll('.closeBtn').forEach(e => e.onclick = () => window.close());
      document.getElementById('backBtn').onclick = showReadyOrProfile;
    });
  } else {
    loadComponent('components/profile-enrichment-notfound.html', document.body, true).then(() => {
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
    if (!tab || (!linkedinProfileRegex.test(tab.url) && !salesNavProfileRegex.test(tab.url))) {
      showReady();
      return;
    }

    loadComponent('/components/linkedin-profile.html', document.body, true).then(() => {
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
      document.getElementById('finderCreditsBalance').innerText = '∞ Unlimited';

      // Close button
      document.getElementById('closeBtn').onclick = () => window.close();

      // Create list button
      document.getElementById('createListBtn').onclick = () => {
        loadComponent('/components/create-list-profile.html', document.body, true).then(() => {
          document.getElementById('cancelBtn').onclick = showReadyOrProfile;
          document.getElementById('createListConfirmBtn').onclick = () => {
            const name = document.getElementById('listnameInput').value;
            if (name) {
              createLocalList(name).then(newList => {
                chrome.storage.sync.set({ autoSelectContactList: newList.id }).then(() => {
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
      const listId = document.getElementById('findyListSelect')?.value || 0;

      loadComponent('/components/profile-enrichment-loading.html', document.body, true).then(() => {
        // Generate email locally
        const result = EmailGen.fromFullName(profile.name, profile.domain || profile.company);
        
        setTimeout(() => {
          if (result.primary) {
            const contact = {
              name: profile.name,
              company: profile.company,
              email: result.primary,
              allEmails: result.emails,
              linkedin_url: tab.url,
              found_at: new Date().toISOString()
            };

            // Save to local list
            addContactToList(listId, contact);

            // Save enrichment status
            chrome.storage.sync.get(['enrichment_statuses'], function(d) {
              const statuses = d.enrichment_statuses || {};
              statuses[tab.id] = contact;
              chrome.storage.sync.set({ enrichment_statuses: statuses });
            });

            showEnrichmentResult(contact);
          } else {
            showEnrichmentResult({ name: profile.name, company: profile.company });
          }
        }, 1500); // Simulate brief loading
      });
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

      loadComponent('/components/profile-enrichment-loading.html', document.body, true).then(() => {
        document.getElementById('lookingLabel').innerText = 'Looking for a phone...';
        
        setTimeout(() => {
          // Phone numbers can't be generated locally, show not found
          showEnrichmentResult({
            name: profile.name,
            company: profile.company,
            phone_number: null
          });
        }, 1500);
      });
    });
  });
}

// ========== Show Ready State ==========
function showReady() {
  loadComponent('components/popup-ready.html', document.body, true);
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
      if (tab && (linkedinProfileRegex.test(tab.url) || salesNavProfileRegex.test(tab.url))) {
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
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (!tab) { showReady(); return; }

      if (data.enrichment_statuses && (linkedinProfileRegex.test(tab.url) || salesNavProfileRegex.test(tab.url))) {
        const status = data.enrichment_statuses[tab.id];
        if (status === 'loading') {
          loadComponent('/components/profile-enrichment-loading.html', document.body, true);
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
chrome.runtime.onMessage.addListener(function(msg, sender) {
  if (msg.enrichment_result) {
    chrome.storage.sync.get(['enrichment_statuses'], function(data) {
      const statuses = data.enrichment_statuses || {};
      statuses[msg.tab] = msg.enrichment_result;
      chrome.storage.sync.set({ enrichment_statuses: statuses }, function() {
        showEnrichmentResult(msg.enrichment_result);
      });
    });
  }
});
