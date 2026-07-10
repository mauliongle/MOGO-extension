import os

with open('apollo.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(\"var hash = window.location.hash || '';\", \"var url = window.location.href || '';\")
content = content.replace(\"if (hash.indexOf('/people') > -1)\", \"if (url.indexOf('/people') > -1)\")
content = content.replace(\"var lastHash = window.location.hash;\", \"var lastUrl = window.location.href;\")
content = content.replace(\"if (window.location.hash !== lastHash)\", \"if (window.location.href !== lastUrl)\")
content = content.replace(\"lastHash = window.location.hash;\", \"lastUrl = window.location.href;\")

with open('apollo.js', 'w', encoding='utf-8') as f:
    f.write(content)
