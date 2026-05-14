/**
 * MOGO Email Finder
 * Generates all common professional email patterns from name + domain,
 * then ranks them by frequency of use in the real world.
 */

/**
 * Clean a name component for use in an email address
 * @param {string} s
 * @returns {string}
 */
function cleanNamePart(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')                   // decompose accents
    .replace(/[\u0300-\u036f]/g, '')   // strip accent marks → e.g. é → e
    .replace(/[^a-z0-9]/g, '')         // keep only alphanumeric
    .trim();
}

/**
 * Clean a domain name
 * @param {string} d
 * @returns {string}
 */
function cleanDomain(d) {
  return (d || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split(':')[0]
    .toLowerCase()
    .trim();
}

/**
 * Generate ranked email pattern candidates
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} domain
 * @returns {{ emails: string[], primary: string|null }}
 */
function generateEmailPatterns(firstName, lastName, domain) {
  const f = cleanNamePart(firstName);
  const l = cleanNamePart(lastName);
  const d = cleanDomain(domain);

  if (!f || !d || d.length < 3) return { emails: [], primary: null };

  const patterns = [];

  if (f && l) {
    // Most common B2B patterns first (ordered by real-world frequency)
    patterns.push(`${f}.${l}@${d}`);         // john.doe@company.com  — most common
    patterns.push(`${f}${l}@${d}`);          // johndoe@company.com
    patterns.push(`${f[0]}${l}@${d}`);       // jdoe@company.com
    patterns.push(`${f}@${d}`);              // john@company.com
    patterns.push(`${f}.${l[0]}@${d}`);      // john.d@company.com
    patterns.push(`${f}${l[0]}@${d}`);       // johnd@company.com
    patterns.push(`${f}_${l}@${d}`);         // john_doe@company.com
    patterns.push(`${f[0]}.${l}@${d}`);      // j.doe@company.com
    patterns.push(`${l}.${f}@${d}`);         // doe.john@company.com
    patterns.push(`${l}${f}@${d}`);          // doejohn@company.com
    patterns.push(`${l}@${d}`);             // doe@company.com
    patterns.push(`${l}${f[0]}@${d}`);       // doej@company.com
  } else if (f) {
    patterns.push(`${f}@${d}`);
  }

  return { emails: patterns, primary: patterns[0] || null };
}

/**
 * Find the most likely email for a person
 * @param {string} firstName
 * @param {string} lastName  
 * @param {string} domain
 * @returns {{ email: string|null, emails: string[], confidence: number }}
 */
function findEmail(firstName, lastName, domain) {
  const result = generateEmailPatterns(firstName, lastName, domain);
  return {
    email: result.primary,
    emails: result.emails,
    confidence: result.primary ? 0.65 : 0   // pattern-only confidence
  };
}

module.exports = { findEmail, generateEmailPatterns, cleanDomain, cleanNamePart };
