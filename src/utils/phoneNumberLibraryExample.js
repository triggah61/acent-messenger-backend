/**
 * Phone Number Library Integration Example
 * 
 * This file shows how you can integrate with google-libphonenumber
 * or similar libraries for even more robust phone number handling.
 * 
 * To use this approach:
 * 1. Install: npm install google-libphonenumber
 * 2. Replace phoneNumberUtils with this implementation
 */

/*
// Uncomment this section if you want to use google-libphonenumber

const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');
const phoneUtil = PhoneNumberUtil.getInstance();

function parsePhoneNumberWithLibrary(phoneNumber, defaultCountry = null) {
  try {
    const number = phoneUtil.parse(phoneNumber, defaultCountry);
    
    if (phoneUtil.isValidNumber(number)) {
      return {
        countryCode: number.getCountryCode(),
        nationalNumber: number.getNationalNumber().toString(),
        international: phoneUtil.format(number, PhoneNumberFormat.INTERNATIONAL),
        e164: phoneUtil.format(number, PhoneNumberFormat.E164),
        national: phoneUtil.format(number, PhoneNumberFormat.NATIONAL),
        isValid: true
      };
    }
  } catch (error) {
    console.warn('Phone number parsing error:', error.message);
  }
  
  return { isValid: false };
}

function generatePhoneVariationsWithLibrary(phoneNumber, defaultCountry = null) {
  const parsed = parsePhoneNumberWithLibrary(phoneNumber, defaultCountry);
  
  if (!parsed.isValid) {
    // Fallback to our custom logic
    return require('./phoneNumberUtils').generatePhoneVariations(phoneNumber);
  }
  
  const variations = new Set([
    parsed.e164,
    parsed.e164.replace('+', ''),
    parsed.nationalNumber,
    '0' + parsed.nationalNumber,
    parsed.national.replace(/\D/g, ''),
    parsed.international.replace(/\D/g, '')
  ]);
  
  return Array.from(variations).filter(v => v.length >= 7);
}

module.exports = {
  parsePhoneNumberWithLibrary,
  generatePhoneVariationsWithLibrary
};
*/

/**
 * Current Dynamic Approach (No external dependencies)
 * 
 * Our current implementation is already quite robust and handles
 * most international phone number formats without external dependencies.
 * 
 * Benefits of current approach:
 * - No external dependencies
 * - Works with any country
 * - Flexible and customizable
 * - Performance optimized
 * 
 * When to consider library approach:
 * - Need strict phone number validation
 * - Need carrier information
 * - Need timezone data
 * - Building a telecom application
 */

console.log(`
=== Phone Number Handling Strategy ===

Current Implementation: ✅ Dynamic pattern-based matching
- No hardcoded country codes
- Handles international formats
- Generates comprehensive variations
- MongoDB optimized aggregation

Alternative: google-libphonenumber
- More precise validation
- Carrier information
- Timezone data
- Additional 2MB dependency

Recommendation: 
Use current dynamic approach for most applications.
Consider library approach only if you need:
- Strict validation
- Carrier/timezone data
- Telecom-specific features
`);

// Export current utilities for consistency
module.exports = require('./phoneNumberUtils'); 