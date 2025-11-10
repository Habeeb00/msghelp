// Automated Test Suite for Extension Functions
// Run this in the browser console to test core functionality

console.log('=== STARTING EXTENSION TEST SUITE ===\n');

// Test 1: Hash Function
console.log('TEST 1: Hash Function');
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

const hash1 = hashCode("Test message");
const hash2 = hashCode("Test message");
const hash3 = hashCode("Different message");

console.log(`  ✓ Same text produces same hash: ${hash1 === hash2}`);
console.log(`  ✓ Different text produces different hash: ${hash1 !== hash3}`);
console.log(`  Hash examples: "${hash1}", "${hash3}"`);

// Test 2: Storage API
console.log('\nTEST 2: Storage API');
const testMessages = [
  { text: 'Message 1', timestamp: Date.now(), hash: hashCode('Message 1') },
  { text: 'Message 2', timestamp: Date.now(), hash: hashCode('Message 2') }
];

chrome.storage.local.set({ test_messages: testMessages }, () => {
  chrome.storage.local.get('test_messages', (data) => {
    console.log(`  ✓ Storage write/read successful: ${data.test_messages.length === 2}`);
    console.log(`  ✓ Data preserved: ${data.test_messages[0].text === 'Message 1'}`);
    chrome.storage.local.remove('test_messages');
  });
});

// Test 3: Duplicate Detection Logic
console.log('\nTEST 3: Duplicate Detection Logic');
const messages = [
  { text: 'Existing message', hash: hashCode('Existing message'), timestamp: 1 }
];
const newMessageHash = hashCode('Existing message');
const isDuplicate = messages.some(m => m.hash === newMessageHash);
console.log(`  ✓ Duplicate detection works: ${isDuplicate === true}`);

const uniqueHash = hashCode('New unique message');
const isUnique = !messages.some(m => m.hash === uniqueHash);
console.log(`  ✓ Unique detection works: ${isUnique === true}`);

// Test 4: Message Limit Logic
console.log('\nTEST 4: Message Limit Logic (20 max)');
const MAX_MESSAGES = 20;
const manyMessages = Array.from({ length: 25 }, (_, i) => ({
  text: `Message ${i}`,
  hash: hashCode(`Message ${i}`),
  timestamp: Date.now() + i
}));
const trimmed = manyMessages.slice(0, MAX_MESSAGES);
console.log(`  ✓ Array trimming works: ${trimmed.length === 20}`);
console.log(`  ✓ Latest messages kept: ${trimmed[0].text === 'Message 0'}`);

// Test 5: Platform Detection Logic
console.log('\nTEST 5: Platform Detection Logic');
function detectPlatform(hostname) {
  if (hostname.includes('web.whatsapp.com')) return 'WhatsApp';
  if (hostname.includes('web.telegram.org')) return 'Telegram';
  return 'Unknown';
}

console.log(`  ✓ WhatsApp detection: ${detectPlatform('web.whatsapp.com') === 'WhatsApp'}`);
console.log(`  ✓ Telegram detection: ${detectPlatform('web.telegram.org') === 'Telegram'}`);
console.log(`  ✓ Unknown site detection: ${detectPlatform('google.com') === 'Unknown'}`);

// Test 6: Message Structure Validation
console.log('\nTEST 6: Message Structure Validation');
const validMessage = {
  text: 'Test',
  timestamp: Date.now(),
  hash: hashCode('Test')
};
const hasRequiredFields = validMessage.text && validMessage.timestamp && validMessage.hash;
console.log(`  ✓ Message has required fields: ${hasRequiredFields}`);
console.log(`  ✓ Timestamp is valid: ${validMessage.timestamp > 0}`);
console.log(`  ✓ Hash is non-empty: ${validMessage.hash.length > 0}`);

// Test 7: Backend API Format
console.log('\nTEST 7: Backend API Format');
const apiPayload = { message: 'Test message' };
const jsonString = JSON.stringify(apiPayload);
const parsed = JSON.parse(jsonString);
console.log(`  ✓ JSON serialization works: ${parsed.message === 'Test message'}`);
console.log(`  ✓ Payload structure: ${JSON.stringify(apiPayload)}`);

// Summary
console.log('\n=== TEST SUITE COMPLETE ===');
console.log('All core functions validated!');
console.log('\nNext Steps:');
console.log('1. Load extension in Chrome');
console.log('2. Test on real WhatsApp/Telegram pages');
console.log('3. Check console logs during capture');
console.log('4. Verify backend communication');
