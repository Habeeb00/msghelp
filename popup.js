// Minimal popup script - shows captured messages and offers a self-test
const toggle = document.getElementById("toggle");
const statusDiv = document.getElementById("status");
const messagesList = document.getElementById("messagesList");
const selftestBtn = document.getElementById("selftest");
const selftestResult = document.getElementById("selftestResult");
const msgCount = document.getElementById("msgCount");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const scanBtn = document.getElementById("scanBtn");
const resetBtn = document.getElementById("resetBtn");
const debugBtn = document.getElementById("debugBtn");
const suggestReplyBtn = document.getElementById("suggestReplyBtn");
const contextInfo = document.getElementById("contextInfo");
const contextCount = document.getElementById("contextCount");
const newCount = document.getElementById("newCount");
const currentSession = document.getElementById("currentSession");
const API_ENDPOINT = "http://localhost:8000/suggest-reply"; // Replace with your backend API endpoint

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return String(ts);
  }
}

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMessages() {
  chrome.storage.local.get(["messages"], ({ messages = [] }) => {
    // Only display the most recent 5 messages (storage is capped at 5 by content script,
    // but self-test or other tools may have written more), so slice defensively.
    messages = messages.slice(0, 5);
    messagesList.innerHTML = "";
    msgCount.textContent = `(${messages.length})`;

    // Calculate stats
    const contextMsgs = messages.filter((m) => m.isContext);
    const newMsgs = messages.filter((m) => !m.isContext);
    const sessions = [
      ...new Set(messages.map((m) => m.sessionId || "unknown")),
    ];

    contextCount.textContent = contextMsgs.length;
    newCount.textContent = newMsgs.length;
    currentSession.textContent = sessions.length > 0 ? sessions[0] : "None";
    contextInfo.textContent = contextMsgs.length > 0 ? "Loaded" : "Not loaded";

    if (!messages || messages.length === 0) {
      messagesList.textContent = "No messages captured yet.";
      return;
    }
    // Render messages (most recent first)
    messages.forEach((m, idx) => {
      const row = document.createElement("div");
      row.style.borderBottom = "1px solid #eee";
      row.style.padding = "6px 4px";

      // Add session info and type indicators
      const sessionInfo = m.sessionId
        ? `📱 ${escapeHtml(m.chatTitle || "Unknown Chat")}`
        : "";
      const messageType = m.isContext ? "📖 Context" : "💬 New";
      const directionIcon =
        m.type === "outgoing" ? "➡️" : m.type === "incoming" ? "⬅️" : "❓";

      row.innerHTML = `
        <div style="font-size:11px;color:#666; display: flex; justify-content: space-between;">
          <span>${idx + 1}. ${messageType} ${directionIcon} ${escapeHtml(
        m.type || ""
      )}</span>
          <span>${formatTime(m.timestamp)}</span>
        </div>
        <div style="font-size:10px;color:#999;margin-top:2px;">${sessionInfo}</div>
        <div style="margin-top:4px;white-space:pre-wrap;background:${
          m.isContext ? "#f8f9fa" : "#e8f5e9"
        };padding:4px;border-radius:3px;">${escapeHtml(m.text)}</div>
      `;
      messagesList.appendChild(row);
    });
  });
}

// initial state
chrome.storage.local.get(["enabled"], ({ enabled = false }) => {
  toggle.checked = enabled;
  statusDiv.textContent = enabled ? "Extension ON" : "Extension OFF";
});

toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled }, () => {
    statusDiv.textContent = enabled ? "Extension ON" : "Extension OFF";
  });
});

// self-test: directly seed chrome.storage with messages (no background required)
selftestBtn.addEventListener("click", async () => {
  selftestResult.textContent = "Running self-test...";
  const seeds = [
    "Hello — seed 1",
    "How's it going? — seed 2",
    "Are you there? — seed 3",
    "This is context — seed 4",
  ];
  const incoming = "Incoming test message — please suggest reply";

  // prepend seeds and incoming to storage
  chrome.storage.local.get(["messages"], ({ messages = [] }) => {
    const now = Date.now();
    const seeded = [];
    for (const s of seeds)
      seeded.push({
        text: s,
        platform: "whatsapp",
        timestamp: now - 1000,
        type: "outgoing",
      });
    seeded.push({
      text: incoming,
      platform: "whatsapp",
      timestamp: now,
      type: "incoming",
    });
    // keep existing behavior but don't artificially cap display here
    const combined = seeded.concat(messages).slice(0, 5);
    chrome.storage.local.set({ messages: combined }, () => {
      renderMessages();
      selftestResult.textContent = "Self-test done";
    });
  });
});

