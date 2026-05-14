/**
 * MOGO Email API Server
 * Runs locally on http://localhost:7823
 * 
 * Endpoints:
 *   GET  /health           → status check
 *   POST /find             → find email patterns for a person
 *   POST /verify           → SMTP verify an email address
 *   POST /find-and-verify  → find + verify in one call
 */

const express = require('express');
const cors    = require('cors');
const { findEmail, generateEmailPatterns, cleanDomain } = require('./email-finder');
const { verifyEmail, checkMX } = require('./email-verifier');

const app = express();
const PORT = 7823;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:*', '*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '1mb' }));

// Request logger
app.use((req, res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MOGO Email API',
    version: '1.0.0',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// ─── POST /find ───────────────────────────────────────────────────────────────
// Body: { firstName, lastName, domain } OR { name, domain }
app.post('/find', async (req, res) => {
  try {
    let { firstName, lastName, name, domain } = req.body;

    // Support full name parsing
    if (name && !firstName) {
      const parts = name.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName  = parts.slice(1).join(' ') || '';
    }

    if (!firstName || !domain) {
      return res.status(400).json({ error: 'firstName and domain are required' });
    }

    const result = findEmail(firstName, lastName, domain);

    res.json({
      email: result.email,
      emails: result.emails,
      confidence: result.confidence,
      firstName, lastName,
      domain: cleanDomain(domain)
    });
  } catch (err) {
    console.error('[/find] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /verify ─────────────────────────────────────────────────────────────
// Body: { email }
app.post('/verify', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const result = await verifyEmail(email);
    res.json(result);
  } catch (err) {
    console.error('[/verify] Error:', err.message);
    res.status(500).json({ error: err.message, valid: true }); // default to valid on error
  }
});

// ─── POST /find-and-verify ────────────────────────────────────────────────────
// Body: { firstName, lastName, domain } OR { name, domain }
// Finds top email candidates then SMTP-verifies them in order
app.post('/find-and-verify', async (req, res) => {
  try {
    let { firstName, lastName, name, domain } = req.body;

    if (name && !firstName) {
      const parts = name.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName  = parts.slice(1).join(' ') || '';
    }

    if (!firstName || !domain) {
      return res.status(400).json({ error: 'firstName and domain are required' });
    }

    const findResult = findEmail(firstName, lastName, domain);
    const candidates = findResult.emails.slice(0, 4); // verify top 4 patterns

    // Check MX once (shared across all candidates)
    const mxResult = await checkMX(cleanDomain(domain));
    if (!mxResult.valid) {
      return res.json({
        email: findResult.email,
        verified: false,
        confidence: 0,
        reason: mxResult.reason,
        allCandidates: candidates
      });
    }

    // Try verifying candidates in order, return first verified hit
    for (const candidate of candidates) {
      const vResult = await verifyEmail(candidate);
      if (vResult.valid && vResult.reason === 'smtp_verified') {
        return res.json({
          email: candidate,
          verified: true,
          confidence: vResult.confidence,
          reason: vResult.reason,
          catchAll: vResult.catchAll,
          allCandidates: candidates
        });
      }
    }

    // None definitively verified — return most likely pattern
    const bestVerify = await verifyEmail(candidates[0]);
    res.json({
      email: candidates[0] || findResult.email,
      verified: bestVerify.valid,
      confidence: bestVerify.confidence,
      reason: bestVerify.reason,
      catchAll: bestVerify.catchAll,
      allCandidates: candidates
    });
  } catch (err) {
    console.error('[/find-and-verify] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /bulk-verify ────────────────────────────────────────────────────────
// Body: { emails: string[] }
app.post('/bulk-verify', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails array is required' });
    }
    if (emails.length > 50) {
      return res.status(400).json({ error: 'Max 50 emails per bulk request' });
    }

    const results = await Promise.allSettled(
      emails.map(email => verifyEmail(email))
    );

    res.json({
      results: results.map((r, i) => ({
        email: emails[i],
        ...(r.status === 'fulfilled' ? r.value : { valid: false, reason: 'error' })
      }))
    });
  } catch (err) {
    console.error('[/bulk-verify] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', endpoints: ['/health', '/find', '/verify', '/find-and-verify', '/bulk-verify'] });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ███╗   ███╗ ██████╗  ██████╗  ██████╗ ');
  console.log('  ████╗ ████║██╔═══██╗██╔════╝ ██╔═══██╗');
  console.log('  ██╔████╔██║██║   ██║██║  ███╗██║   ██║');
  console.log('  ██║╚██╔╝██║██║   ██║██║   ██║██║   ██║');
  console.log('  ██║ ╚═╝ ██║╚██████╔╝╚██████╔╝╚██████╔╝');
  console.log('  ╚═╝     ╚═╝ ╚═════╝  ╚═════╝  ╚═════╝ ');
  console.log('');
  console.log(`  Email Finder & Verifier API`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    GET  http://localhost:${PORT}/health`);
  console.log(`    POST http://localhost:${PORT}/find`);
  console.log(`    POST http://localhost:${PORT}/verify`);
  console.log(`    POST http://localhost:${PORT}/find-and-verify`);
  console.log(`    POST http://localhost:${PORT}/bulk-verify`);
  console.log('');
  console.log('  Keep this window open while using MOGO extension.');
  console.log('');
});
