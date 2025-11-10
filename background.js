// Background Service Worker - Message Storage
const MAX_MESSAGES = 20;

console.log('[BACKGROUND] Service worker initialized');

// Simple hash function for deduplication
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  const result = hash.toString(36);
  console.log(`[HASH] Generated hash: ${result} for text: "${str.substring(0, 30)}..."`);
  return result;
}

// Store message
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BACKGROUND] Received message:', msg.type);
  
  if (msg.type === "STORE_MESSAGE") {
    console.log('[STORE] Attempting to store message:', msg.message.text.substring(0, 50));
    
    chrome.storage.local.get(["messages"], (data) => {
      const messages = data.messages || [];
      console.log(`[STORE] Current messages count: ${messages.length}`);
      
      const hash = hashCode(msg.message.text);

      // Check for duplicates
      if (messages.some((m) => m.hash === hash)) {
        console.warn('[STORE] DUPLICATE detected! Hash:', hash);
        sendResponse({ success: false, error: "Duplicate message" });
        return;
      }

      // Add message with hash
      const newMessage = { ...msg.message, hash };
      messages.unshift(newMessage);
      console.log('[STORE] Message added with hash:', hash);

      // Keep only last 20
      const trimmed = messages.slice(0, MAX_MESSAGES);
      console.log(`[STORE] Trimmed to ${trimmed.length} messages (max: ${MAX_MESSAGES})`);

      chrome.storage.local.set({ messages: trimmed }, () => {
        console.log('[STORE] ✓ Successfully saved to storage');
        sendResponse({ success: true, count: trimmed.length });
      });
    });
    return true; // Async response
  }

  if (msg.type === "CLEAR_MESSAGES") {
    console.log('[CLEAR] Clearing all messages');
    chrome.storage.local.set({ messages: [] }, () => {
      console.log('[CLEAR] ✓ All messages cleared');
      sendResponse({ success: true });
    });
    return true;
  }
});
