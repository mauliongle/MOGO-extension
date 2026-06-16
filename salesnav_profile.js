/**
 * MOGO Sales Navigator Profile Content Script
 * Extracts profile data from LinkedIn Sales Navigator lead pages.
 * Compatible with Chrome 80+ (Windows 7 support via Chrome 109).
 */

// Connect to background with the correct port name
const snPort = chrome.runtime.connect({ name: "content_script" });
console.log("[MOGO] Sales Navigator content script loaded");

const snDomainBlacklist = [
    'linktr.ee',
    'bit.ly',
    'cutt.ly',
    't.ly',
    'ow.ly',
    'facebook.com',
    'linkedin.com',
    'instagram.com',
	'amazon.com'
];

// Handle messages from the background script
snPort.onMessage.addListener(function(msg) {
  // Reserved for future use
});

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	console.log("[MOGO] Message received in SN content script:", msg);
	if (msg && msg.msg === 'page_loaded') {
		// Wait for the experience section to load — try multiple selectors
		waitForAnyElm([
			"#scroll-to-experience-section ul",
			"section.experience ul",
			"[data-x--experience] ul",
			".experience-section ul",
			"section[data-sn-view-name='profile-experience'] ul",
			"artdeco-card section ul"
		], 10000).then(function() {
			var base = getProfileBase();
			getRemainingProfile(base);
		}).catch(function() {
			// Even if experience section never loads, still try to get basic profile
			console.warn("[MOGO] Experience section not found, extracting basic profile");
			var base = getProfileBase();
			if (base && base.name) {
				getRemainingProfile(base);
			}
		});
  }
});


function fetchCompanyWebsite(companyId) {
	return fetch('https://www.linkedin.com/voyager/api/entities/companies/' + companyId, { 
		method: 'get', 
		headers: new Headers({
			'csrf-token': getCookie('JSESSIONID').replaceAll('"', ''),
			'Accept': 'application/json',
    		'Content-Type': 'application/json'
		})
	})
	.then(function(x) { return x.json(); })
	.then(function(x) { return { 
		website: x.websiteUrl,
		name: x.basicCompanyInfo ? x.basicCompanyInfo.miniCompany.name : undefined,
		universalName: x.basicCompanyInfo ? x.basicCompanyInfo.miniCompany.universalName : undefined
 	}; });
}

function getCookie(name) {
	var value = '; ' + document.cookie;
	var parts = value.split('; ' + name + '=');
	if (parts.length === 2) return parts.pop().split(';').shift();
	return '';
}

/**
 * Wait for any of multiple selectors to appear (robust against DOM changes)
 */
