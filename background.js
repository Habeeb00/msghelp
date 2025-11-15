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

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        "[BACKGROUND] Backend error:",
        response.status,
        response.statusText
      );
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
  }
}
