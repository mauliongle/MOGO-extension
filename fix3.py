import sys

with open('apollo.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("if (window.location.hash.indexOf('/people') === -1) return;", "if (window.location.href.indexOf('/people') === -1) return;")

with open('apollo.js', 'w', encoding='utf-8') as f:
    f.write(content)
