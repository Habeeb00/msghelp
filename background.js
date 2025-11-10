// Background Service Worker
let enabled = false;
let outgoingBuffer = [];

console.log("[BG] Service worker initialized");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] msg:", msg.type);

  if (msg.type === "ENABLE_EXTENSION") {
    enabled = true;
    chrome.storage.local.set({ enabled: true });
    console.log("[BG] Extension ENABLED");

    // Send last 5 stored messages
    chrome.storage.local.get(["messages"], ({ messages = [] }) => {
      const last5 = messages.slice(0, 5);
      console.log(`[BG] Sending last ${last5.length} messages`);
      last5.forEach((m) => fetchSend(m));
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "DISABLE_EXTENSION") {
    enabled = false;
    outgoingBuffer = [];
    chrome.storage.local.set({ enabled: false });
    console.log("[BG] Extension DISABLED, buffer cleared");
    sendResponse({ ok: true });
    return true;
  }

  if (!enabled) return;

  if (msg.type === "CAPTURE_OUTGOING") {
    outgoingBuffer.push(msg.message);
    console.log(
      `[BG] Buffered outgoing message (total: ${outgoingBuffer.length})`
    );

    // Store in chrome.storage for history
    chrome.storage.local.get(["messages"], ({ messages = [] }) => {
      messages.unshift(msg.message);
      const trimmed = messages.slice(0, 20);
      chrome.storage.local.set({ messages: trimmed });
    });

    sendResponse({ buffered: true });
    return true;
  }

  if (msg.type === "INCOMING_RECEIVED") {
    console.log(`[BG] Incoming message received`);
    fetchSend(msg.message);
    sendResponse({ sent: true });
    return true;
  }
});

function fetchSend(message) {
  const payload = {
    text: message.text,
    platform: message.platform || "unknown",
    timestamp: message.timestamp || Date.now(),
  };

  console.log("[SEND]", payload);

  fetch("https://manslater.onrender.com/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => console.log("[SEND] status:", r.status))
    .catch((e) => console.error("[SEND] failed:", e));
}
