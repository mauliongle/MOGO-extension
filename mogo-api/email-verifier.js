/**
 * MOGO Email Verifier
 * Two-stage verification:
 *   Stage 1 — DNS MX lookup (does this domain have a mail server?)
 *   Stage 2 — SMTP RCPT TO check (does this specific mailbox exist?)
 * 
 * No external services used — pure DNS + direct SMTP.
 */

const dns  = require('dns').promises;
const net  = require('net');

const SMTP_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 8000;

// Well-known catch-all domains (always return valid) — skip SMTP for these
const CATCH_ALL_PROVIDERS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.fr','yahoo.de',
  'outlook.com','hotmail.com','hotmail.co.uk','live.com','msn.com',
  'icloud.com','me.com','mac.com','aol.com','protonmail.com','proton.me',
  'zoho.com','yandex.com','yandex.ru','mail.com','gmx.com','gmx.de',
  'web.de','inbox.com','fastmail.com','tutanota.com','hey.com'
]);

// Domains known to reject SMTP probing (return false positives)
const NO_SMTP_DOMAINS = new Set([
  'google.com','microsoft.com','apple.com','amazon.com','facebook.com',
  'meta.com','twitter.com','x.com','linkedin.com','salesforce.com',
  'hubspot.com','mailchimp.com','sendgrid.com','twilio.com',
  'stripe.com','shopify.com','github.com','gitlab.com','atlassian.com',
  'slack.com','notion.so','zoom.us','dropbox.com','box.com',
]);

/**
 * Stage 1: DNS MX lookup
 * @param {string} domain
 * @returns {Promise<{ valid: boolean, mxHosts: string[], reason: string }>}
 */
async function checkMX(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) {
      return { valid: false, mxHosts: [], reason: 'no_mx_records' };
    }
    const sorted = records.sort((a, b) => a.priority - b.priority);
    const mxHosts = sorted.map(r => r.exchange);
    return { valid: true, mxHosts, reason: 'mx_found' };
  } catch (err) {
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
      return { valid: false, mxHosts: [], reason: 'domain_not_found' };
    }
    return { valid: false, mxHosts: [], reason: `dns_error: ${err.code}` };
  }
}

/**
 * Stage 2: SMTP RCPT TO check
 * Connects to the MX server and checks if the mailbox exists
 * without actually sending an email.
 * @param {string} email
 * @param {string} mxHost
 * @returns {Promise<{ valid: boolean, reason: string, catchAll: boolean }>}
 */
