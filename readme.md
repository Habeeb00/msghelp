# Manslater Message Capture Extension - Debug & Test Guide

## 🎯 Features Implemented

1. ✅ **On-demand message capture** from WhatsApp Web & Telegram Web
2. ✅ **Hash-based deduplication** (prevents duplicate messages)
3. ✅ **Storage limit** (keeps last 20 messages)
4. ✅ **Backend integration** (sends to https://manslater.onrender.com/chat)
5. ✅ **Platform detection** (auto-detects WhatsApp vs Telegram)
6. ✅ **Comprehensive debug logging** (all operations logged)

---

## 🚀 Quick Start

### 1. Install Extension
```
1. Open Chrome → chrome://extensions/
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the msghelp folder
```

### 2. View Debug Logs

**Background Service Worker** (message storage & deduplication):
```
1. Go to chrome://extensions/
2. Find "Manslater Capture"
3. Click "service worker" blue link
4. Console shows all [BACKGROUND], [HASH], [STORE], [CLEAR] logs
```

**Popup** (UI & capture logic):
```
1. Right-click extension icon
2. Select "Inspect popup"
3. Console shows all [POPUP] logs
```

**Injected Script** (page content extraction):
```
1. Open DevTools on WhatsApp/Telegram page (F12)
2. Console shows all [INJECTED] logs when capture runs
```

---

## 🧪 Run Automated Tests

### Option 1: Test Runner (Recommended)
```
1. Open test-runner.html in Chrome
2. Make sure extension is loaded
3. Click "Run All Tests"
4. Use helper buttons for specific tests
```

### Option 2: Manual Console Tests
```
1. Open Chrome DevTools (F12)
2. Copy/paste contents of test-suite.js
3. Press Enter to run all tests
```

---

## 📋 Test Checklist

### ✅ Test 1: Basic Functionality
- [ ] Extension loads without errors
- [ ] Popup opens when clicking icon
- [ ] Background service worker starts
- [ ] All 3 consoles show initialization logs

### ✅ Test 2: WhatsApp Capture
- [ ] Navigate to https://web.whatsapp.com
- [ ] Type message (don't send)
- [ ] Click "Capture Message"
- [ ] Check logs show WhatsApp detected
- [ ] Popup displays captured message

### ✅ Test 3: Telegram Capture
- [ ] Navigate to https://web.telegram.org
- [ ] Type message (don't send)
- [ ] Click "Capture Message"
- [ ] Check logs show Telegram detected
- [ ] Popup displays captured message

### ✅ Test 4: Deduplication
- [ ] Capture same message twice
- [ ] Second capture shows "DUPLICATE detected!" in background logs
- [ ] Only 1 copy appears in popup

### ✅ Test 5: Message Limit
- [ ] Use test-runner.html "Generate 25 Test Messages"
- [ ] Check storage shows only 20 messages
- [ ] Verify logs show "Trimmed to 20 messages"

### ✅ Test 6: Backend Send
- [ ] Capture a message
- [ ] Click "Send" button
- [ ] Check Network tab for POST to manslater.onrender.com
- [ ] Verify JSON payload sent

### ✅ Test 7: Clear Messages
- [ ] Click "Clear All"
- [ ] Check logs show messages cleared
- [ ] Popup shows empty list

---

## 🐛 Debug Log Reference

### Background Service Worker Logs

| Log | Meaning |
|-----|---------|
| `[BACKGROUND] Service worker initialized` | Extension loaded successfully |
| `[HASH] Generated hash: abc123` | Message hash created for deduplication |
| `[STORE] Attempting to store message` | New message being saved |
| `[STORE] Current messages count: X` | Shows existing message count |
| `[STORE] DUPLICATE detected!` | Message already exists (rejected) |
| `[STORE] Message added with hash` | New message saved successfully |
| `[STORE] Trimmed to X messages` | Storage limited to 20 max |
| `[STORE] ✓ Successfully saved` | Storage write complete |
| `[CLEAR] Clearing all messages` | Clear button clicked |
| `[CLEAR] ✓ All messages cleared` | Storage emptied |

### Popup Logs

| Log | Meaning |
|-----|---------|
| `[POPUP] Popup initialized` | Popup opened |
| `[POPUP] Loading messages from storage` | Reading saved messages |
| `[POPUP] Found X messages` | Number of messages loaded |
| `[POPUP] ✓ Messages rendered` | UI updated |
| `[POPUP] Capture button clicked` | User clicked capture |
| `[POPUP] Active tab URL: ...` | Current page URL |
| `[POPUP] Injecting script into tab` | About to extract message |
| `[POPUP] Script execution result` | Message extracted |
| `[POPUP] Sending message to backend` | POST request starting |
| `[POPUP] Backend response status: 200` | Backend responded |
| `[POPUP] Clear button clicked` | Clear all clicked |

### Injected Script Logs

| Log | Meaning |
|-----|---------|
| `[INJECTED] Running on hostname: ...` | Platform detected |
| `[INJECTED] WhatsApp detected` | WhatsApp Web identified |
| `[INJECTED] Telegram detected` | Telegram Web identified |
| `[INJECTED] Found text: "..."` | Message text extracted |

---

## 🔍 Common Issues & Solutions

### Issue: No logs appear
**Solution**: Make sure you're looking at the correct console:
- Background logs → chrome://extensions/ → "service worker"
- Popup logs → Right-click icon → "Inspect popup"
- Injected logs → F12 on WhatsApp/Telegram page

### Issue: "Error: Not on WhatsApp/Telegram"
**Solution**: Make sure you're on:
- https://web.whatsapp.com (not web.telegram.org)
- https://web.telegram.org (not web.whatsapp.com)

### Issue: "No message found"
**Solution**: 
- Type text in the input field
- Don't send it yet
- Then click "Capture Message"

### Issue: Duplicate not detected
**Solution**: Text must be EXACTLY the same (including spaces, case)

### Issue: Backend send fails
**Solution**: 
- Check internet connection
- Verify backend is running at https://manslater.onrender.com
- Check Network tab for exact error

---

## 📊 Line Count Summary

```
background.js:  ~70 lines (with debug logs)
popup.js:       ~120 lines (with debug logs)
popup.html:     ~17 lines
styles.css:     ~58 lines
manifest.json:  ~30 lines
-----------------------------------
Total:          ~295 lines (with extensive logging)
Core logic:     ~150 lines (without debug logs)
```

---

## 🎬 Full Integration Test

1. **Load extension** → Check background log shows initialized
2. **Open WhatsApp Web** → Login if needed
3. **Type message** → "Testing WhatsApp capture"
4. **Capture** → Check all 3 consoles show logs
5. **Open popup** → Message should appear
6. **Capture again** → Should show "DUPLICATE detected"
7. **Click Send** → Check Network tab
8. **Switch to Telegram** → https://web.telegram.org
9. **Type message** → "Testing Telegram capture"
10. **Capture** → Check logs show Telegram detected
11. **Open popup** → Should show 2 messages
12. **Generate 25 test messages** → Use test-runner.html
13. **Open popup** → Should show only 20 total
14. **Click Clear All** → Storage should be empty

**Expected Result**: All logs appear correctly, features work as designed! ✅

---

## 📁 Test Files

- `TEST_GUIDE.md` - Detailed manual test scenarios
- `test-suite.js` - Automated console tests
- `test-runner.html` - Interactive test interface
- `README.md` - This file

---

## 🎉 Success Criteria

✅ All console logs appear with correct prefixes  
✅ WhatsApp messages captured correctly  
✅ Telegram messages captured correctly  
✅ Duplicates rejected with log message  
✅ Only 20 messages stored maximum  
✅ Messages persist after popup closes  
✅ Backend POST requests sent successfully  
✅ Clear function empties storage  
✅ No console errors during normal operation  

---

**Happy Testing!** 🚀

## Customization
Replace the logic inside `content.js` with actual functionality. Use `chrome.storage.local.get('enabled')` everywhere you need to respect the toggle.

## Uninstall
Remove from `chrome://extensions`.
