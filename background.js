// Chrome Extension Background - Context Window with Reply Suggestions
let enabled = false;
let conversationHistory = []; // Stores all messages
let sessionId = null;
let pendingRequests = new Map(); // Track pending API calls
let responseCache = new Map(); // Cache for similar contexts

const CONFIG = {
  API_URL: "https://manslater.onrender.com",
  CONTEXT_WINDOW: 4, // Number of previous messages to include
  CACHE_SIZE: 30,
  CACHE_TTL: 600000, // 10 minutes
  DEBOUNCE_DELAY: 300, // ms
};

console.log("[BG] Service worker initialized");

// Restore session and history on startup
chrome.storage.local.get(["sessionId", "conversationHistory"], (data) => {
  if (data.sessionId) {
    sessionId = data.sessionId;
    console.log("[BG] Restored session:", sessionId);
  }
  if (data.conversationHistory) {
    conversationHistory = data.conversationHistory;
    console.log("[BG] Restored history:", conversationHistory.length);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] msg:", msg.type);

  if (msg.type === "ENABLE_EXTENSION") {
    handleEnable(msg, sendResponse);
    return true;
  }

  if (msg.type === "DISABLE_EXTENSION") {
    handleDisable(sendResponse);
    return true;
  }

  if (!enabled) {
    sendResponse({ enabled: false });
    return;
  }

  if (msg.type === "CAPTURE_OUTGOING") {
    handleOutgoing(msg.message, sendResponse);
    return true;
  }

  if (msg.type === "INCOMING_RECEIVED") {
    handleIncoming(msg.message, sendResponse);
    return true;
  }

  if (msg.type === "GET_SUGGESTION") {
    handleGetSuggestion(msg.messageId, sendResponse);
    return true;
  }
});

async function handleEnable(msg, sendResponse) {
  enabled = true;
  await chrome.storage.local.set({ enabled: true });
  console.log("[BG] Extension ENABLED");

  // If current message provided, get reply suggestion immediately
  if (msg.currentMessage) {
    console.log("[BG] Processing current message on enable");
    
    // Get last 4 messages from storage as context
    const stored = await getStoredMessages();
    const context = stored.slice(0, CONFIG.CONTEXT_WINDOW);
    
    // Add current message to history
    const messageToReply = {
      text: msg.currentMessage.text,
      platform: msg.currentMessage.platform || "unknown",
      timestamp: Date.now(),
      type: "incoming",
      id: generateId(),
    };
    
    conversationHistory.unshift(messageToReply);
    await saveConversationHistory();
    
    // Get reply suggestion
    const suggestion = await fetchReplySuggestion(messageToReply, context);
    
    sendResponse({ 
      ok: true, 
      sessionId,
      suggestion,
      messageId: messageToReply.id
    });
  } else {
    sendResponse({ ok: true, sessionId });
  }
}

async function handleDisable(sendResponse) {
  enabled = false;
  pendingRequests.clear();
  
  await chrome.storage.local.set({ enabled: false });
  console.log("[BG] Extension DISABLED");
  sendResponse({ ok: true });
}

async function handleOutgoing(message, sendResponse) {
  // Store user's sent message (no API call needed for outgoing)
  const outgoingMsg = {
    ...message,
    type: "outgoing",
    id: message.id || generateId(),
    timestamp: Date.now(),
  };
  
  conversationHistory.unshift(outgoingMsg);
  console.log(`[BG] Stored outgoing message (history: ${conversationHistory.length})`);
  
  // Save to storage
  await saveConversationHistory();
  
  sendResponse({ 
    buffered: true, 
    messageId: outgoingMsg.id,
    historySize: conversationHistory.length
  });
}

