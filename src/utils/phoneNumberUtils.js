/**
 * Dynamic Phone Number Utilities
 * 
 * This module provides utility functions for normalizing and matching phone numbers
 * across different formats without hardcoded dial codes.
 */

/**
 * Normalize a phone number to remove all non-digit characters
 * @param {string} phoneNumber - Phone number in any format
 * @returns {string} - Normalized phone number (digits only)
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return '';
  }
  
  // Remove all non-digit characters
  return phoneNumber.replace(/\D/g, '');
}

/**
 * Extract potential dial code from phone number using pattern analysis
 * @param {string} phoneNumber - Full phone number
 * @returns {Object|null} - { dialCode, phone } or null
 */
function extractPotentialDialCode(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null;
  }

  const normalized = normalizePhoneNumber(phoneNumber);
  
  // If starts with + in original, we know it has a country code
  if (phoneNumber.trim().startsWith('+')) {
    // Try different dial code lengths (1-4 digits are common)
    for (let len = 1; len <= 4; len++) {
      if (normalized.length > len) {
        const potentialDialCode = '+' + normalized.substring(0, len);
        const remainingPhone = normalized.substring(len);
        
        // Basic validation: remaining phone should be 7-15 digits
        if (remainingPhone.length >= 7 && remainingPhone.length <= 15) {
          return {
            dialCode: potentialDialCode,
            phone: remainingPhone
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * Generate all possible variations of a phone number for flexible matching
 * @param {string} inputPhone - Input phone number from client
 * @returns {Array} - Array of possible phone number variations
 */
function generatePhoneVariations(inputPhone) {
  if (!inputPhone || typeof inputPhone !== 'string') {
    return [];
  }

  const variations = new Set();
  const normalized = normalizePhoneNumber(inputPhone);
  
  // Always add the fully normalized version
  variations.add(normalized);
  
  // Try to extract potential dial code
  const extracted = extractPotentialDialCode(inputPhone);
  if (extracted) {
    const { dialCode, phone } = extracted;
    
    // Add dial code variations
    variations.add(phone); // Just the phone part
    variations.add(dialCode + phone); // Full international format
    variations.add(dialCode.replace('+', '') + phone); // Without + sign
  }
  
  // Handle common local number patterns
  if (normalized.length >= 10) {
    // Add with leading zero (common in many countries)
    if (!normalized.startsWith('0')) {
      variations.add('0' + normalized);
    }
    
    // Remove leading zero if present
    if (normalized.startsWith('0')) {
      variations.add(normalized.substring(1));
    }
    
    // Add leading zero to different parts for various country formats
    if (normalized.length >= 11 && !normalized.startsWith('0')) {
      // Try adding 0 after potential country codes
      for (let i = 1; i <= 4; i++) {
        if (normalized.length > i) {
          const part1 = normalized.substring(0, i);
          const part2 = normalized.substring(i);
          variations.add(part1 + '0' + part2);
        }
      }
    }
  }
  
  // Handle different length patterns
  if (normalized.length >= 7) {
    // For numbers that might be missing country code, try common patterns
    
    // If it looks like a local number (7-10 digits), add potential country codes
    if (normalized.length >= 7 && normalized.length <= 10) {
      // Add some common country code patterns
      ['1', '44', '91', '86', '33', '49', '81', '82', '7', '880'].forEach(code => {
        variations.add(code + normalized);
        variations.add('+' + code + normalized);
      });
    }
    
    // If it's a longer number, try extracting potential local parts
    if (normalized.length > 10) {
      for (let i = 1; i <= 4; i++) {
        if (normalized.length > i) {
          const localPart = normalized.substring(i);
          if (localPart.length >= 7 && localPart.length <= 10) {
            variations.add(localPart);
            variations.add('0' + localPart);
          }
        }
      }
    }
  }

  return Array.from(variations).filter(v => v.length >= 7); // Filter out too short numbers
}

/**
 * Create MongoDB aggregation pipeline for flexible phone number matching
 * @param {Array} phoneNumbers - Array of phone numbers from client
 * @returns {Array} - MongoDB aggregation pipeline
 */
function createPhoneMatchingPipeline(phoneNumbers) {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return [];
  }

  // Generate all possible variations for all input phone numbers
  // and keep track of which original phone number each variation comes from
  const variationToOriginalMap = new Map();
  const allVariations = new Set();
  
  phoneNumbers.forEach(originalPhone => {
    const variations = generatePhoneVariations(originalPhone);
    variations.forEach(variation => {
      allVariations.add(variation);
      // Map each variation back to its original phone number
      variationToOriginalMap.set(variation, originalPhone);
    });
  });

  const variationsArray = Array.from(allVariations);

  if (variationsArray.length === 0) {
    return [];
  }

  // Create arrays for conditional matching to track original phone
  const matchConditions = [];
  const searchedPhoneConditions = [];

  variationsArray.forEach(variation => {
    const originalPhone = variationToOriginalMap.get(variation);
    
    // Create match conditions for each variation
    matchConditions.push(
      { $eq: ["$fullPhoneInternational", variation] },
      { $eq: ["$fullPhoneNormalized", variation] },
      { $eq: ["$phone", variation] },
      { $eq: ["$phoneWithLeadingZero", variation] },
      { $eq: ["$phoneWithoutLeadingZero", variation] },
      { $eq: [{ $concat: ["$dialCodeOnly", "$phone"] }, variation] },
      { $eq: [{ $concat: ["$dialCodeOnly", "0", "$phone"] }, variation] },
      { $eq: [{ $concat: ["$dialCodeOnly", "$phoneWithoutLeadingZero"] }, variation] }
    );

    // Create conditions to determine which original phone was matched
    searchedPhoneConditions.push({
      case: { $or: [
        { $eq: ["$fullPhoneInternational", variation] },
        { $eq: ["$fullPhoneNormalized", variation] },
        { $eq: ["$phone", variation] },
        { $eq: ["$phoneWithLeadingZero", variation] },
        { $eq: ["$phoneWithoutLeadingZero", variation] },
        { $eq: [{ $concat: ["$dialCodeOnly", "$phone"] }, variation] },
        { $eq: [{ $concat: ["$dialCodeOnly", "0", "$phone"] }, variation] },
        { $eq: [{ $concat: ["$dialCodeOnly", "$phoneWithoutLeadingZero"] }, variation] }
      ]},
      then: originalPhone
    });
  });

  return [
    {
      $addFields: {
        // Create various combinations of dialCode + phone for matching
        fullPhoneInternational: { $concat: ["$dialCode", "$phone"] },
        fullPhoneNormalized: { 
          $concat: [
            { $replaceAll: { input: "$dialCode", find: "+", replacement: "" } },
            "$phone"
          ]
        },
        phoneWithLeadingZero: { $concat: ["0", "$phone"] },
        phoneWithoutLeadingZero: {
          $cond: {
            if: { $eq: [{ $substr: ["$phone", 0, 1] }, "0"] },
            then: { $substr: ["$phone", 1, -1] },
            else: "$phone"
          }
        },
        // Additional variations for flexibility
        dialCodeOnly: { $replaceAll: { input: "$dialCode", find: "+", replacement: "" } },
        phoneNormalized: "$phone"
      }
    },
    {
      $match: {
        $or: [
          // Match against full international formats
          { fullPhoneInternational: { $in: variationsArray } },
          { fullPhoneNormalized: { $in: variationsArray } },
          
          // Match against phone number only
          { phone: { $in: variationsArray } },
          { phoneWithLeadingZero: { $in: variationsArray } },
          { phoneWithoutLeadingZero: { $in: variationsArray } },
          
          // Match where input variations might match dial code + phone combinations
          { $expr: {
            $in: [
              { $concat: ["$dialCodeOnly", "$phone"] },
              variationsArray
            ]
          }},
          { $expr: {
            $in: [
              { $concat: ["$dialCodeOnly", "0", "$phone"] },
              variationsArray
            ]
          }},
          { $expr: {
            $in: [
              { $concat: ["$dialCodeOnly", "$phoneWithoutLeadingZero"] },
              variationsArray
            ]
          }}
        ]
      }
    },
    {
      $addFields: {
        // Add the original searched phone number that matched
        searchedPhone: {
          $switch: {
            branches: searchedPhoneConditions,
            default: phoneNumbers[0] // Fallback to first phone number
          }
        }
      }
    },
    {
      $project: {
        // Remove temporary fields but keep searchedPhone
        fullPhoneInternational: 0,
        fullPhoneNormalized: 0,
        phoneWithLeadingZero: 0,
        phoneWithoutLeadingZero: 0,
        dialCodeOnly: 0,
        phoneNormalized: 0
      }
    }
  ];
}

/**
 * Simple phone number validation
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - Whether the phone number appears valid
 */
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }
  
  const normalized = normalizePhoneNumber(phoneNumber);
  
  // Basic validation: should be between 7-15 digits
  return normalized.length >= 7 && normalized.length <= 15;
}

/**
 * Format phone number for display (basic formatting)
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} - Formatted phone number
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return '';
  }
  
  const normalized = normalizePhoneNumber(phoneNumber);
  
  // Basic formatting for display
  if (normalized.length >= 10) {
    return normalized.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  
  return normalized;
}

/**
 * Test helper: Generate variation mapping for debugging
 * @param {Array} phoneNumbers - Array of original phone numbers
 * @returns {Object} - Object showing which variations map to which original numbers
 */
function getVariationMapping(phoneNumbers) {
  const mapping = {};
  
  phoneNumbers.forEach(originalPhone => {
    const variations = generatePhoneVariations(originalPhone);
    mapping[originalPhone] = variations;
  });
  
  return mapping;
}

/**
 * Test helper: Simulate what the database response would look like
 * @param {Array} phoneNumbers - Array of original phone numbers  
 * @param {Array} mockUsers - Array of mock user objects from database
 * @returns {Array} - Simulated response with searchedPhone field
 */
function simulateSearchResponse(phoneNumbers, mockUsers) {
  const variationToOriginalMap = new Map();
  
  phoneNumbers.forEach(originalPhone => {
    const variations = generatePhoneVariations(originalPhone);
    variations.forEach(variation => {
      variationToOriginalMap.set(variation, originalPhone);
    });
  });
  
  return mockUsers.map(user => {
    // Find which original phone number would match this user
    const userPhone = user.dialCode + user.phone;
    const userPhoneNormalized = normalizePhoneNumber(userPhone);
    
    let matchedOriginal = phoneNumbers[0]; // default
    
    // Check which variation would match
    for (const [variation, original] of variationToOriginalMap.entries()) {
      if (variation === userPhone || 
          variation === userPhoneNormalized || 
          variation === user.phone ||
          variation === '0' + user.phone) {
        matchedOriginal = original;
        break;
      }
    }
    
    return {
      ...user,
      searchedPhone: matchedOriginal
    };
  });
}

module.exports = {
  normalizePhoneNumber,
  extractPotentialDialCode,
  generatePhoneVariations,
  createPhoneMatchingPipeline,
  isValidPhoneNumber,
  formatPhoneNumber,
  getVariationMapping,      // Helper for testing
  simulateSearchResponse    // Helper for testing
}; 