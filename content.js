// Content Script - WhatsApp & Telegram
const platform = location.hostname.includes("web.whatsapp.com")
  ? "whatsapp"
  : location.hostname.includes("web.telegram.org")
  ? "telegram"
  : "unknown";

console.log(`[CONTENT] Loaded on ${platform}`);

// Simple interval-based detection (MVP - no MutationObserver)
let lastOutgoing = "";
let lastIncoming = "";

setInterval(() => {
  // Detect outgoing message
  let outgoingSelector =
    platform === "whatsapp"
      ? '.selectable-text[data-lexical-editor="true"]'
      : ".input-message-input";

  const outgoingEl = document.querySelector(outgoingSelector);
  if (outgoingEl) {
    const text = outgoingEl.textContent.trim();
    if (text && text !== lastOutgoing) {
      lastOutgoing = text;
      console.log("[CONTENT] Outgoing detected:", text.substring(0, 30));
      chrome.runtime.sendMessage({
        type: "CAPTURE_OUTGOING",
        message: { text, platform, timestamp: Date.now() },
      });
    }
  }

  // Detect incoming message (last message in chat)
  let incomingSelector =
    platform === "whatsapp"
      ? "div[data-pre-plain-text]:last-child .selectable-text"
      : ".message.incoming:last-child .text-content";

  const incomingEl = document.querySelector(incomingSelector);
  if (incomingEl) {
    const text = incomingEl.textContent.trim();
    if (text && text !== lastIncoming) {
      lastIncoming = text;
      console.log("[CONTENT] Incoming detected:", text.substring(0, 30));
      chrome.runtime.sendMessage({
        type: "INCOMING_RECEIVED",
        message: { text, platform, timestamp: Date.now() },
      });
    }
  }
}, 1000);
