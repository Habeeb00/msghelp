// Background script for handling suggestion requests
const API_ENDPOINT = "https://msghelp.onrender.com/suggest-reply";

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "REQUEST_SUGGESTION") {
    handleSuggestionRequest(request.messages, sender.tab.id);
    sendResponse({ ok: true });
  }
});

async function handleSuggestionRequest(messages, tabId) {
  try {
    if (!messages || messages.length === 0) return;

    // The most recent message is the current message
    const currentMessage = messages[0];
    // The next 4 messages are context messages
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

    console.log(
      "[BACKGROUND] Requesting suggestion for:",
      currentMessage.text.substring(0, 50) + "..."
    );

    // Read manslaterMode from storage to decide which endpoint to call
    const storage = await new Promise((res) =>
      chrome.storage.local.get(["manslaterMode"], res)
    );
    const manslaterMode = storage.manslaterMode === true;
    const endpoint = manslaterMode
      ? API_ENDPOINT
      : "https://example.com/sample-suggest";

    // Use a fetch helper with retries and timeout to make network more robust
    async function fetchWithRetries(
      url,
      opts = {},
      attempts = 2,
      timeoutMs = 8000
    ) {
      let lastErr = null;
      for (let i = 0; i <= attempts; i++) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(url, { signal: controller.signal, ...opts });
          clearTimeout(id);
          return res;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[BACKGROUND] fetch attempt ${i + 1} failed:`,
            err && err.message ? err.message : err
          );
          // exponential backoff before retrying (skip wait after last attempt)
          if (i < attempts)
            await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i)));
        }
      }
      throw lastErr;
    }

    const response = await fetchWithRetries(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      2,
      8000
    );

    if (!response.ok) {
      const errMsg = `Backend error: ${response.status} ${response.statusText}`;
      console.error("[BACKGROUND]", errMsg);
      // Send an error message to content script so it can display it
      chrome.tabs.sendMessage(tabId, {
        type: "SHOW_SUGGESTIONS",
        suggestions: [],
        error: errMsg,
      });
      return;
    }

    const data = await response.json();
    console.log("[BACKGROUND] Got suggestion:", data.suggestion);

    // Send suggestion back to content script to display in floating box
    chrome.tabs.sendMessage(tabId, {
      type: "SHOW_SUGGESTIONS",
      suggestions: [data.suggestion],
    });
  } catch (error) {
    console.error("[BACKGROUND] Error getting suggestion:", error);
    const short =
      error && error.message ? error.message : String(error || "Unknown error");
    const errMsg = `Error fetching from ${endpoint}: ${short}`;
    // On error, notify the content script so it can present the error message
    try {
      chrome.tabs.sendMessage(tabId, {
        type: "SHOW_SUGGESTIONS",
        suggestions: [],
        error: errMsg,
      });
    } catch (e) {
      // ignore
    }
  }
}
