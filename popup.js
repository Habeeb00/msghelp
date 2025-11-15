// Popup script - upgraded to support tabs (History / Debug / Config)
const API_ENDPOINT = "https://msghelp.onrender.com/suggest-reply";
// Replace with your backend API endpoint

// Elements for Home/Suggestions
const toggle = document.getElementById("toggle");
const statusDiv = document.getElementById("status");
const manslaterToggle = document.getElementById("manslater-toggle");
const manslaterStatus = document.getElementById("manslater-status");
const suggestReplyBtn = document.getElementById("suggestReplyBtn");
const suggestionStatus = document.getElementById("suggestion-status");
const logDropdown = document.getElementById("log-dropdown");

// Elements for History
const messagesList = document.getElementById("messagesList");
const msgCount = document.getElementById("msgCount");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const scanBtn = document.getElementById("scanBtn");
const testFloatingBtn = document.getElementById("testFloatingBtn");
const refreshHistoryBtn = document.getElementById("refresh-history");

// Elements for Logs
const debugLast = document.getElementById("debug-last");
const debugCount = document.getElementById("debug-count");
const dumpBtn = document.getElementById("dump-messages");
const resetBtn = document.getElementById("resetBtn");

// Config elements
const enableSuggestionsEl = document.getElementById("enable-suggestions");
const maxHistoryEl = document.getElementById("max-history");
const saveConfigBtn = document.getElementById("save-config");

// UI feedback element for suggestion status
const selftestResult = suggestionStatus || debugLast || statusDiv;

// Tab handling
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", (e) => {
    document
      .querySelectorAll(".tab")
      .forEach((b) => b.classList.remove("active"));
    e.currentTarget.classList.add("active");
    const target = e.currentTarget.dataset.target;
    document
      .querySelectorAll(".page")
      .forEach((p) => p.classList.remove("active"));
    const page = document.getElementById(target);
    if (page) page.classList.add("active");
  })
);

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

function updateManslaterStatus(enabled) {
  if (manslaterStatus) {
    manslaterStatus.textContent = enabled ? "Manslater ON" : "Manslater OFF";
  }
  if (manslaterToggle) {
    manslaterToggle.checked = !!enabled;
  }
}

// Small helper to read chrome.storage with Promise syntax
function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function renderMessages() {
  chrome.storage.local.get(["messages"], ({ messages = [] }) => {
    messages = messages.slice(0, 50);
    messagesList.innerHTML = "";
    msgCount.textContent = `(${messages.length})`;

    // Update debug count when available
    if (debugCount) debugCount.textContent = messages.length;

    if (!messages || messages.length === 0) {
      messagesList.innerHTML =
        '<div class="placeholder">No messages captured yet.</div>';
      return;
    }

    messages.forEach((m, idx) => {
      const row = document.createElement("div");
      row.className = "message-row";
      const meta = document.createElement("div");
      meta.className = "meta";
      const label = document.createElement("div");
      label.textContent = `${idx + 1}. ${m.isContext ? "Context" : "New"}`;
      const time = document.createElement("div");
      time.className = "mono";
      time.textContent = formatTime(m.timestamp || Date.now());
      meta.appendChild(label);
      meta.appendChild(time);

      const text = document.createElement("div");
      text.className = "text";
      text.textContent = m.text || "";

      row.appendChild(meta);
      row.appendChild(text);
      messagesList.appendChild(row);
    });
  });
}

// initial state
if (toggle && statusDiv) {
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
}

