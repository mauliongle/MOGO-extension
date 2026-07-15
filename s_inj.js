(function() {
    function processSalesData(r) {
        try {
            // Guard: skip if no data
            if (!r || !r.data || typeof r.data !== 'string' || r.data.trim() === '') return;

            var jsonProfiles, allProfiles, accountObject, userObject;

            if (r.url.indexOf("salesApiProfiles") !== -1 || r.url.indexOf("salesApiLeadSearch") !== -1) {
                jsonProfiles = JSON.parse(r.data);
                allProfiles = [];

                if (jsonProfiles.elements) {
                    jsonProfiles.elements.forEach(function(profile) {
                        userObject = {};
                        userObject.company_size       = "";
                        userObject.domain             = "";
                        userObject.founded            = "";
                        userObject.industry           = "";
                        userObject.job_title          = "";
                        userObject.linkedin_id        = "";
                        userObject.past_company       = "";
                        userObject.rewards            = "";
                        userObject.skills             = "";
                        userObject.type               = "";
                        userObject.user__summary__experience = "";
                        userObject.user_city          = "";
                        userObject.user_company_id    = "";
                        userObject.user_company_name  = "";
                        userObject.user_first_name    = "";
                        userObject.user_keywords      = "";
                        userObject.user_last_name     = "";
                        userObject.user_number_connections = "";
                        userObject.user_other_email   = "";
                        userObject.user_profile_picture = "";
                        userObject.user_source        = "linkedin";
                        userObject.user_summary       = profile.summary || "";
                        userObject.user_url           = "";
                        userObject.vcard              = "";
                        userObject.website            = "";
                        userObject.job_title_match    = "";
                        userObject.industry_match     = "";
                        userObject.keyword_match      = "";
                        userObject.open_link          = "";
                        userObject.included_headcount = [];

                        // Basic fields
                        if (profile.firstName) userObject.user_first_name = cleanName(profile.firstName);
                        if (profile.lastName)  userObject.user_last_name  = cleanName(profile.lastName);
                        if (profile.geoRegion) userObject.user_city = profile.geoRegion;
                        if (profile.objectUrn) userObject.linkedin_id = extractIdNewLinkedin(profile.objectUrn);

                        if (profile.openLink !== undefined) {
                            userObject.open_link = profile.openLink === true ? "YES" : "NO";
                        }
                        if (profile.premium !== undefined) {
                            userObject.premium = profile.premium === true ? "YES" : "NO";
                        }
                        if (profile.degree !== undefined) {
                            userObject.degree = profile.degree;
                        }

                        // BUG FIX: currentPositions is ALWAYS an array in LinkedIn API.
                        // Previous code wrongly treated it as an object on lines 56-90.
                        // Now we only use the array iteration path.
                        if (Array.isArray(profile.currentPositions) && profile.currentPositions.length > 0) {
                            for (var c = 0; c < profile.currentPositions.length; c++) {
                                var pos = profile.currentPositions[c];
                                // Use the first position with current=true, fallback to first element
                                if (pos.current === true || c === 0) {
                                    if (pos.title) userObject.job_title = unescapeHtml(pos.title);
                                    if (pos.companyName) {
                                        userObject.user_company_name = cleanCompanyName(pos.companyName);
                                    }
                                    if (pos.description) userObject.user_summary = pos.description || userObject.user_summary;
                                    if (pos.tenureAtPosition) {
                                        userObject.lead_years_position  = pos.tenureAtPosition.numYears;
                                        userObject.lead_months_position = pos.tenureAtPosition.numMonths;
                                    }
                                    if (pos.tenureAtCompany) {
                                        userObject.lead_years_company  = pos.tenureAtCompany.numYears;
                                        userObject.lead_months_company = pos.tenureAtCompany.numMonths;
                                    }
                                    if (pos.startedOn) {
                                        userObject.lead_position_started_month = pos.startedOn.month;
                                        userObject.lead_position_started_year  = pos.startedOn.year;
                                    }
                                    if (pos.companyUrn) {
                                        userObject.user_company_id = extractIdNewLinkedinCompany(pos.companyUrn);
                                    }
                                    if (pos.companyUrnResolutionResult && pos.companyUrnResolutionResult.industry) {
                                        userObject.industry = pos.companyUrnResolutionResult.industry;
                                    }
                                    // Stop at first current position found
                                    if (pos.current === true) break;
                                }
                            }
                        }

                        // BUG FIX: entityUrn format is "urn:li:fs_salesProfile:(ID,ACCOUNT,ibn_)"
                        // Old replace(",ibn_)") missed variants like ",NAME_)" or just ")"
                        // Now use a regex to cleanly strip the trailing metadata.
                        if (profile.entityUrn) {
                            var urn = profile.entityUrn.toString();
                            userObject.user_url = urn
                                .replace("urn:li:fs_salesProfile:(", "https://www.linkedin.com/sales/people/")
                                .replace(/,[^,)]*\)$/, ""); // strip trailing ",anything)" cleanly
                        }

                        allProfiles.push(userObject);
                    });
                }

                // Inject profiles into DOM for linkedin.js to read
                window.FINDYMAIL_PROFILES = allProfiles;
                var elem = document.getElementById("findymail-profiles");
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
                        accountObject.saved               = account.saved;
                        accountObject.companyName         = account.companyName;
                        accountObject.description         = account.description;
                        accountObject.industry            = account.industry;
                        accountObject.employeeCountRange  = account.employeeCountRange
                            ? account.employeeCountRange.replace(" employees", "") : "";
                        accountObject.employeeDisplayCount = account.employeeDisplayCount;
                        accountObject.entityUrn           = account.entityUrn;
                        accountObject.companyId           = account.entityUrn
                            ? account.entityUrn.replace("urn:li:fs_salesCompany:", "") : "";
                        allProfiles.push(accountObject);
                    });
                }

                var elemAcc = document.getElementById("findymail-profiles");
                if (elemAcc) {
                    elemAcc.textContent = JSON.stringify(allProfiles);
                } else {
                    elemAcc = document.createElement("div");
                    elemAcc.id = "findymail-profiles";
                    elemAcc.style.cssText = "display:none;";
                    elemAcc.textContent = JSON.stringify(allProfiles);
                    (document.body || document.documentElement).appendChild(elemAcc);
                }
            }

        } catch (err) {
            console.error("MOGO Interceptor Error:", err);
        }
    }

    // --- Helper Functions ---
    function cleanCompanyName(e) {
        if (!e) return "";
        return e.replace(/, Inc\.|, LLC|, Ltd|, LTD|, INC\.| Inc\.| Inc| LLC| Ltd| LTD| GmbH| INC\./g, "")
                .replace(/<\/?b>/g, "")
                .replace(/&lt;b&gt;|&lt;\/b&gt;/g, "")
                .replace(/,/g, "").trim();
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
        // Strip suffixes after comma (e.g. "Smith, PhD")
        if (e.indexOf(",") > -1) e = e.split(",")[0];
        return e.trim();
    }

    function unescapeHtml(e) {
        if (!e) return "";
        var t = document.createElement("DIV");
        t.innerHTML = e;
        var res = t.textContent || t.innerText || "";
        // Strip any remaining HTML tags
        res = res.replace(/<[^>]*>/gm, "");
        return res.trim();
    }

    // --- XHR Interceptor ---
    var XHR = XMLHttpRequest.prototype;
    var open = XHR.open;
    var send = XHR.send;

    XHR.open = function(method, url) {
        this._method = method;
        this._url    = url;
        return open.apply(this, arguments);
    };

    XHR.send = function(postData) {
        var self = this;
        this.addEventListener('load', function() {
            try {
                if (self._url && (
                    self._url.indexOf("salesApiAccountSearch") !== -1 ||
                    self._url.indexOf("salesApiLeadSearch")    !== -1 ||
                    self._url.indexOf("salesApiProfiles")      !== -1
                )) {
                    processSalesData({
                        url:      self._url,
                        method:   self._method,
                        data:     self.responseText,
                        postData: postData
                    });
                }
            } catch (e) {
                console.error("MOGO XHR load handler error:", e);
            }
        });
        this.responseType = 'text';
        return send.apply(this, arguments);
    };

    // --- Fetch Interceptor ---
    // BUG FIX: wrapped in try/catch so a network error doesn't break page fetch calls
    var originalFetch = window.fetch;
    window.fetch = async function() {
        var args = Array.prototype.slice.call(arguments);
        var response;
        try {
            response = await originalFetch.apply(window, args);
        } catch (networkErr) {
            // Re-throw so the page still gets the network error
            throw networkErr;
        }

        try {
            var url = "";
            var method = "GET";
            var postData = null;

            if (args[0] instanceof Request) {
                url    = args[0].url;
                method = args[0].method;
            } else {
                url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].toString ? args[0].toString() : "");
                if (args[1]) {
                    method   = args[1].method || "GET";
                    postData = args[1].body || null;
                }
            }

            if (url && (
                url.indexOf("salesApiAccountSearch") !== -1 ||
                url.indexOf("salesApiLeadSearch")    !== -1 ||
                url.indexOf("salesApiProfiles")      !== -1
            )) {
                // Clone so the original page can still consume the response body
                response.clone().text().then(function(text) {
                    processSalesData({ url: url, method: method, data: text, postData: postData });
                }).catch(function(e) {
                    console.error("MOGO Fetch Clone Error:", e);
                });
            }
        } catch (interceptErr) {
            console.error("MOGO Fetch Interceptor Error:", interceptErr);
            // Do NOT rethrow — return the real response to the page regardless
        }

        return response;
    };

})();
