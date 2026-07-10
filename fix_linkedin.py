import sys

with open('linkedin.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Make the Sales Nav target more robust by falling back to document.body and making it fixed
new_render = '''      if (isSN) {
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
      }'''

old_render = '''      if (isSN) {
        const target = querySelector('.search-results__global-actions') || 
                       querySelector('#search-results-container header') || 
                       querySelector('.bulk-actions');
        if (target) {
          target.appendChild(exportElement);
          return true;
        }
      }'''

content = content.replace(old_render, new_render)

with open('linkedin.js', 'w', encoding='utf-8') as f:
    f.write(content)
