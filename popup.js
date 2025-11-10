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
    if (!messages || messages.length === 0) {
      messagesList.textContent = "No messages captured yet.";
      return;
    }
    // Render messages (most recent first)
    messages.forEach((m, idx) => {
      const row = document.createElement("div");
      row.style.borderBottom = "1px solid #eee";
      row.style.padding = "6px 4px";
      row.innerHTML = `<div style="font-size:11px;color:#666">${
        idx + 1
      }. ${escapeHtml(m.type || "")} @ ${escapeHtml(
        m.platform || ""
      )} — ${formatTime(
        m.timestamp
      )}</div><div style="margin-top:4px;white-space:pre-wrap">${escapeHtml(
        m.text
      )}</div>`;
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

// update UI when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.messages) renderMessages();
});

renderMessages();
