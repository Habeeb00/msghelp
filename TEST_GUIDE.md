# Extension Test Guide

## Setup
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked" and select the `msghelp` folder
4. Note the extension ID

## Debug Console Access
- **Background Service Worker Logs**: 
  - Go to `chrome://extensions/`
  - Find "Manslater Capture" extension
  - Click "service worker" link (blue text)
  - This opens DevTools for background.js

- **Popup Logs**:
  - Right-click the extension icon → "Inspect popup"
  - This opens DevTools for popup.js

- **Injected Script Logs**:
  - Open DevTools on WhatsApp/Telegram page (F12)
  - Logs prefixed with `[INJECTED]` appear here

## Test Scenarios

### Test 1: Platform Detection
**Objective**: Verify the extension detects WhatsApp/Telegram correctly

1. Navigate to https://web.whatsapp.com
2. Click extension icon to open popup
3. Click "Capture Message"
4. **Check Logs**:
   - Popup console: `[POPUP] Active tab URL: https://web.whatsapp.com`
   - WhatsApp page console: `[INJECTED] WhatsApp detected, using selector: .selectable-text[data-lexical-editor="true"]`

5. Navigate to https://web.telegram.org
6. Repeat steps 2-3
7. **Check Logs**:
   - Popup console: `[POPUP] Active tab URL: https://web.telegram.org`
   - Telegram page console: `[INJECTED] Telegram detected, using selector: .input-message-input`

**Expected Result**: ✓ Platform correctly identified in logs

---

### Test 2: Message Capture
**Objective**: Verify messages are captured from input fields

**WhatsApp Test**:
1. Go to https://web.whatsapp.com (login if needed)
2. Type a message in any chat: "Test message 1"
3. **DO NOT SEND** - just leave it in the input box
4. Click extension icon → "Capture Message"
5. **Check Logs**:
   - WhatsApp console: `[INJECTED] Found text: "Test message 1"`
   - Popup console: `[POPUP] Script execution result: {result: "Test message 1"}`
   - Background console: `[STORE] Attempting to store message: Test message 1`
   - Background console: `[STORE] ✓ Successfully saved to storage`

**Telegram Test**:
1. Go to https://web.telegram.org
2. Type a message: "Test message 2"
3. Repeat capture steps
4. **Check Logs**: Similar log pattern as WhatsApp

**Expected Result**: ✓ Message text captured and stored

---

### Test 3: Hash-Based Deduplication
**Objective**: Verify duplicate messages are rejected

1. Go to WhatsApp/Telegram
2. Type: "Duplicate test"
3. Capture the message (should succeed)
4. **Check Logs**:
   - Background: `[HASH] Generated hash: [some_hash] for text: "Duplicate test..."`
   - Background: `[STORE] Message added with hash: [hash]`

5. Capture the SAME message again (without changing text)
6. **Check Logs**:
   - Background: `[STORE] DUPLICATE detected! Hash: [same_hash]`
   - Background: Should NOT show "Successfully saved"

7. Open popup and verify only 1 copy of "Duplicate test" appears

**Expected Result**: ✓ Duplicate rejected, only 1 message stored

---

### Test 4: Message Limit (20 max)
**Objective**: Verify only last 20 messages are kept

1. Capture 25 different messages (change text each time):
   - "Message 1", "Message 2", ... "Message 25"
2. **Check Logs** after each capture:
   - Background: `[STORE] Current messages count: [number]`
   - Background: `[STORE] Trimmed to [number] messages (max: 20)`

3. After all captures, check popup
4. **Check Logs**:
   - Popup: `[POPUP] Found 20 messages` (not 25)

5. Verify popup shows only the last 20 messages

**Expected Result**: ✓ Only 20 messages retained

---

### Test 5: Storage Persistence
**Objective**: Verify messages persist after popup closes

