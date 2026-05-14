const snPort = chrome.runtime.connect({ name: "sn_content_script" });
console.log("content script loaded");

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
snPort.onMessage.addListener((msg) => {
  
});

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	console.log("Message received in content script:", msg);
	if (msg && msg.msg === 'page_loaded') {
		waitForElm("#scroll-to-experience-section ul").then(() => {
			let base = getProfileBase();
			//console.log(base);
			getRemainingProfile(base);
	})
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
	.then(function(x) { return x.json() })
	.then(function(x) { return { 
		website: x.websiteUrl,
		name: x.basicCompanyInfo.miniCompany.name,
		universalName: x.basicCompanyInfo.miniCompany.universalName
		/*employeeCountRange + industries*/
 	}})
}

function getCookie(name) {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
}

function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
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
	console.log("init");
	waitForElm('#profile-card-section img[data-anonymize="headshot-photo"]').then(() => {
		setTimeout(() => {
			let base = null;
			try {
				let jsonData = JSON.parse(document.evaluate("//code[contains(text(),'birthDateOn')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.innerText);
				console.log(jsonData);
				base = processJson(jsonData);
			}
			catch {
				base = getProfileBase();
			}
			console.log(base);
			getRemainingProfile(base);
		}, 1000)
	})
}

function processJson(jsonData) {
	let element = jsonData.included.find(element => element.entityUrn.includes('urn:li:fsd_profile:') && element.premium !== undefined)
	if (element) {
		console.log(element);
		let profilePicture = null;
		try {
			profilePicture = element.profilePicture.displayImageReference.vectorImage.rootUrl + element.profilePicture.displayImageReference.vectorImage.artifacts[0].fileIdentifyingUrlPathSegment;
		}
		catch {
			profilePicture = '/icons/no_profile.svg';
		}
		let first = element.firstName;
		let last = element.lastName;
		return {
			name: first + ' ' + last,
			picture: profilePicture
		}
	}
	return null
}

function getProfileBase() {
	console.log("getProfileBase");
	let name = document.querySelector('h1[data-anonymize="person-name"]').innerText.split(',')[0].replace(/\([^)]+\)/g, '').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s\-]/gi, '');
	let picture = null;
	try {
		picture = document.querySelector('#profile-card-section img[data-anonymize="headshot-photo"]').getAttribute('src');
	}
	catch (e) { console.error(e); }
	return {
		name: name,
		picture: picture
	} 
}

function extractRootDomain(url) {
    var domain = extractHostname(url),
    splitArr = domain.split('.'),
    arrLen = splitArr.length;
  
    if (arrLen > 2) {
      domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
      //check to see if it's using a Country Code Top Level Domain (ccTLD) (i.e. ".me.uk")
      if (splitArr[arrLen - 2].length <= 3 && splitArr[arrLen - 1].length == 2) {
        //this is using a ccTLD
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
	let companyId = null;
	let domain = null;
	let companyName = null;
	let title = null;
	try {
		companyId = [...document.querySelectorAll("#experience-section li a")].map(x => x.href).filter(x => x.includes('company'))[0].split('/company/')[1].replace('/', '');
	}
	catch {
		companyId = null;
	}
	try {
		title = document.getElementById('experience-section').querySelector("li h2").textContent.trim();
	}
	catch {

	}
	if (companyId !== null) {
		fetchCompanyWebsite(companyId)
			.then(function(company) {
				if (typeof company.name !== 'undefined') {
					companyName = company.name;
				}
				if (typeof company.website !== 'undefined') {
					domain = company.website;
					let msg = { 
						msg: 'linkedin_profile', 
						profile: {
							name : base.name,
							picture: base.picture, 
							domain: domain,
							company: companyName, 
							linkedin_url: currentPage, 
							job_title: title
						}
					}
					chrome.runtime.sendMessage(msg)
				}
				else {
					let company_universal_name = (typeof company.universalName !== 'undefined') ? company.universalName : '';
					if (company_universal_name != '') {
						fetchCompanyAboutPage(company_universal_name).then(
							page => {
								let websiteRegex = /&quot;websiteUrl&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;headquarter/gmi.exec(page)
								if (websiteRegex === null) {
									websiteRegex = /&quot;url&quot;:&quot;(?<websiteUrl>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))&quot;,&quot;\$type&quot;:&quot;com.linkedin.voyager.dash.organization.CallToAction&quot;/gmi.exec(page);
								}
								if (websiteRegex != null && websiteRegex.groups.websiteUrl) { 
									let cleanedUrl =  extractRootDomain(websiteRegex.groups.websiteUrl).toLowerCase();
									domain = cleanedUrl;
								}
								let isBlacklisted = typeof company_domain === 'string' && snDomainBlacklist.some(str => domain.includes(str));
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
											linkedin_url: currentPage, 
											job_title: title
										}
									})
							}
						)
					}
					else {
						try {
							domain = document.querySelectorAll('h2.hoverable-link-text')[0].innerText.replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '')
						}
						catch {
							try {
								domain = document.querySelectorAll('button > span.hoverable-link-text')[0].innerText.replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '');
							}
							catch {
								domain = document.querySelector(".pvs-entity .t-14.t-normal span:not(.visually-hidden)").innerText.split('·')[0].replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '')
							}
						}
						chrome.runtime.sendMessage(
							{ 
								msg: 'linkedin_profile', 
								profile: {
									name : base.name,
									picture: base.picture, 
									domain: domain,
									company: companyName, 
									linkedin_url: currentPage, 
									job_title: title
								}
							})
					}
				}
			})
			.catch(function(e) {
				console.error(e)
				try {
					companyName = document.querySelectorAll('h2.hoverable-link-text')[0].innerText.replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '')
				}
				catch {
					try {
						companyName = document.querySelectorAll('button > span.hoverable-link-text')[0].innerText.replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '');
					}
					catch {
						companyName = document.querySelector(".pvs-entity .t-14.t-normal span:not(.visually-hidden)").innerText.split('·')[0].replace(/[^A-Z0-9a-zÀ-ÖØ-öø-ÿ\s\.-]/gi, '')
					}
				}
				chrome.runtime.sendMessage(
					{ 
						msg: 'linkedin_profile', 
						profile: {
							name : base.name,
							picture: base.picture, 
							domain: companyName,
							company: companyName, 
							linkedin_url: currentPage, 
							job_title: title
						}
					})
			})
	}
	else {
		chrome.runtime.sendMessage(
			{ 
				msg: 'linkedin_profile', 
				profile: {
					name : base.name,
					picture: base.picture, 
					domain:  null, 
					linkedin_url: currentPage, 
					company: null, 
					job_title: title
				}
			})
	}
}

function fetchCompanyAboutPage(companyId) {
    return fetch('https://www.linkedin.com/company/' + companyId + '/about/', {
        method: 'get',
        headers: new Headers({
            'csrf-token': getCookie('JSESSIONID').replaceAll('"', ''),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        })
    })
        .then(function (x) { return x.text() })
}

if (window.location.href.includes("/sales/lead/")) {
	init();
}