async function handleIncoming(message, sendResponse) {
  console.log("[BG] New incoming message - getting reply suggestion");
  
  // Store incoming message
  const incomingMsg = {
    ...message,
    type: "incoming",
    id: message.id || generateId(),
    timestamp: Date.now(),
  };
  
  conversationHistory.unshift(incomingMsg);
  await saveConversationHistory();
  
  // Get last 4 messages as context (excluding the current one)
  const context = conversationHistory.slice(1, CONFIG.CONTEXT_WINDOW + 1);
  
  // Check cache first
  const cacheKey = getCacheKey(incomingMsg, context);
  if (responseCache.has(cacheKey)) {
    const cached = responseCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
      console.log("[BG] Cache HIT for reply suggestion");
      sendResponse({ 
        sent: true, 
        suggestion: cached.data,
        messageId: incomingMsg.id,
        cached: true
      });
      return;
    } else {
      responseCache.delete(cacheKey);
    }
  }
  
  // Debounce: if request already pending for similar context, wait
  if (pendingRequests.has(cacheKey)) {
    console.log("[BG] Request already pending, waiting...");
    try {
      const result = await pendingRequests.get(cacheKey);
      sendResponse({ 
        sent: true, 
        suggestion: result,
        messageId: incomingMsg.id,
        deduped: true
      });
    } catch (error) {
      sendResponse({ sent: false, error: error.message });
    }
    return;
  }
  
  // Fetch reply suggestion
  try {
    const suggestionPromise = fetchReplySuggestion(incomingMsg, context);
    pendingRequests.set(cacheKey, suggestionPromise);
    
    const suggestion = await suggestionPromise;
    
    // Cache the result
    updateCache(cacheKey, suggestion);
    
    pendingRequests.delete(cacheKey);
    
    sendResponse({ 
      sent: true, 
      suggestion,
      messageId: incomingMsg.id,
      contextSize: context.length
    });
  } catch (error) {
    pendingRequests.delete(cacheKey);
    console.error("[BG] Failed to get reply suggestion:", error);
    sendResponse({ sent: false, error: error.message });
  }
}

function handleGetSuggestion(messageId, sendResponse) {
  // Find message in history
  const message = conversationHistory.find(m => m.id === messageId);
  
  if (!message) {
    sendResponse({ found: false });
    return;
  }
  
  const context = getContextForMessage(messageId);
  const cacheKey = getCacheKey(message, context);
  
  if (responseCache.has(cacheKey)) {
    sendResponse({ 
      found: true, 
      suggestion: responseCache.get(cacheKey).data 
    });
  } else {
    sendResponse({ found: false });
  }
}

// Fetch reply suggestion from API
async function fetchReplySuggestion(messageToReply, contextMessages) {
  const payload = {
    current_message: {
      text: messageToReply.text,
      platform: messageToReply.platform,
      timestamp: messageToReply.timestamp,
    },
    context_messages: contextMessages.map(m => ({
      text: m.text,
      type: m.type, // "incoming" or "outgoing"
      timestamp: m.timestamp,
    })),
    session_id: sessionId,
  };

  console.log(`[SEND] Getting reply for message with ${contextMessages.length} context msgs`);

  const response = await fetch(`${CONFIG.API_URL}/suggest-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Store session ID if new
  if (data.session_id && !sessionId) {
    sessionId = data.session_id;
    await chrome.storage.local.set({ sessionId });
  }

  console.log("[SEND] Reply suggestion received");
  return data.suggestion;
}

// Helper functions
function getCacheKey(message, context) {
  // Create cache key from message + context
  const contextStr = context.map(m => `${m.type}:${m.text}`).join("|");
  return hashString(`${message.text}::${contextStr}`);
}

function updateCache(key, value) {
  // LRU cache
  if (responseCache.size >= CONFIG.CACHE_SIZE) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
  
  responseCache.set(key, {
    data: value,
    timestamp: Date.now(),
  });
}

function getContextForMessage(messageId) {
  const index = conversationHistory.findIndex(m => m.id === messageId);
  if (index === -1) return [];
  
  // Get 4 messages before this one
  return conversationHistory.slice(index + 1, index + CONFIG.CONTEXT_WINDOW + 1);
}

function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function getStoredMessages() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["conversationHistory"], ({ conversationHistory = [] }) => {
      resolve(conversationHistory);
    });
  });
}

async function saveConversationHistory() {
  // Keep only last 50 messages in storage
  const trimmed = conversationHistory.slice(0, 50);
  await chrome.storage.local.set({ 
    conversationHistory: trimmed,
    lastUpdated: Date.now()
  });
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_TTL) {
      responseCache.delete(key);
    }
  }
  console.log(`[BG] Cache cleanup: ${responseCache.size} entries`);
}, 120000); // Every 2 minutes
