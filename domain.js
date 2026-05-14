setInterval(() => {
	chrome.runtime.sendMessage({type: 'domain', domain: window.location.hostname})
}, 500);