1. Capture 3 messages
2. Close the popup
3. **Open DevTools** for service worker (chrome://extensions/)
4. Check storage:
   ```javascript
   chrome.storage.local.get('messages', (data) => console.log(data))
   ```
5. Should see 3 messages with hash, text, timestamp

6. Reopen popup
7. **Check Logs**:
   - Popup: `[POPUP] Found 3 messages`

**Expected Result**: ✓ Messages persist and reload

---

### Test 6: Backend Integration
**Objective**: Verify messages can be sent to backend

1. Capture a message
2. Click the "Send" button next to it
3. **Check Logs**:
   - Popup: `[POPUP] Sending message to backend: [text]`
   - Popup: `[POPUP] Backend response status: 200` (or error code)

4. **Check Network Tab** (in popup DevTools):
   - Filter for "manslater.onrender.com"
   - Verify POST request with JSON body: `{"message": "..."}`

**Expected Result**: ✓ POST request sent to backend

---

### Test 7: Clear Messages
**Objective**: Verify clear functionality works

1. Capture several messages
2. Click "Clear All" button
3. **Check Logs**:
   - Popup: `[POPUP] Clear button clicked`
   - Background: `[CLEAR] Clearing all messages`
   - Background: `[CLEAR] ✓ All messages cleared`
   - Popup: `[POPUP] Found 0 messages`

4. Verify popup shows no messages

**Expected Result**: ✓ All messages cleared

---

### Test 8: Error Handling
**Objective**: Verify graceful error handling

**Test 8a: Wrong Website**
1. Go to https://google.com
2. Click extension icon → "Capture Message"
3. **Check Logs**:
   - Popup: `[POPUP] Error during capture: [error details]`
   - Status shows: "Error: Not on WhatsApp/Telegram"

**Test 8b: Empty Input**
1. Go to WhatsApp with NO text in input
2. Try to capture
3. **Check Logs**:
   - Injected: `[INJECTED] Found text: null`
   - Status shows: "No message found"

**Expected Result**: ✓ Errors handled gracefully

---

## Log Summary Checklist

### Background Service Worker Logs
- [ ] `[BACKGROUND] Service worker initialized`
- [ ] `[HASH] Generated hash: ...`
- [ ] `[STORE] Attempting to store message: ...`
- [ ] `[STORE] Current messages count: ...`
- [ ] `[STORE] Message added with hash: ...`
- [ ] `[STORE] Trimmed to X messages (max: 20)`
- [ ] `[STORE] ✓ Successfully saved to storage`
- [ ] `[STORE] DUPLICATE detected!` (when duplicate)
- [ ] `[CLEAR] Clearing all messages`
- [ ] `[CLEAR] ✓ All messages cleared`

### Popup Logs
- [ ] `[POPUP] Popup initialized`
- [ ] `[POPUP] Loading messages from storage...`
- [ ] `[POPUP] Found X messages`
- [ ] `[POPUP] ✓ Messages rendered`
- [ ] `[POPUP] Capture button clicked`
- [ ] `[POPUP] Active tab URL: ...`
- [ ] `[POPUP] Injecting script into tab...`
- [ ] `[POPUP] Script execution result: ...`
- [ ] `[POPUP] Sending message to background for storage...`
- [ ] `[POPUP] Background response: ...`
- [ ] `[POPUP] Send button clicked for message index: ...`
- [ ] `[POPUP] Sending message to backend: ...`
- [ ] `[POPUP] Backend response status: ...`
- [ ] `[POPUP] Clear button clicked`

### Injected Script Logs
- [ ] `[INJECTED] Running on hostname: ...`
- [ ] `[INJECTED] WhatsApp detected, using selector: ...`
- [ ] `[INJECTED] Telegram detected, using selector: ...`
- [ ] `[INJECTED] Found text: ...`

---

## Quick Smoke Test (5 minutes)

1. ✓ Load extension
2. ✓ Go to WhatsApp, capture 1 message
3. ✓ Go to Telegram, capture 1 message  
4. ✓ Open popup, see 2 messages
5. ✓ Click Send on one message
6. ✓ Capture same message again (should be rejected)
7. ✓ Click Clear All
8. ✓ Verify popup empty

**All logs should appear with appropriate prefixes!**