function waitForAnyElm(selectors, timeout) {
    timeout = timeout || 8000;
    return new Promise(function(resolve, reject) {
        // Check if any selector already exists
        for (var i = 0; i < selectors.length; i++) {
            if (document.querySelector(selectors[i])) {
                return resolve(document.querySelector(selectors[i]));
            }
        }

        var timer = setTimeout(function() {
            observer.disconnect();
            reject(new Error('Timeout waiting for elements'));
        }, timeout);

        var observer = new MutationObserver(function() {
            for (var i = 0; i < selectors.length; i++) {
                if (document.querySelector(selectors[i])) {
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve(document.querySelector(selectors[i]));
                    return;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

/**
 * Legacy waitForElm for backward compatibility
 */
function waitForElm(selector) {
    return new Promise(function(resolve) {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        var observer = new MutationObserver(function() {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function init() {
	console.log("[MOGO] SN Profile init");
	// Try multiple selectors for the profile photo — SN DOM changes frequently
	waitForAnyElm([
		'#profile-card-section img[data-anonymize="headshot-photo"]',
		'.profile-card img[data-anonymize="headshot-photo"]',
		'[data-x--profile-photo] img',
		'.artdeco-entity-image',
		'img.profile-photo',
		'.profile-topcard img'
	], 8000).then(function() {
		setTimeout(function() {
			var base = null;
			try {
				var codeEl = document.evaluate("//code[contains(text(),'birthDateOn')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
				if (codeEl) {
					var jsonData = JSON.parse(codeEl.innerText);
					console.log("[MOGO] Found JSON data:", jsonData);
					base = processJson(jsonData);
				}
			}
			catch(e) {
				console.log("[MOGO] JSON extraction failed, using DOM fallback:", e);
			}
			if (!base) {
				base = getProfileBase();
			}
			console.log("[MOGO] Profile base:", base);
			if (base && base.name) {
				getRemainingProfile(base);
			} else {
				console.warn("[MOGO] Could not extract profile name");
			}
		}, 1500);
	}).catch(function() {
		// Even if photo doesn't load, try to get the profile
		console.warn("[MOGO] Profile photo not found, trying name-based extraction");
		setTimeout(function() {
			var base = getProfileBase();
			if (base && base.name) {
				getRemainingProfile(base);
			}
		}, 2000);
	});
}

function processJson(jsonData) {
	if (!jsonData || !jsonData.included) return null;
	var element = null;
	for (var i = 0; i < jsonData.included.length; i++) {
		var el = jsonData.included[i];
		if (el.entityUrn && el.entityUrn.indexOf('urn:li:fsd_profile:') > -1 && el.premium !== undefined) {
			element = el;
			break;
		}
	}
	if (element) {
		console.log("[MOGO] Found profile element:", element);
		var profilePicture = null;
		try {
			profilePicture = element.profilePicture.displayImageReference.vectorImage.rootUrl + element.profilePicture.displayImageReference.vectorImage.artifacts[0].fileIdentifyingUrlPathSegment;
		}
		catch(e) {
			profilePicture = '/icons/no_profile.svg';
		}
		var first = element.firstName;
		var last = element.lastName;
		return {
			name: first + ' ' + last,
			picture: profilePicture
		};
	}
	return null;
}

function getProfileBase() {
	console.log("[MOGO] getProfileBase");
	var name = '';
	var picture = null;

	// Try multiple name selectors — SN DOM changes frequently
	var nameSelectors = [
		'h1[data-anonymize="person-name"]',
		'.profile-topcard-person-entity__name',
		'.artdeco-entity-lockup__title',
		'[data-x--lead-name]',
		'.profile-card h1',
		'.lead-details h1',
		'h1.profile-topcard__name'
	];

	for (var i = 0; i < nameSelectors.length; i++) {
		try {
			var el = document.querySelector(nameSelectors[i]);
			if (el && el.innerText && el.innerText.trim()) {
				name = el.innerText.split(',')[0].replace(/\([^)]+\)/g, '').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s\-]/gi, '').trim();
				if (name) break;
			}
		} catch(e) { /* continue to next selector */ }
	}

	// Try multiple picture selectors
	var picSelectors = [
		'#profile-card-section img[data-anonymize="headshot-photo"]',
		'.profile-card img[data-anonymize="headshot-photo"]',
		'.profile-topcard img.profile-photo',
		'.artdeco-entity-image',
		'[data-x--profile-photo] img'
	];

	for (var j = 0; j < picSelectors.length; j++) {
		try {
			var picEl = document.querySelector(picSelectors[j]);
			if (picEl) {
				picture = picEl.getAttribute('src');
				if (picture) break;
			}
		} catch(e) { /* continue */ }
	}

	return {
		name: name,
		picture: picture
	}; 
}

function extractRootDomain(url) {
    var domain = extractHostname(url),
    splitArr = domain.split('.'),
    arrLen = splitArr.length;
  
    if (arrLen > 2) {
      domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
      if (splitArr[arrLen - 2].length <= 3 && splitArr[arrLen - 1].length == 2) {
        domain = splitArr[arrLen - 3] + '.' + domain;
      }
    }
    return domain;
  }

  function extractHostname(url) {
    var hostname;
  
    if (url.indexOf("//") > -1) {
      hostname = url.split('/')[2];
    } else {
      hostname = url.split('/')[0];
    }
  
    hostname = hostname.split(':')[0];
    hostname = hostname.split('?')[0];
  
    return hostname;
  }

function getRemainingProfile(base) {
	var companyId = null;
	var domain = null;
	var companyName = null;
	var title = null;
	var pageUrl = window.location.href;

	// Try multiple selectors for the experience section company link
	var companyLinkSelectors = [
		"#experience-section li a",
		"section.experience li a",
		"[data-x--experience] a[href*='company']",
		"#scroll-to-experience-section a[href*='company']",
		".experience-section a[href*='company']",
		"a[href*='/sales/company/']"
	];

	for (var s = 0; s < companyLinkSelectors.length; s++) {
		try {
			var links = document.querySelectorAll(companyLinkSelectors[s]);
			var linkArr = [];
			for (var li = 0; li < links.length; li++) { linkArr.push(links[li].href); }
			var companyLinks = linkArr.filter(function(x) { return x.indexOf('company') > -1; });
			if (companyLinks.length > 0) {
				companyId = companyLinks[0].split('/company/')[1];
				if (companyId) companyId = companyId.replace('/', '').split('?')[0];
				if (companyId) break;
			}
		}
		catch(e) { /* continue to next selector */ }
	}

	// Try multiple selectors for job title
	var titleSelectors = [
		"#experience-section li h2",
		"section.experience li h2",
		"[data-x--experience] h2",
		".experience-section h2",
		".profile-topcard__summary-position",
		".profile-topcard-person-entity__position"
	];

	for (var t = 0; t < titleSelectors.length; t++) {
		try {
			var titleEl = document.querySelector(titleSelectors[t]);
			if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
				title = titleEl.textContent.trim();
				break;
			}
		} catch(e) { /* continue */ }
	}

	if (companyId !== null) {
		fetchCompanyWebsite(companyId)
			.then(function(company) {
				if (typeof company.name !== 'undefined') {
					companyName = company.name;
				}
				if (typeof company.website !== 'undefined') {
					domain = company.website;
					var msg = { 
						msg: 'linkedin_profile', 
						profile: {
							name : base.name,
							picture: base.picture, 
							domain: domain,
							company: companyName, 
							linkedin_url: pageUrl, 
							job_title: title
						}
					};
					chrome.runtime.sendMessage(msg);
				}
				else {
					var company_universal_name = (typeof company.universalName !== 'undefined') ? company.universalName : '';
					if (company_universal_name != '') {
						fetchCompanyAboutPage(company_universal_name).then(
							function(page) {
								var websiteRegex = /&quot;websiteUrl&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;headquarter/gmi.exec(page);
								if (websiteRegex === null) {
									websiteRegex = /&quot;url&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;\$type&quot;:&quot;com.linkedin.voyager.dash.organization.CallToAction&quot;/gmi.exec(page);
								}
								if (websiteRegex != null && websiteRegex.groups && websiteRegex.groups.websiteUrl) { 
									var cleanedUrl =  extractRootDomain(websiteRegex.groups.websiteUrl).toLowerCase();
									domain = cleanedUrl;
								}
								var isBlacklisted = typeof domain === 'string' && snDomainBlacklist.some(function(str) { return domain.indexOf(str) > -1; });
								if (isBlacklisted) {
									domain = '';
								}
								chrome.runtime.sendMessage(
									{ 
										msg: 'linkedin_profile', 
										profile: {
											name : base.name,
											picture: base.picture, 
											domain: domain,
											company: companyName, 
											linkedin_url: pageUrl, 
											job_title: title
										}
									});
							}
						);
					}
					else {
						// Fallback: try to get company name from DOM
						companyName = getCompanyNameFromDOM();
						chrome.runtime.sendMessage(
							{ 
								msg: 'linkedin_profile', 
								profile: {
									name : base.name,
									picture: base.picture, 
									domain: companyName,
									company: companyName, 
									linkedin_url: pageUrl, 
									job_title: title
								}
							});
					}
				}
			})
			.catch(function(e) {
				console.error("[MOGO] Error fetching company:", e);
				companyName = getCompanyNameFromDOM();
				chrome.runtime.sendMessage(
					{ 
						msg: 'linkedin_profile', 
						profile: {
							name : base.name,
							picture: base.picture, 
							domain: companyName,
							company: companyName, 
							linkedin_url: pageUrl, 
							job_title: title
						}
					});
			});
	}
	else {
		// No company link found — try extracting company from DOM text
		companyName = getCompanyNameFromDOM();
		chrome.runtime.sendMessage(
			{ 
				msg: 'linkedin_profile', 
				profile: {
					name : base.name,
					picture: base.picture, 
					domain:  companyName, 
					linkedin_url: pageUrl, 
					company: companyName, 
					job_title: title
				}
			});
	}
}

/**
 * Fallback: extract company name from various DOM locations
 */
function getCompanyNameFromDOM() {
	var selectors = [
		'h2.hoverable-link-text',
		'button > span.hoverable-link-text',
		'.profile-topcard__summary-position-company',
		'.profile-topcard-person-entity__company',
		'[data-x--company-name]',
		'.pvs-entity .t-14.t-normal span:not(.visually-hidden)',
		'a[data-control-name="topcard_company_url"]'
	];

	for (var i = 0; i < selectors.length; i++) {
		try {
			var el = document.querySelector(selectors[i]);
			if (el && el.innerText && el.innerText.trim()) {
				var text = el.innerText.split('·')[0].replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.\-]/gi, '').trim();
				if (text) return text;
			}
		} catch(e) { /* continue */ }
	}
	return null;
}

function fetchCompanyAboutPage(companyId) {
    return fetch('https://www.linkedin.com/company/' + companyId + '/about/', {
        method: 'get',
        headers: new Headers({
            'csrf-token': getCookie('JSESSIONID').replaceAll('"', ''),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        })
    })
        .then(function (x) { return x.text(); });
}

if (window.location.href.indexOf("/sales/lead/") > -1 || window.location.href.indexOf("/sales/people/") > -1) {
	init();
}