if (manslaterToggle && manslaterStatus) {
  chrome.storage.local.get(["manslaterMode"], ({ manslaterMode = false }) => {
    updateManslaterStatus(!!manslaterMode);
  });

  manslaterToggle.addEventListener("change", () => {
    const enabled = manslaterToggle.checked;
    chrome.storage.local.set({ manslaterMode: enabled }, () => {
      updateManslaterStatus(enabled);
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (Object.prototype.hasOwnProperty.call(changes, "manslaterMode")) {
    updateManslaterStatus(!!changes.manslaterMode.newValue);
  }
});

// self-test: directly seed chrome.storage with messages (no background required)
if (selftestBtn) {
  selftestBtn.addEventListener("click", async () => {
    if (selftestResult) selftestResult.textContent = "Running self-test...";
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
        if (selftestResult) selftestResult.textContent = "Self-test done";
        setTimeout(() => {
          if (selftestResult) selftestResult.textContent = "";
        }, 2000);
      });
    });
  });
}

// Suggest Reply button handler (Home tab)
if (suggestReplyBtn) {
  suggestReplyBtn.addEventListener("click", async () => {
    if (selftestResult)
      selftestResult.textContent = "Getting reply suggestion...";
    try {
      const { messages = [] } = await chrome.storage.local.get(["messages"]);
      if (messages.length === 0) {
        if (selftestResult)
          selftestResult.textContent = "No messages to suggest a reply for.";
        setTimeout(
          () => selftestResult && (selftestResult.textContent = ""),
          2000
        );
        return;
      }
      const currentMessage = messages[0];
      const contextMessages = messages.slice(1, 5).map((msg) => ({
        text: msg.text,
        type: msg.type,
        timestamp: msg.timestamp,
      }));
      const payload = {
        current_message: {
          text: currentMessage.text,
          platform: currentMessage.platform,
          timestamp: currentMessage.timestamp,
        },
        context_messages: contextMessages,
      };
      const { manslaterMode = false } = await getStorage(["manslaterMode"]);
      const endpoint = manslaterMode
        ? "https://msghelp.onrender.com/suggest-reply"
        : "https://msghelp.onrender.com/suggest-reply-general";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `Backend error: ${response.status} - ${
            errorData.detail || response.statusText
          }`
        );
      }
      const data = await response.json();
      if (selftestResult)
        selftestResult.textContent = `Suggestion: "${data.suggestion}" (Cached: ${data.cached})`;
      // Optionally add log to dropdown
      if (logDropdown) {
        const opt = document.createElement("option");
        opt.value = data.suggestion;
        opt.textContent = `[${new Date().toLocaleTimeString()}] ${
          data.suggestion
        }`;
        logDropdown.appendChild(opt);
      }

      // Send suggestion to content script for floating box
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (
          tabs[0] &&
          tabs[0].url &&
          tabs[0].url.includes("web.whatsapp.com")
        ) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "SHOW_SUGGESTIONS",
            suggestions: [data.suggestion],
          });
        }
      });

      setTimeout(
        () => selftestResult && (selftestResult.textContent = ""),
        5000
      );
    } catch (e) {
      if (selftestResult) selftestResult.textContent = `Error: ${e.message}`;
      setTimeout(
        () => selftestResult && (selftestResult.textContent = ""),
        5000
      );
    }
  });
}

// clear messages (History tab)
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    chrome.storage.local.set({ messages: [] }, () => {
      renderMessages();
    });
  });
}

// scan active chat now (History tab)
if (scanBtn) {
  scanBtn.addEventListener("click", () => {
    if (selftestResult) selftestResult.textContent = "Scanning active chat...";
    chrome.tabs.query({}, (tabs) => {
      const wa = tabs.find(
        (t) => t && t.url && t.url.includes("web.whatsapp.com")
      );
      if (!wa) {
        if (selftestResult)
          selftestResult.textContent =
            "No WhatsApp Web tab found — open https://web.whatsapp.com and focus a chat, then try again.";
        return;
      }
      chrome.tabs.sendMessage(wa.id, { type: "SCAN_NOW" }, (resp) => {
        if (chrome.runtime.lastError) {
          if (selftestResult)
            selftestResult.textContent =
              "Scan failed: " +
              chrome.runtime.lastError.message +
              ". Try reloading the WhatsApp tab and the extension.";
          return;
        }
        renderMessages();
        if (selftestResult)
          selftestResult.textContent =
            resp && resp.ok ? "Scan complete" : "Scan finished";
        setTimeout(
          () => selftestResult && (selftestResult.textContent = ""),
          2000
        );
      });
    });
  });
}

