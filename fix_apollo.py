import sys

with open('apollo.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_targets = '''    var targets = [
      'div.pipeline-tabs',
      '.finder-explorer-sidebar-shown div.zp-tabs',
      '.zp_hdLme > div',
      '.finder-results-list-panel-content > div:first-child',
      'div[class*="pipeline-tabs"]',
      'div.zp-tabs',
      'div[data-cy="people-table-toolbar"]',
      'div[class*="toolbar"]',
      'body'
    ];'''
    
old_targets = '''    var targets = [
      'div.pipeline-tabs',
      '.finder-explorer-sidebar-shown div.zp-tabs',
      '.zp_hdLme > div',
      '.finder-results-list-panel-content > div:first-child',
      'div[class*="pipeline-tabs"]',
      'div.zp-tabs',
      'div[data-cy="people-table-toolbar"]',
      'div[class*="toolbar"]'
    ];'''

content = content.replace(old_targets, new_targets)

# Also fix the styling for body fallback
new_style = '''    btn.style.cssText = [
      'color:white','font-weight:600','cursor:pointer',
      'padding:10px 12px','background:#E84C4B','border-radius:8px',
      'justify-content:flex-start','align-items:center','gap:8px',
      'display:inline-flex','margin-bottom:5px','z-index:999999'
    ].join(';');'''
old_style = '''    btn.style.cssText = [
      'color:white','font-weight:600','cursor:pointer',
      'padding:10px 12px','background:#E84C4B','border-radius:8px',
      'justify-content:flex-start','align-items:center','gap:8px',
      'display:inline-flex','margin-bottom:5px','z-index:9999'
    ].join(';');'''
content = content.replace(old_style, new_style)

# Apply position fixed if fallback
fix_logic = '''    if (container === document.body) {
      btn.style.position = 'fixed';
      btn.style.top = '100px';
      btn.style.right = '20px';
    }
    container.append(btn);'''
content = content.replace('container.append(btn);', fix_logic)

with open('apollo.js', 'w', encoding='utf-8') as f:
    f.write(content)