async function checkSMTP(email, mxHost) {
  return new Promise((resolve) => {
    let resolved = false;
    let responseBuffer = '';
    let stage = 'connect';
    const domain = email.split('@')[1];

    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };

    const socket = net.createConnection({ host: mxHost, port: 25 });

    const globalTimeout = setTimeout(() => {
      safeResolve({ valid: true, reason: 'smtp_timeout', catchAll: false });
    }, SMTP_TIMEOUT_MS);

    const clearAll = () => clearTimeout(globalTimeout);

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.setEncoding('utf8');

    socket.on('timeout', () => {
      clearAll();
      safeResolve({ valid: true, reason: 'smtp_timeout', catchAll: false });
    });

    socket.on('error', (err) => {
      clearAll();
      // Connection refused or blocked — assume valid (can't verify)
      safeResolve({ valid: true, reason: `smtp_error: ${err.code}`, catchAll: false });
    });

    socket.on('data', (chunk) => {
      responseBuffer += chunk;

      // Process complete lines
      const lines = responseBuffer.split('\r\n');
      responseBuffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3));

        switch (stage) {
          case 'connect':
            if (code === 220) {
              stage = 'ehlo';
              socket.write(`EHLO mogo-verifier.local\r\n`);
            } else {
              clearAll();
              safeResolve({ valid: true, reason: 'smtp_not_ready', catchAll: false });
            }
            break;

          case 'ehlo':
            if ((code === 250 || code === 220) && !line.includes('-')) {
              stage = 'mail_from';
              socket.write(`MAIL FROM:<verify@mogo-verifier.local>\r\n`);
            }
            break;

          case 'mail_from':
            if (code === 250) {
              stage = 'rcpt_to_real';
              socket.write(`RCPT TO:<${email}>\r\n`);
            } else {
              clearAll();
              safeResolve({ valid: true, reason: 'mail_from_rejected', catchAll: false });
            }
            break;

          case 'rcpt_to_real':
            if (code === 250 || code === 251) {
              // Address accepted — check for catch-all by testing fake address
              stage = 'rcpt_to_fake';
              const fakeEmail = `__mogo_fake_${Date.now()}@${domain}`;
              socket.write(`RCPT TO:<${fakeEmail}>\r\n`);
            } else if (code === 550 || code === 551 || code === 552 || code === 553 || code === 554) {
              // Address explicitly rejected — definitely invalid
              clearAll();
              safeResolve({ valid: false, reason: 'smtp_rejected', catchAll: false });
            } else if (code === 450 || code === 451 || code === 452) {
              // Temporary failure — assume valid
              clearAll();
              safeResolve({ valid: true, reason: 'smtp_temp_failure', catchAll: false });
            } else {
              clearAll();
              safeResolve({ valid: true, reason: `smtp_unknown_${code}`, catchAll: false });
            }
            break;

          case 'rcpt_to_fake':
            // If fake address ALSO accepted → catch-all domain
            const isCatchAll = (code === 250 || code === 251);
            clearAll();
            socket.write('QUIT\r\n');
            safeResolve({
              valid: true,
              reason: isCatchAll ? 'catch_all_domain' : 'smtp_verified',
              catchAll: isCatchAll
            });
            break;
        }
      }
    });

    socket.on('close', () => {
      clearAll();
      if (!resolved) {
        safeResolve({ valid: true, reason: 'smtp_closed', catchAll: false });
      }
    });
  });
}

/**
 * Main verifier — combines MX + SMTP checks
 * @param {string} email
 * @returns {Promise<{
 *   valid: boolean,
 *   email: string,
 *   reason: string,
 *   catchAll: boolean,
 *   confidence: number
 * }>}
 */
async function verifyEmail(email) {
  if (!email || !email.includes('@')) {
    return { valid: false, email, reason: 'invalid_format', catchAll: false, confidence: 0 };
  }

  const [, domain] = email.split('@');

  // Known consumer/catch-all domains — skip SMTP, assume valid format
  if (CATCH_ALL_PROVIDERS.has(domain.toLowerCase())) {
    return { valid: true, email, reason: 'free_provider', catchAll: true, confidence: 0.5 };
  }

  // Stage 1: MX check
  const mxResult = await checkMX(domain);
  if (!mxResult.valid) {
    return { valid: false, email, reason: mxResult.reason, catchAll: false, confidence: 0 };
  }

  // Domains that block SMTP probing — trust MX only
  if (NO_SMTP_DOMAINS.has(domain.toLowerCase())) {
    return { valid: true, email, reason: 'mx_found_no_smtp', catchAll: false, confidence: 0.7 };
  }

  // Stage 2: SMTP check
  const mxHost = mxResult.mxHosts[0];
  try {
    const smtpResult = await checkSMTP(email, mxHost);
    let confidence = 0;
    if (smtpResult.reason === 'smtp_verified') confidence = 0.95;
    else if (smtpResult.reason === 'catch_all_domain') confidence = 0.6;
    else if (smtpResult.reason === 'mx_found') confidence = 0.65;
    else if (smtpResult.valid) confidence = 0.7;
    else confidence = 0.1;

    return {
      valid: smtpResult.valid,
      email,
      reason: smtpResult.reason,
      catchAll: smtpResult.catchAll,
      confidence
    };
  } catch (err) {
    // SMTP check failed — fall back to MX result
    return { valid: true, email, reason: 'smtp_error', catchAll: false, confidence: 0.6 };
  }
}

module.exports = { verifyEmail, checkMX };
