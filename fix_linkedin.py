import re

with open('linkedin.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace setupExportButton
old_setup = '''function setupExportButton() {
    try { mogoState.exportButtonChecker.disconnect(); } catch(e) {}
  
    chrome.storage.sync.get(['exportButton', 'isSN', 'current_tab_url'], function({ exportButton, isSN, 
current_tab_url }) {
      if (!exportButton) return;
      
      let container = querySelector('.search-results-container');
      const snContainer = querySelector('#search-results-container');
  
      if (current_tab_url !== undefined && current_tab_url.includes('/posts/')) {
        container = querySelector('.comments-comment-box') || querySelector('.comments-comment-box--cr');
      }
  
      const render = () => {
        if (document.querySelector('.findy--search-export-holder')) return true; // Already placed
  
        const holder = document.createElement('div');
        holder.innerHTML = exportButton;
        const exportElement = holder.firstElementChild;
  
        if (isSN) {
          const target = querySelector('.search-results__global-actions') || 
                         querySelector('#search-results-container header') || 
                         querySelector('.bulk-actions') ||
                         querySelector('.artdeco-card') ||
                         document.body;
          if (target) {
            if (target === document.body) {
               exportElement.style.position = 'fixed';
               exportElement.style.top = '100px';
               exportElement.style.right = '20px';
               exportElement.style.zIndex = '999999';
            }
            target.insertBefore(exportElement, target.firstChild);
            return true;
          }
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
        if (!render()) {
          setTimeout(() => setupExportButton(), 1000);
        }
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
  }'''

new_setup = '''function setupExportButton() {
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
  }'''

# Using regex replace to avoid small whitespace issues
content = content.replace(old_setup.replace('\n', '\r\n'), new_setup)
# If it failed to replace (due to CRLF differences), try raw replace:
if 'Robust Sales Navigator Targets' not in content:
    content = content.replace(old_setup, new_setup)
    
with open('linkedin.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success' if 'Robust Sales Navigator Targets' in content else 'Failed to replace')