// Suggest Reply button handler
if (suggestReplyBtn) {
  suggestReplyBtn.addEventListener("click", async () => {
    selftestResult.textContent = "Getting reply suggestion...";
    try {
      const { messages = [] } = await chrome.storage.local.get(["messages"]);
      if (messages.length === 0) {
        selftestResult.textContent = "No messages to suggest a reply for.";
        setTimeout(() => (selftestResult.textContent = ""), 2000);
        return;
      }

      // The most recent message is the current message
      const currentMessage = messages[0];
      // The next 4 messages are context messages
      const contextMessages = messages.slice(1, 5).map(msg => ({
        text: msg.text,
        type: msg.type,
        timestamp: msg.timestamp
      }));

      const payload = {
        current_message: {
          text: currentMessage.text,
          platform: currentMessage.platform,
          timestamp: currentMessage.timestamp
        },
        context_messages: contextMessages
      };

      console.log("[POPUP] Sending payload to backend:", payload);

      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Backend error: ${response.status} - ${errorData.detail || response.statusText}`);
      }

      const data = await response.json();
      selftestResult.textContent = `Suggestion: "${data.suggestion}" (Cached: ${data.cached})`;
      console.log("[POPUP] Reply suggestion:", data.suggestion);
      setTimeout(() => (selftestResult.textContent = ""), 5000); // Display suggestion for 5 seconds

    } catch (e) {
      console.error("[POPUP] Error suggesting reply:", e);
      selftestResult.textContent = `Error: ${e.message}`;
      setTimeout(() => (selftestResult.textContent = ""), 5000);
    }
  });
}

// clear messages
clearBtn.addEventListener("click", () => {
  chrome.storage.local.set({ messages: [] }, () => {
    renderMessages();
  });
});

// scan active chat now (ask content script to run scanExisting)
if (scanBtn) {
  scanBtn.addEventListener("click", () => {
    selftestResult.textContent = "Scanning active chat...";
    // prefer an open WhatsApp Web tab instead of whatever tab is active
    chrome.tabs.query({}, (tabs) => {
      const wa = tabs.find(
        (t) => t && t.url && t.url.includes("web.whatsapp.com")
      );
      if (!wa) {
        selftestResult.textContent =
          "No WhatsApp Web tab found — open https://web.whatsapp.com and focus a chat, then try again.";
        return;
      }
      chrome.tabs.sendMessage(wa.id, { type: "SCAN_NOW" }, (resp) => {
        if (chrome.runtime.lastError) {
          // common: receiving end does not exist -> content script not injected
          selftestResult.textContent =
            "Scan failed: " +
            chrome.runtime.lastError.message +
            ". Try reloading the WhatsApp tab and the extension.";
          return;
        }
        renderMessages();
        selftestResult.textContent =
          resp && resp.ok ? "Scan complete" : "Scan finished";
        setTimeout(() => (selftestResult.textContent = ""), 2000);
      });
    });
  });
}

// export messages to clipboard as JSON
exportBtn.addEventListener("click", async () => {
  chrome.storage.local.get(["messages"], ({ messages = [] }) => {
    const json = JSON.stringify(messages, null, 2);
    // try clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(json)
        .then(() => {
          selftestResult.textContent = "Exported JSON to clipboard";
          setTimeout(() => (selftestResult.textContent = ""), 2000);
        })
        .catch(() => {
          // fallback: open in new window
          const w = window.open();
          w.document.open();
          w.document.write("<pre>" + escapeHtml(json) + "</pre>");
          w.document.close();
        });
    } else {
      const w = window.open();
      w.document.open();
      w.document.write("<pre>" + escapeHtml(json) + "</pre>");
      w.document.close();
    }
  });
});

// Add handlers for new testing buttons
resetBtn.addEventListener("click", () => {
  chrome.storage.local.clear(() => {
    // Send message to content script to reset its state
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "RESET_STATE" });
      }
    });
    renderMessages();
    selftestResult.textContent = "Reset complete - all data cleared";
    setTimeout(() => (selftestResult.textContent = ""), 2000);
  });
});

debugBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "GET_DEBUG_INFO" },
        (response) => {
          if (response) {
            const debugInfo = `Debug Info:
Existing Messages: ${response.existingMessagesCount}
Recent Buffer: ${response.recentCount}
Current Session: ${response.currentSessionId}
Last Chat Change: ${response.lastChatChangeTime}
Total Messages in Storage: ${response.storageCount}`;

            selftestResult.textContent = "Debug info displayed in alert";
            alert(debugInfo);
            setTimeout(() => (selftestResult.textContent = ""), 2000);
          } else {
            selftestResult.textContent =
              "No response from content script. Make sure you are on WhatsApp Web.";
            setTimeout(() => (selftestResult.textContent = ""), 3000);
          }
        }
      );
    }
  });
});

// update UI when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.messages) renderMessages();
});

renderMessages();