// export messages to clipboard as JSON (History tab)
if (exportBtn) {
  exportBtn.addEventListener("click", async () => {
    chrome.storage.local.get(["messages"], ({ messages = [] }) => {
      const json = JSON.stringify(messages, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(json)
          .then(() => {
            if (selftestResult)
              selftestResult.textContent = "Exported JSON to clipboard";
            setTimeout(
              () => selftestResult && (selftestResult.textContent = ""),
              2000
            );
          })
          .catch(() => {
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
}

// Reset context (Logs tab)
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    chrome.storage.local.clear(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "RESET_STATE" });
        }
      });
      renderMessages();
      if (selftestResult)
        selftestResult.textContent = "Reset complete - all data cleared";
      setTimeout(
        () => selftestResult && (selftestResult.textContent = ""),
        2000
      );
    });
  });
}

if (debugBtn) {
  debugBtn.addEventListener("click", () => {
    // trigger a GET_DEBUG_INFO from content script and show a compact summary
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "GET_DEBUG_INFO" },
        (response) => {
          if (chrome.runtime.lastError) {
            alert(
              "No response from content script. Make sure WhatsApp Web is open and content script is injected."
            );
            return;
          }
          if (!response) {
            alert("No debug information available.");
            return;
          }
          const debugInfo = `Existing Messages: ${response.existingMessagesCount}\nRecent Buffer: ${response.recentCount}\nCurrent Session: ${response.currentSessionId}\nLast Chat Change: ${response.lastChatChangeTime}\nTotal Messages in Storage: ${response.storageCount}`;
          debugLast &&
            (debugLast.textContent = new Date().toLocaleTimeString());
          alert(debugInfo);
        }
      );
    });
  });
}

// Test floating box functionality
testFloatingBtn.addEventListener("click", () => {
  console.log("Test Floating Button clicked");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes("web.whatsapp.com")) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "TEST_FLOATING_BOX" });
      selftestResult.textContent = "Test floating box sent";
      setTimeout(() => (selftestResult.textContent = ""), 2000);
    } else {
      selftestResult.textContent = "Please open WhatsApp Web first";
      setTimeout(() => (selftestResult.textContent = ""), 3000);
    }
  });
});

// Suggest reply button handler
suggestReplyBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes("web.whatsapp.com")) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "SHOW_SUGGESTIONS" });
      // small UI feedback via debug-last
      debugLast && (debugLast.textContent = "Suggestion requested");
    } else {
      alert("Please open WhatsApp Web first");
    }
  });
});

// update UI when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.messages) renderMessages();
});

renderMessages();

// Dump messages to console (Logs tab)
if (dumpBtn) {
  dumpBtn.addEventListener("click", () => {
    chrome.storage.local.get(["messages"], ({ messages = [] }) => {
      console.log("MSGHELP: messages dump:", messages);
      alert(`Dumped ${messages.length} messages to console`);
    });
  });
}

// Config: load/save simple settings (Config tab)
chrome.storage.local.get(["config"], ({ config = {} }) => {
  if (enableSuggestionsEl)
    enableSuggestionsEl.checked = !!config.enableSuggestions;
  if (maxHistoryEl) maxHistoryEl.value = config.maxHistory || 5;
});
if (saveConfigBtn) {
  saveConfigBtn.addEventListener("click", () => {
    const cfg = {
      enableSuggestions: !!(enableSuggestionsEl && enableSuggestionsEl.checked),
      maxHistory: Number(maxHistoryEl && maxHistoryEl.value) || 5,
    };
    chrome.storage.local.set({ config: cfg }, () => {
      alert("Configuration saved");
    });
  });
}
