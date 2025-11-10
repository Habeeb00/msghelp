const captureBtn = document.getElementById("captureBtn");
const clearBtn = document.getElementById("clearBtn");
const statusDiv = document.getElementById("status");
const messagesDiv = document.getElementById("messages");

console.log('[POPUP] Popup initialized');

// Load and display messages
async function loadMessages() {
  console.log('[POPUP] Loading messages from storage...');
  const { messages = [] } = await chrome.storage.local.get("messages");
  console.log(`[POPUP] Found ${messages.length} messages`);
  
  messagesDiv.innerHTML = messages
    .map(
      (msg, i) => `
    <div class="message">
      <span>${msg.text}</span>
      <button class="send-btn" data-index="${i}">Send</button>
    </div>
  `
    )
    .join("");

  document.querySelectorAll(".send-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      console.log(`[POPUP] Send button clicked for message index: ${btn.dataset.index}`);
      sendMessage(messages[btn.dataset.index]);
    });
  });
  
  console.log('[POPUP] ✓ Messages rendered');
}

// Capture message from active tab
captureBtn.addEventListener("click", async () => {
  console.log('[POPUP] Capture button clicked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log(`[POPUP] Active tab URL: ${tab.url}`);

  try {
    console.log('[POPUP] Injecting script into tab...');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const hostname = location.hostname;
        console.log('[INJECTED] Running on hostname:', hostname);
        let selector = "";

        if (hostname.includes("web.whatsapp.com")) {
          selector = '.selectable-text[data-lexical-editor="true"]';
          console.log('[INJECTED] WhatsApp detected, using selector:', selector);
        } else if (hostname.includes("web.telegram.org")) {
          selector = ".input-message-input";
          console.log('[INJECTED] Telegram detected, using selector:', selector);
        } else {
          console.warn('[INJECTED] Unknown platform:', hostname);
        }

        const el = document.querySelector(selector);
        const text = el ? el.textContent.trim() : null;
        console.log('[INJECTED] Found text:', text ? `"${text.substring(0, 50)}..."` : 'null');
        return text;
      },
    });

    console.log('[POPUP] Script execution result:', result);

    if (result.result) {
      console.log('[POPUP] Sending message to background for storage...');
      chrome.runtime.sendMessage({
        type: "STORE_MESSAGE",
        message: { text: result.result, timestamp: Date.now() },
      }, (response) => {
        console.log('[POPUP] Background response:', response);
      });
      statusDiv.textContent = "Message captured!";
      setTimeout(() => {
        statusDiv.textContent = "";
        loadMessages();
      }, 2000);
    } else {
      console.warn('[POPUP] No message found in input field');
      statusDiv.textContent = "No message found";
    }
  } catch (err) {
    console.error('[POPUP] Error during capture:', err);
    statusDiv.textContent = "Error: Not on WhatsApp/Telegram";
  }
});

// Send message to backend
async function sendMessage(msg) {
  console.log('[POPUP] Sending message to backend:', msg.text.substring(0, 50));
  try {
    const response = await fetch("https://manslater.onrender.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg.text }),
    });
    console.log('[POPUP] Backend response status:', response.status);
    statusDiv.textContent = response.ok ? "Sent to backend!" : "Send failed";
  } catch (err) {
    console.error('[POPUP] Network error:', err);
    statusDiv.textContent = "Network error";
  }
  setTimeout(() => (statusDiv.textContent = ""), 2000);
}

// Clear all messages
clearBtn.addEventListener("click", () => {
  console.log('[POPUP] Clear button clicked');
  chrome.runtime.sendMessage({ type: "CLEAR_MESSAGES" }, (response) => {
    console.log('[POPUP] Clear response:', response);
  });
  loadMessages();
  statusDiv.textContent = "Messages cleared";
  setTimeout(() => (statusDiv.textContent = ""), 2000);
});

console.log('[POPUP] Setting up initial load...');
loadMessages();
