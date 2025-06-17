/**
 * Dynamic Phone Number Utils Test Examples
 * 
 * This file demonstrates how the dynamic phone number utilities handle various formats
 * without relying on hardcoded dial codes.
 */

const { 
  extractPotentialDialCode, 
  normalizePhoneNumber, 
  generatePhoneVariations,
  isValidPhoneNumber,
  formatPhoneNumber
} = require('./phoneNumberUtils');

console.log('=== Dynamic Phone Number Utilities Test ===\n');

// Test cases for various international numbers
const testNumbers = [
  // Bangladesh examples
  '+8801756560928',    // Full international format
  '8801756560928',     // Without + sign
  '01756560928',       // Local format with leading 0
  '1756560928',        // Local format without leading 0
  '+880 1756 560 928', // With spaces
  '+880-1756-560-928', // With dashes
  
  // US examples
  '+1234567890',       // US number
  '234567890',         // US without country code
  
  // India examples
  '+911234567890',     // India number
  '1234567890',        // Local format
  
  // UK examples
  '+441234567890',     // UK number
  '01234567890',       // UK local format
];

console.log('Input Number Variations (Dynamic Detection):');
testNumbers.forEach(phone => {
  console.log(`\nInput: "${phone}"`);
  
  const extracted = extractPotentialDialCode(phone);
  console.log('  Extracted:', extracted);
  
  const normalized = normalizePhoneNumber(phone);
  console.log('  Normalized:', normalized);
  
  const isValid = isValidPhoneNumber(phone);
  console.log('  Valid:', isValid);
  
  const formatted = formatPhoneNumber(phone);
  console.log('  Formatted:', formatted);
  
  const variations = generatePhoneVariations(phone);
  console.log('  Variations:', variations.slice(0, 5), '...'); // Show first 5 variations
  console.log(`  Total variations: ${variations.length}`);
});

console.log('\n=== How Dynamic Matching Works ===');
console.log('Database example: dialCode: "+880", phone: "1756560928"');
console.log('Database concatenated: "+8801756560928"');

console.log('\nDynamic matching for different inputs:');
const testInputs = [
  '+8801756560928',    // Full international
  '8801756560928',     // Without +
  '01756560928',       // Local with 0
  '1756560928',        // Local without 0
  '+880 1756560928',   // With space
  '880-1756560928',    // With dash, no +
];

testInputs.forEach(input => {
  const variations = generatePhoneVariations(input);
  
  // Check if any variation would match the database format
  const wouldMatchDB = variations.some(v => 
    v === '+8801756560928' || 
    v === '8801756560928' || 
    v === '1756560928' ||
    v === '01756560928'
  );
  
  console.log(`"${input}" -> Would match: ${wouldMatchDB ? '✅' : '❌'}`);
  console.log(`  Generated ${variations.length} variations`);
});

console.log('\n=== Pattern-Based Flexibility ===');
console.log('This approach works with ANY country without hardcoding:');

const internationalExamples = [
  '+33123456789',      // France
  '+49123456789',      // Germany  
  '+81123456789',      // Japan
  '+7123456789',       // Russia
  '+86123456789',      // China
];

internationalExamples.forEach(phone => {
  const extracted = extractPotentialDialCode(phone);
  const variations = generatePhoneVariations(phone);
  
  console.log(`${phone} -> Detected: ${extracted?.dialCode || 'Unknown'}, Variations: ${variations.length}`);
});

console.log('\n=== Real-World Scenarios ===');

// Simulate how different apps might send the same number
const sameNumberDifferentFormats = [
  '+8801987654321',        // WhatsApp format
  '8801987654321',         // Telegram format  
  '01987654321',           // Local contact book
  '1987654321',            // Minimal format
  '+880 (198) 765-4321',   // Formatted version
  '880.198.765.4321',      // Dotted format
];

console.log('Same number in different formats (should all match):');
sameNumberDifferentFormats.forEach(format => {
  const variations = generatePhoneVariations(format);
  console.log(`"${format}" -> ${variations.length} variations generated`);
});

console.log('\n=== SearchedPhone Tracking Example ===');
console.log('How the API response will look with searchedPhone field:');

// Simulate API response
const exampleApiResponse = [
  {
    _id: "682c3cd1d7441903b740a797",
    firstName: "Yasir",
    lastName: "Arafat", 
    username: null,
    dialCode: "+880",
    phone: "1756560928",
    photo: null,
    searchedPhone: "+8801756560928"  // Original input from client
  },
  {
    _id: "682c3cd1d7441903b740a798",
    firstName: "John",
    lastName: "Doe",
    username: null, 
    dialCode: "+880",
    phone: "1234567890",
    photo: null,
    searchedPhone: "01234567890"  // Different original input format
  }
];

console.log('Example API Response:');
console.log(JSON.stringify(exampleApiResponse, null, 2));

console.log('\n=== Benefits of SearchedPhone Field ===');
console.log('✅ Track which input matched which user');
console.log('✅ Debug phone number matching issues'); 
console.log('✅ Frontend can map results back to original inputs');
console.log('✅ Analytics on common phone number formats');
console.log('✅ Better user experience (show original format)');

module.exports = {
  testNumbers,
  runTests: () => {
    console.log('Running dynamic phone number utility tests...');
    return {
      totalTests: testNumbers.length,
      validNumbers: testNumbers.filter(isValidPhoneNumber).length,
      coverage: 'International numbers without hardcoded dial codes'
    };
  }
}; 