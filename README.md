# MOGO - Email Finder Chrome Extension

<div align="center">
  <img src="icons/icon128.png" alt="MOGO Logo" width="128"/>
  
  # MOGO Email Finder
  
  **Find & verify B2B emails on Apollo.io and LinkedIn — no login, no credits, no limits.**

  ![Version](https://img.shields.io/badge/version-2.0.0-blue)
  ![License](https://img.shields.io/badge/license-MIT-green)
  ![Chrome](https://img.shields.io/badge/Chrome-Extension-yellow)
  ![No Login](https://img.shields.io/badge/login-not%20required-brightgreen)
</div>

---

## ✨ Features

- 💌 **Export contacts from Apollo.io** — scrape people lists directly to CSV with no login
- 🔍 **Email Finder** — generates all professional email patterns from name + domain
- ✅ **Email Verifier** — MX DNS + SMTP verification (no external APIs)
- 🔗 **LinkedIn profile enrichment** — find emails from LinkedIn profiles
- 📋 **Local contact lists** — save contacts locally, no cloud sync
- ⚡ **Offline capable** — works fully locally, no account needed

---

## 🚀 Quick Start

### 1. Start the Local API Server

```bash
cd mogo-api
start.bat          # Windows
# or
npm install && node server.js
```

Keep this running in the background. The API runs on `http://localhost:7823`.

### 2. Load the Extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load Unpacked**
4. Select the `mogo-extension` folder

### 3. Use on Apollo.io

1. Go to `https://app.apollo.io/#/people`
2. Click the **💌 Export to CSV** button
3. Set the count and export — no login required!

---

## 📁 Project Structure

```
MOGO-email-finder-extension/
├── mogo-extension/          # Chrome Extension
│   ├── apollo.js            # Apollo.io content script (no auth)
│   ├── background.js        # Service worker
│   ├── popup.js             # Extension popup
│   ├── manifest.json        # Extension manifest v3
│   ├── linkedin.js          # LinkedIn scraper
│   ├── icons/               # Extension icons (16, 32, 48, 128px)
│   └── ...
│
└── mogo-api/                # Local Email API Server
    ├── server.js            # Express API (localhost:7823)
    ├── email-finder.js      # Pattern-based email finder
    ├── email-verifier.js    # MX + SMTP email verifier
    ├── start.bat            # One-click launcher (Windows)
    └── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server status |
| `POST` | `/find` | Find email patterns for a person |
| `POST` | `/verify` | SMTP verify a single email |
| `POST` | `/find-and-verify` | Find + verify in one call |
| `POST` | `/bulk-verify` | Verify up to 50 emails at once |

### Example

```bash
# Find email
curl -X POST http://localhost:7823/find \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe","domain":"company.com"}'

# Response
{
  "email": "john.doe@company.com",
  "emails": ["john.doe@company.com", "johndoe@company.com", "jdoe@company.com", ...],
  "confidence": 0.65
}
```

---

## 🛡️ How Email Verification Works

1. **MX DNS Lookup** — confirms the domain has a mail server
2. **SMTP RCPT TO** — connects directly to the mail server and checks if the mailbox exists
3. **Catch-all detection** — tests with a fake address to detect catch-all domains

No third-party services used. 100% local.

---

## 📦 Requirements

- Google Chrome (v88+)
- Node.js (v18+) — for the local API server

---

## 📄 License

MIT © 2026 MOGO
