(function() {
    // URL targets to intercept - matching Findymail reference implementation
    var urlTargets = [
        '/sales-api/salesApiProfiles',
        '/sales-api/salesApiPeopleSearch',
        '/sales-api/salesApiLeadSearch',
        '/sales-api/salesApiAccountSearch',
        '/sales/profile/',
        '/connected/api/v1/contacts',
        '/connected/api/v2/contacts',
        '/sales-api/salesApiMessagingThreads',
        '/voyager/api/',
        '/recruiter/api/smartsearch'
    ];

    function processSalesData(data, url) {
        try {
            if (!data || typeof data !== 'string' || data.trim() === '') return;

            var jsonProfiles, allProfiles, accountObject, userObject;

            if (url.indexOf('salesApiPeopleSearch') !== -1 || url.indexOf('salesApiLeadSearch') !== -1 || url.indexOf('salesApiProfiles') !== -1) {
                jsonProfiles = JSON.parse(data);
                allProfiles = [];

                if (jsonProfiles.elements && jsonProfiles.elements.length > 0) {
                    jsonProfiles.elements.forEach(function(profile) {
                        userObject = {};
                        userObject.company_size        = '';
                        userObject.domain              = '';
                        userObject.founded             = '';
                        userObject.industry            = '';
                        userObject.job_title           = '';
                        userObject.linkedin_id         = '';
                        userObject.past_company        = '';
                        userObject.rewards             = '';
                        userObject.skills              = '';
                        userObject.type                = '';
                        userObject.user__summary__experience = '';
                        userObject.user_city           = '';
                        userObject.user_company_id     = '';
                        userObject.user_company_name   = '';
                        userObject.user_first_name     = '';
                        userObject.user_keywords       = '';
                        userObject.user_last_name      = '';
                        userObject.user_number_connections = '';
                        userObject.user_other_email    = '';
                        userObject.user_profile_picture = '';
                        userObject.user_source         = 'linkedin';
                        userObject.user_summary        = profile.summary || '';
                        userObject.user_url            = '';
                        userObject.vcard               = '';
                        userObject.website             = '';
                        userObject.job_title_match     = '';
                        userObject.industry_match      = '';
                        userObject.keyword_match       = '';
                        userObject.open_link           = '';
                        userObject.included_headcount  = [];

                        // Single object access (some API versions return object not array)
                        if (profile.currentPositions && profile.currentPositions.companyName !== undefined) {
                            userObject.user_company_name = cleanCompanyName(profile.currentPositions.companyName);
                        }
                        if (profile.currentPositions && profile.currentPositions.companyUrn !== undefined) {
                            userObject.user_company_id = extractIdNewLinkedinCompany(profile.currentPositions.companyUrn);
                        }
                        if (profile.geoRegion !== undefined) userObject.user_city = profile.geoRegion;
                        if (profile.currentPositions && profile.currentPositions.title !== undefined) {
                            userObject.job_title = unescapeHtml(profile.currentPositions.title);
                        }
                        if (profile.firstName !== undefined) userObject.user_first_name = cleanName(profile.firstName);
                        if (profile.lastName !== undefined) userObject.user_last_name = cleanName(profile.lastName);
                        if (profile.objectUrn !== undefined) userObject.linkedin_id = extractIdNewLinkedin(profile.objectUrn);
                        if (profile.openLink !== undefined) userObject.open_link = profile.openLink === true ? 'YES' : 'NO';
                        if (profile.premium !== undefined) userObject.premium = profile.premium === true ? 'YES' : 'NO';
                        if (profile.degree !== undefined) userObject.degree = profile.degree;

                        // Array iteration (main data path for most API responses)
                        if (profile.currentPositions && profile.currentPositions.length > 0) {
                            for (var c = 0; c < profile.currentPositions.length; c++) {
                                var pos = profile.currentPositions[c];
                                if (pos.current === true || c === 0) {
                                    if (pos.title !== undefined) userObject.job_title = unescapeHtml(pos.title);
                                    if (pos.companyName !== undefined) userObject.user_company_name = cleanCompanyName(pos.companyName);
                                    if (pos.description !== undefined) userObject.user_summary = pos.description || userObject.user_summary;
                                    if (pos.tenureAtPosition !== undefined) {
                                        userObject.lead_years_position  = pos.tenureAtPosition.numYears;
                                        userObject.lead_months_position = pos.tenureAtPosition.numMonths;
                                    }
                                    if (pos.tenureAtCompany !== undefined) {
                                        userObject.lead_years_company  = pos.tenureAtCompany.numYears;
                                        userObject.lead_months_company = pos.tenureAtCompany.numMonths;
                                    }
                                    if (pos.startedOn !== undefined) {
                                        userObject.lead_position_started_month = pos.startedOn.month;
                                        userObject.lead_position_started_year  = pos.startedOn.year;
                                    }
                                    if (pos.companyUrn !== undefined) {
                                        userObject.user_company_id = extractIdNewLinkedinCompany(pos.companyUrn);
                                    }
                                    if (pos.companyUrnResolutionResult && pos.companyUrnResolutionResult.industry !== undefined) {
                                        userObject.industry = pos.companyUrnResolutionResult.industry;
                                    }
                                    if (pos.current === true) break;
                                }
                            }
                        }

                        // Build Sales Nav profile URL from entityUrn
                        if (profile.entityUrn !== undefined) {
                            userObject.user_url = profile.entityUrn.toString()
                                .replace('urn:li:fs_salesProfile:(', 'https://www.linkedin.com/sales/people/');
                            userObject.user_url = userObject.user_url.replace(',ibn_)', '');
                            userObject.user_url = userObject.user_url.replace(')', '');
                        }

                        allProfiles.push(userObject);
                    });
                }

                window.FINDYMAIL_PROFILES = allProfiles;
                var el = document.getElementById('findymail-profiles');
                if (el) {
                    el.textContent = JSON.stringify(allProfiles);
                } else {
                    el = document.createElement('div');
                    el.id = 'findymail-profiles';
                    el.style.cssText = 'display:none;';
                    el.textContent = JSON.stringify(allProfiles);
                    (document.body || document.documentElement).appendChild(el);
                }
            }

            if (url.indexOf('salesApiAccountSearch') !== -1) {
                jsonProfiles = JSON.parse(data);
                allProfiles = [];

                if (jsonProfiles.elements) {
                    jsonProfiles.elements.forEach(function(account) {
                        accountObject = {};
                        accountObject.saved               = account.saved;
                        accountObject.companyName         = account.companyName;
                        accountObject.description         = account.description;
                        accountObject.industry            = account.industry;
                        accountObject.employeeCountRange  = account.employeeCountRange
                            ? account.employeeCountRange.replace(' employees', '') : '';
                        accountObject.employeeDisplayCount = account.employeeDisplayCount;
                        accountObject.entityUrn           = account.entityUrn;
                        accountObject.companyId           = account.entityUrn
                            ? account.entityUrn.replace('urn:li:fs_salesCompany:', '') : '';
                        allProfiles.push(accountObject);
                    });
                }

                var elAcc = document.getElementById('findymail-profiles');
                if (elAcc) {
                    elAcc.textContent = JSON.stringify(allProfiles);
                } else {
                    elAcc = document.createElement('div');
                    elAcc.id = 'findymail-profiles';
                    elAcc.style.cssText = 'display:none;';
                    elAcc.textContent = JSON.stringify(allProfiles);
                    (document.body || document.documentElement).appendChild(elAcc);
                }
            }

        } catch (err) {
            console.error('[MOGO] Interceptor Error:', err);
        }
    }

    // --- Helper Functions ---
    function cleanCompanyName(e) {
        if (!e) return '';
        return e.replace(', Inc.', '').replace(' Inc.', '').replace(' Inc', '')
                .replace(' LLC', '').replace(', LLC', '').trim()
                .replace('<b>', '').replace('</b>', '')
                .replace('&lt;b&gt;', '').replace('&lt;/b&gt;', '').replace(', INC.', '');
    }

    function extractIdNewLinkedinCompany(e) {
        if (!e) return '';
        return e.replace('urn:li:fs_salesCompany:', '');
    }

    function extractIdNewLinkedin(e) {
        if (!e) return '';
        return e.replace('urn:li:member:', '');
    }

    function cleanName(e) {
        if (!e) return '';
        if (e.indexOf(',') > -1) e = e.split(',')[0];
        return e;
    }

    function unescapeHtml(e) {
        if (!e) return '';
        var t = document.createElement('DIV');
        t.innerHTML = e;
        var res = t.textContent || t.innerText || '';
        res = res.replace(/<[^>]*>/gm, '');
        return res;
    }

    // --- XHR Interceptor (matching Findymail reference) ---
    try {
        var XHR  = XMLHttpRequest.prototype;
        var send = XHR.send;
        var open = XHR.open;

        XHR.open = function(method, url) {
            this._mogoUrl    = url;
            this._mogoMethod = method;
            return open.apply(this, arguments);
        };

        XHR.send = function() {
            var self = this;
            this.addEventListener('load', function() {
                try {
                    var url = self._mogoUrl || '';
                    var matched = urlTargets.filter(function(t) { return url.indexOf(t) > -1; });
                    if (matched.length > 0) {
                        // Use responseText directly (responseType is '' by default = text)
                        processSalesData(self.responseText, url);
                    }
                } catch (e) {
                    console.error('[MOGO] XHR load error:', e);
                }
            });
            return send.apply(this, arguments);
        };
    } catch (e) {
        console.log('[MOGO] XHR interceptor error:', e);
    }

    // --- Fetch Interceptor ---
    var originalFetch = window.fetch;
    window.fetch = function() {
        var args = Array.prototype.slice.call(arguments);
        var response;

        return originalFetch.apply(window, args).then(function(res) {
            response = res;
            try {
                var url = '';
                if (args[0] instanceof Request) {
                    url = args[0].url;
                } else {
                    url = typeof args[0] === 'string' ? args[0] : (args[0] ? args[0].toString() : '');
                }

                var matched = urlTargets.filter(function(t) { return url.indexOf(t) > -1; });
                if (matched.length > 0) {
                    response.clone().text().then(function(text) {
                        processSalesData(text, url);
                    }).catch(function(e) {
                        console.error('[MOGO] Fetch clone error:', e);
                    });
                }
            } catch (interceptErr) {
                console.error('[MOGO] Fetch interceptor error:', interceptErr);
            }
            return response;
        }).catch(function(networkErr) {
            throw networkErr;
        });
    };

})();
