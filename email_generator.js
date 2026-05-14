/**
 * MOGO Email Generator
 * Generates common business email patterns from a person's name and company domain.
 * Used as a local replacement for the Findymail API.
 */

const MogoEmailGenerator = {
  /**
   * Generate possible email addresses for a person
   * @param {string} firstName 
   * @param {string} lastName 
   * @param {string} domain - Company domain (e.g., "google.com")
   * @returns {object} - { emails: string[], primary: string }
   */
  generate(firstName, lastName, domain) {
    if (!firstName || !domain) {
      return { emails: [], primary: null };
    }

    firstName = this.cleanName(firstName).toLowerCase();
    lastName = lastName ? this.cleanName(lastName).toLowerCase() : '';
    domain = this.cleanDomain(domain).toLowerCase();

    if (!domain || domain.length < 3) {
      return { emails: [], primary: null };
    }

    const patterns = [];

    if (firstName && lastName) {
      // Most common B2B patterns
      patterns.push(`${firstName}.${lastName}@${domain}`);        // john.doe@company.com  (most common)
      patterns.push(`${firstName}${lastName}@${domain}`);          // johndoe@company.com
      patterns.push(`${firstName[0]}${lastName}@${domain}`);       // jdoe@company.com
      patterns.push(`${firstName}${lastName[0]}@${domain}`);       // johnd@company.com
      patterns.push(`${firstName}_${lastName}@${domain}`);         // john_doe@company.com
      patterns.push(`${firstName}-${lastName}@${domain}`);         // john-doe@company.com
      patterns.push(`${lastName}.${firstName}@${domain}`);         // doe.john@company.com
      patterns.push(`${firstName[0]}.${lastName}@${domain}`);      // j.doe@company.com
      patterns.push(`${firstName}@${domain}`);                     // john@company.com
      patterns.push(`${lastName}@${domain}`);                      // doe@company.com
    } else if (firstName) {
      patterns.push(`${firstName}@${domain}`);
    }

    return {
      emails: patterns,
      primary: patterns[0] || null
    };
  },

  /**
   * Generate email from a full name string
   * @param {string} fullName - "John Doe"
   * @param {string} domain - "company.com"
   * @returns {object}
   */
  generateFromFullName(fullName, domain) {
    if (!fullName || !domain) return { emails: [], primary: null };
    
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    
    return this.generate(firstName, lastName, domain);
  },

  /**
   * Clean a name string
   */
  cleanName(name) {
    return name
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Clean and extract domain from URL or string
   */
  cleanDomain(input) {
    if (!input) return '';
    
    // Remove protocol
    let domain = input.replace(/^https?:\/\//, '').replace(/^www\./, '');
    
    // Remove path
    domain = domain.split('/')[0];
    
    // Remove port
    domain = domain.split(':')[0];
    
    // Remove query
    domain = domain.split('?')[0];
    
    return domain.trim();
  },

  /**
   * Extract root domain from a URL
   */
  extractRootDomain(url) {
    let domain = this.cleanDomain(url);
    const parts = domain.split('.');
    const len = parts.length;
    
    if (len > 2) {
      domain = parts[len - 2] + '.' + parts[len - 1];
      if (parts[len - 2].length <= 3 && parts[len - 1].length === 2) {
        domain = parts[len - 3] + '.' + domain;
      }
    }
    return domain;
  }
};

// Make available globally for service worker and content scripts
if (typeof globalThis !== 'undefined') {
  globalThis.MogoEmailGenerator = MogoEmailGenerator;
}
