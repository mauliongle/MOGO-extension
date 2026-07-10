import sys

with open('popup.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('document.body', "document.getElementById('dynamic-content')")

with open('popup.js', 'w', encoding='utf-8') as f:
    f.write(content)
