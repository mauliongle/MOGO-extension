(function() {
    function processSalesData(r) {
        try {
            var jsonProfiles, allProfiles, accountObject, userObject;
            var e, t, o, s, a, i; // Placeholder for variables in original logic
            
            // These would normally be populated by the extension's config injected earlier,
            // but for safety we'll initialize them if undefined to prevent errors.
            if (typeof e === 'undefined') e = [];
            if (typeof t === 'undefined') t = [];
            if (typeof o === 'undefined') o = [];
            if (typeof s === 'undefined') s = [];
            if (typeof a === 'undefined') a = [];
            if (typeof i === 'undefined') i = null;

            if (r.url.indexOf("salesApiProfiles") !== -1 || r.url.indexOf("salesApiLeadSearch") !== -1) {
                jsonProfiles = JSON.parse(r.data);
                allProfiles = [];
                
                if (jsonProfiles.elements) {
                    jsonProfiles.elements.forEach(function(profile) {
                        userObject = {};
                        userObject.company_size = "";
                        userObject.domain = "";
                        userObject.founded = "";
                        userObject.industry = "";
                        userObject.job_title = "";
                        userObject.linkedin_id = "";
                        userObject.past_company = "";
                        userObject.rewards = "";
                        userObject.skills = "";
                        userObject.type = "";
                        userObject.user__summary__experience = "";
                        userObject.user_city = "";
                        userObject.user_company_id = "";
                        userObject.user_company_name = "";
                        userObject.user_first_name = "";
                        userObject.user_keywords = "";
                        userObject.user_last_name = "";
                        userObject.user_number_connections = "";
                        userObject.user_other_email = "";
                        userObject.user_profile_picture = "";
                        userObject.user_source = "linkedin";
                        userObject.user_summary = profile.summary || "";
                        userObject.user_url = "";
                        userObject.vcard = "";
                        userObject.website = "";
                        userObject.job_title_match = "";
                        userObject.industry_match = "";
                        userObject.keyword_match = "";
                        userObject.open_link = "";
                        userObject.included_headcount = [];

                        let desc = "";

                        if (profile.currentPositions && profile.currentPositions.companyName) {
                            userObject.user_company_name = cleanCompanyName(profile.currentPositions.companyName);
                        }
                        if (profile.currentPositions && profile.currentPositions.companyUrn) {
                            userObject.user_company_id = extractIdNewLinkedinCompany(profile.currentPositions.companyUrn);
                        }
                        if (profile.geoRegion) {
                            userObject.user_city = profile.geoRegion;
                        }
                        if (profile.currentPositions && profile.currentPositions.title) {
                            userObject.job_title = unescapeHtml(profile.currentPositions.title);
                        }
                        if (profile.firstName) {
                            userObject.user_first_name = cleanName(profile.firstName);
                        }
                        if (profile.lastName) {
                            userObject.user_last_name = cleanName(profile.lastName);
                        }
                        if (profile.objectUrn) {
                            userObject.linkedin_id = extractIdNewLinkedin(profile.objectUrn);
                        }
                        if (profile.openLink !== undefined) {
                            userObject.open_link = profile.openLink === true ? "YES" : "NO";
                        }
                        if (profile.premium !== undefined) {
                            userObject.premium = profile.premium === true ? "YES" : "NO";
                        }
                        if (profile.degree !== undefined) {
                            userObject.degree = profile.degree;
                        }

                        let companyNameSearch = "";
                        if (profile.currentPositions && profile.currentPositions.companyName) {
                            companyNameSearch = profile.currentPositions.companyName;
                        }

                        if (profile.currentPositions && profile.currentPositions.length > 0) {
                            for (let c = 0; c < profile.currentPositions.length; c++) {
                                let pos = profile.currentPositions[c];
                                if (pos.current === true) {
                                    if (pos.title) userObject.job_title = unescapeHtml(pos.title);
                                    if (pos.companyName) {
                                        userObject.user_company_name = cleanCompanyName(pos.companyName);
                                        companyNameSearch = pos.companyName;
                                    }
                                    if (pos.description) desc = pos.description;
                                    if (pos.tenureAtPosition) {
                                        userObject.lead_years_position = pos.tenureAtPosition.numYears;
                                        userObject.lead_months_position = pos.tenureAtPosition.numMonths;
                                    }
                                    if (pos.tenureAtCompany) {
                                        userObject.lead_years_company = pos.tenureAtCompany.numYears;
                                        userObject.lead_months_company = pos.tenureAtCompany.numMonths;
                                    }
                                    if (pos.startedOn) {
                                        userObject.lead_position_started_month = pos.startedOn.month;
                                        userObject.lead_position_started_year = pos.startedOn.year;
                                    }
                                    if (pos.companyUrn) {
                                        userObject.user_company_id = extractIdNewLinkedinCompany(pos.companyUrn);
                                    }
                                    if (pos.companyUrnResolutionResult && pos.companyUrnResolutionResult.industry) {
                                        userObject.industry = pos.companyUrnResolutionResult.industry;
                                    }
                                    
                                    // Title filtering logic omitted for simplicity since this usually runs in extension context
                                    // However, original had filtering logic here. We preserve structure.
                                }
                            }
                        }

                        if (profile.entityUrn) {
                            userObject.user_url = profile.entityUrn.toString().replace("urn:li:fs_salesProfile:(", "https://www.linkedin.com/sales/people/");
                            userObject.user_url = userObject.user_url.replace(",ibn_)", "").replace(")", "");
                        }

                        allProfiles.push(userObject);
                    });
                }
                
                window.FINDYMAIL_PROFILES = allProfiles;
                let elem = document.getElementById("findymail-profiles");
                if (elem) {
                    elem.textContent = JSON.stringify(allProfiles);
                } else {
                    elem = document.createElement("div");
                    elem.id = "findymail-profiles";
                    elem.style.cssText = "display:none;";
                    elem.textContent = JSON.stringify(allProfiles);
                    (document.body || document.documentElement).appendChild(elem);
                }
            }

            if (r.url.indexOf("salesApiAccountSearch") !== -1) {
                jsonProfiles = JSON.parse(r.data);
                allProfiles = [];
                
                if (jsonProfiles.elements) {
                    jsonProfiles.elements.forEach(function(account) {
                        accountObject = {};
                        accountObject.saved = account.saved;
                        accountObject.companyName = account.companyName;
                        accountObject.description = account.description;
                        accountObject.industry = account.industry;
                        accountObject.employeeCountRange = account.employeeCountRange ? account.employeeCountRange.replace(" employees", "") : "";
                        accountObject.employeeDisplayCount = account.employeeDisplayCount;
                        accountObject.entityUrn = account.entityUrn;
                        accountObject.companyId = account.entityUrn ? account.entityUrn.replace("urn:li:fs_salesCompany:", "") : "";
                        allProfiles.push(accountObject);
                    });
                }
                
                let elem = document.getElementById("findymail-profiles");
                if (elem) {
                    elem.textContent = JSON.stringify(allProfiles);
                } else {
                    elem = document.createElement("div");
                    elem.id = "findymail-profiles";
                    elem.style.cssText = "display:none;";
                    elem.textContent = JSON.stringify(allProfiles);
                    (document.body || document.documentElement).appendChild(elem);
                }
            }
            
            // Dispatch to extension
            document.dispatchEvent(new CustomEvent("datachannel", { detail: r }));

        } catch (err) {
            console.error("MOGO Interceptor Error:", err);
        }
    }

    // --- Helper Functions ---
    function cleanCompanyName(e) {
        if (!e) return "";
        return e.replace(", Inc.", "").replace(" Inc.", "").replace(" Inc", "")
                .replace(" LLC", "").replace(", LLC", "").trim()
                .replace("<b>", "").replace("</b>", "")
                .replace("&lt;b&gt;", "").replace("&lt;/b&gt;", "").replace(", INC.", "");
    }
    
    function extractIdNewLinkedinCompany(e) {
        if (!e) return "";
        return e.replace("urn:li:fs_salesCompany:", "");
    }
    
    function extractIdNewLinkedin(e) {
        if (!e) return "";
        return e.replace("urn:li:member:", "");
    }
    
    function cleanName(e) {
        if (!e) return "";
        if (e.indexOf(",") > -1) {
            e = e.split(",")[0];
        }
        return e;
    }
    
    function unescapeHtml(e) {
        var t = document.createElement("DIV");
        t.innerHTML = e;
        var res = t.textContent || t.innerText || "";
        res = res.replace(/<(?:.|\n)*?>/gm, "");
        return res;
    }

    // --- XHR Interceptor ---
    var XHR = XMLHttpRequest.prototype;
    var open = XHR.open;
    var send = XHR.send;
    
    XHR.open = function(method, url) {
        this._method = method;
        this._url = url;
        return open.apply(this, arguments);
    };
    
    XHR.send = function(postData) {
        this.addEventListener('load', function() {
            if (this._url && (this._url.indexOf("salesApiAccountSearch") !== -1 || this._url.indexOf("salesApiLeadSearch") !== -1 || this._url.indexOf("salesApiProfiles") !== -1)) {
                var xhr = this;
                var blob = this.response; // response is a Blob when responseType = 'blob'
                if (blob && blob instanceof Blob) {
                    var reader = new FileReader();
                    reader.onload = function() {
                        processSalesData({
                            url: xhr._url,
                            method: xhr._method,
                            data: reader.result,   // text content read from blob
                            postData: postData
                        });
                    };
                    reader.readAsText(blob);
                } else {
                    // Fallback to responseText if blob is not available
                    processSalesData({
                        url: this._url,
                        method: this._method,
                        data: this.responseText,
                        postData: postData
                    });
                }
            }
        });
        this.responseType = 'blob'; // Set blob type before sending
        return send.apply(this, arguments);
    };

    // --- Fetch Interceptor ---
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        
        let url = "";
        let method = "GET";
        let postData = null;
        
        if (args[0] instanceof Request) {
            url = args[0].url;
            method = args[0].method;
        } else {
            url = args[0];
            if (args[1]) {
                method = args[1].method || "GET";
                postData = args[1].body;
            }
        }
        
        if (url && (url.indexOf("salesApiAccountSearch") !== -1 || url.indexOf("salesApiLeadSearch") !== -1 || url.indexOf("salesApiProfiles") !== -1)) {
            // Clone response so the original page can still consume it
            response.clone().text().then(text => {
                processSalesData({
                    url: url,
                    method: method,
                    data: text,
                    postData: postData
                });
            }).catch(e => console.error("MOGO Fetch Clone Error:", e));
        }
        
        return response;
    };

})();
