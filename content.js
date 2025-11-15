// Check if element contains media (image, video, audio, etc.)
function containsMedia(el) {
  if (!el || el.nodeType !== 1) return false;
  const mediaSel = "img, video, audio, svg, picture, canvas, iframe";
  if (el.querySelector(mediaSel)) return true;

  const mediaAttrSel =
    '[data-testid*="sticker"], [data-testid*="media"], [data-testid*="video"], [data-testid*="image"], [role="img"]';
  if (el.querySelector(mediaAttrSel)) return true;

  return false;
}
// Minimal WhatsApp Web DOM-based message retriever (enhanced)
// - Detects message bubbles only
// - Ignores sidebar, header, UI fragments, media wrappers
// - Works with WhatsApp virtualized DOM / portals
// - Saves newest messages to chrome.storage.local.messages

(function () {
  if (!location.hostname.includes("web.whatsapp.com")) return;

  console.log("[CONTENT] WhatsApp DOM retriever loaded ✅");

  // WhatsApp text bubble selectors
  const messageSelectors = [
    "div[data-pre-plain-text]", // reliable message marker
    "div[role='row']", // WA also uses rows for messages
  ];

  const MAX_HISTORY = 5;
  const recent = [];
  const RECENT_LIMIT = 5;
  let isInitialized = false;
  const existingMessages = new Set(); // Track all messages found during context loading
  let currentChatSession = null; // Track current chat to detect changes
  let contextLoadingTimeout = null; // Timeout for delayed context loading
  // Track which sessions have already had their context saved
  const sessionsWithContext = new Set();

  function seen(key) {
    return recent.indexOf(key) !== -1;
  }

  function pushRecent(key) {
    recent.unshift(key);
    if (recent.length > RECENT_LIMIT) recent.pop();
  }

  function normalizeSpaces(s) {
    return s
      .replace(/\u200B/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Safely read className value as a lowercase string. Handles SVGAnimatedString (baseVal) too.
  function safeClassName(node) {
    if (!node) return "";
    const cn = node.className;
    if (!cn) return "";
    if (typeof cn === "string") return cn.toLowerCase();
    if (typeof cn === "object" && cn.baseVal)
      return String(cn.baseVal).toLowerCase();
    try {
      return String(cn).toLowerCase();
    } catch (e) {
      return "";
    }
  }
  function getActiveChatInfo() {
    const chatTitle = normalizeSpaces(String(getChatTitleByYourMethod() || ""));
    const hrefHash = (location.hash || "").replace(/^#/, "");
    const sessionId = chatTitle
      ? `${chatTitle}::${hrefHash || "local"}`
      : hrefHash || `unknown::${location.pathname}`;
    return { sessionId, chatTitle, hrefHash };
  }

  function getChatTitleByYourMethod() {
    try {
      // Step 1: find the long participant preview span
      const preview = document.querySelector("#main header span[title]");
      if (!preview) return "";

      // Step 2: climb to nearest wrapping div (header)
      const header = preview.closest("header") || preview.parentElement;
      if (!header) return "";

      // Step 3: inside that header, find the real visible title
      const titleEl = header.querySelector("span[dir='auto']");
      if (!titleEl) return "";

      return normalizeSpaces(
        titleEl.getAttribute("title") || titleEl.innerText || ""
      );
    } catch (e) {
      return "";
    }
  }

  // Backwards-compatible active chat info extractor. Uses the title extractor above
  // and falls back to URL hash when necessary.
  function detectChatChange() {
    const info = getActiveChatInfo();
    const newSessionId = info.sessionId;

    if (currentChatSession !== newSessionId && isInitialized) {
      console.log(
        `[CONTENT] 🔄 Chat changed from "${currentChatSession}" to "${newSessionId}"`
      );
      currentChatSession = newSessionId;

      // Reset state for new chat
      isInitialized = false;
      existingMessages.clear();
      recent.length = 0;

      // Clear any pending context loading
      if (contextLoadingTimeout) {
        clearTimeout(contextLoadingTimeout);
      }

      if (!sessionsWithContext.has(newSessionId)) {
        contextLoadingTimeout = setTimeout(() => {
          scanLast5Messages();
          sessionsWithContext.add(newSessionId); // Mark context as saved
          // Enable new message capture after context loads
          setTimeout(() => {
            isInitialized = true;
            console.log("[CONTENT] 🔄 Now capturing new messages only");
          }, 1000);
        }, 1500); // Wait for chat to fully load
      } else {
        // If context already saved, just enable new message capture
        setTimeout(() => {
          isInitialized = true;
          console.log(
            "[CONTENT] 🔄 Now capturing new messages only (context already loaded)"
          );
        }, 500);
      }
    }
  }
  // Attempt to retrieve the raw `data-pre-plain-text` attribute from a node
  function getPrePlainTextAttribute(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      if (node.getAttribute && node.getAttribute("data-pre-plain-text"))
        return node.getAttribute("data-pre-plain-text");
    }
    return null;
  }

  // Parse a timestamp from a message node using its `data-pre-plain-text` attribute
  // Returns epoch milliseconds or null on failure. Uses heuristics for local formats.
  function parseTimestampFromElement(el) {
    try {
      const raw = getPrePlainTextAttribute(el);
      if (!raw) return null;

      // Example formats: "[12:34] Name: ", "[12:34, 10/15/2025] Name: " etc.
      const m = raw.match(/^\[([^\]]+)\]/);
      if (!m) return null;
      const inside = m[1].trim();

      // Split author portion if present (time may come first then comma + date)
      // Keep only the timestamp portion (before a comma, if present)
      const parts = inside.split(/,\s*/);
      const timePart = parts[0];
      const datePart = parts.length > 1 ? parts.slice(1).join(", ") : null;

      // Parse time HH:MM(:SS)? (optional AM/PM).
      const timeMatch = timePart.match(
        /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/
      );
      if (!timeMatch) return null;
      let hh = parseInt(timeMatch[1], 10);
      const mm = parseInt(timeMatch[2], 10);
      const ss = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const ampm = timeMatch[4];
      if (ampm) {
        if (ampm.toLowerCase() === "pm" && hh < 12) hh += 12;
        if (ampm.toLowerCase() === "am" && hh === 12) hh = 0;
      }

      let dt = null;
      if (datePart) {
        // Accept common separators and attempt dd-mm-yyyy / mm-dd-yyyy parsing
        const normalized = datePart
          .replace(/\./g, "-")
          .replace(/\//g, "-")
          .trim();
        const tokens = normalized
          .split("-")
          .map((t) => t.replace(/^0+/, "") || "0");
        // If tokens have 3 parts, attempt two-order parses
        if (tokens.length >= 3) {
          const a = parseInt(tokens[0], 10);
          const b = parseInt(tokens[1], 10);
          const c = parseInt(tokens[2], 10);
          // try dd-mm-yyyy
          const try1 = new Date(c, b - 1, a, hh, mm, ss);
          if (!isNaN(try1)) dt = try1;
          else {
            // try mm-dd-yyyy
            const try2 = new Date(c, a - 1, b, hh, mm, ss);
            if (!isNaN(try2)) dt = try2;
          }
        }
      }

      if (!dt) {
        // No explicit date: use today's date and adjust slightly if needed
        const now = new Date();
        dt = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hh,
          mm,
          ss
        );
        // If dt is more than 12 hours in the future, assume it's from yesterday
        if (dt.getTime() - Date.now() > 12 * 3600 * 1000)
          dt.setDate(dt.getDate() - 1);
      }

      return dt.getTime();
    } catch (e) {
      return null;
    }
  }

  function isLikelyNonMessage(text) {
    if (!text) return true;
    const t = text.trim();

    if (/^\d{1,2}:\d{2}$/.test(t)) return true;
    if (/^ic[-_][\w-]+$/i.test(t)) return true;

    if (
      /^(play|pause|download|reply|delete|media|sticker|audio|video|image|mic|mute|close|open|send|save)s?$/i.test(
        t
      )
    )
      return true;

    if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;

    if (t.length <= 2 && !/[A-Za-z0-9]/.test(t)) return true;

    return false;
  }

  // ✅ NEW: Filter to ensure element is an actual chat bubble
  function isChatBubble(el) {
    // must be inside main chat pane
    if (!el.closest("#main")) return false;

    // must NOT be in the left sidebar
    if (el.closest("#pane-side")) return false;

    // must contain selectable text
    const textNode = el.querySelector("span.selectable-text");
    if (!textNode) return false;

    const txt = textNode.innerText.trim();
    if (!txt) return false;

    if (isLikelyNonMessage(txt)) return false;

    // must not be media-only
    if (containsMedia(el)) return false;

    return true;
  }

  function guessDirection(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const cls = safeClassName(node);
      if (cls.includes("message-out") || cls.includes("out")) return "outgoing";
      if (cls.includes("message-in") || cls.includes("in")) return "incoming";
    }
    return "unknown";
  }

  // Cap messages per session: keep message order but limit number of entries for each sessionId
  function capMessagesPerSession(allMessages, limit = MAX_HISTORY) {
    const kept = [];
    const counts = Object.create(null);
    for (const m of allMessages) {
      const sid = m?.sessionId || "unknown";
      counts[sid] = counts[sid] || 0;
      if (counts[sid] < limit) {
        kept.push(m);
        counts[sid]++;
      }
    }
    return kept;
  }

  function saveMessage(msg) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        console.warn("[CONTENT] storage not available — skipping save");
        return;
      }

      chrome.storage.local.get(["messages"], ({ messages = [] } = {}) => {
        try {
          // Prevent consecutive duplicate within the same chat/session
          if (
            messages[0]?.text === msg.text &&
            messages[0]?.type === msg.type &&
            messages[0]?.sessionId === msg.sessionId
          ) {
            console.log("[CONTENT] skipped duplicate (same session)");
            return;
          }

          messages.unshift(msg);
          // enforce per-session cap while preserving global order
          const capped = capMessagesPerSession(messages, MAX_HISTORY);
          chrome.storage.local.set({ messages: capped }, () => {
            if (chrome.runtime?.lastError) {
              console.warn(
                "[CONTENT] storage.set error",
                chrome.runtime.lastError
              );
            } else {
              console.log(
                "[CONTENT] 💬 New message saved:",
                msg.text,
                `[${msg.type}]`
              );
            }
          });
        } catch (cbErr) {
          console.warn("[CONTENT] saveMessage callback error", cbErr);
        }
      });
    } catch (err) {
      // This can happen if the extension context is invalidated (reload/uninstall)
      console.warn(
        "[CONTENT] storage unavailable or extension context invalidated — skipping save",
        err
      );
    }
  }

  function findNearestMessageContainer(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      try {
        if (node.matches?.("div[data-pre-plain-text]")) return node;
      } catch (e) {}

      const cls = safeClassName(node);
      if (cls.includes("message")) return node;

      if (
        node.classList?.contains("copyable-text") ||
        node.classList?.contains("selectable-text")
      )
        return node;
    }
    return null;
  }

  function extractReplyInfo(container) {
    // Try to find the quoted/reply section in the message bubble
    // WhatsApp often uses [data-testid="msg-meta"] or a div with role="button" and aria-label for replies
    let replyText = "";
    let replySender = "";

    // Try common selectors for quoted/reply
    const replyContainer =
      container.querySelector('[data-testid="msg-meta"]') ||
      container.querySelector(".quoted-mention, .quoted-message") ||
      container.querySelector("._1Gy50"); // fallback for obfuscated class

    if (replyContainer) {
      // Try to get sender and text
      const senderEl = replyContainer.querySelector('span[dir="auto"]');
      if (senderEl) replySender = senderEl.innerText.trim();

      // The quoted text is often in a selectable-text span inside the reply container
      const textEl = replyContainer.querySelector("span.selectable-text");
      if (textEl) replyText = textEl.innerText.trim();
      else replyText = replyContainer.innerText.trim();
    }

    if (replyText) {
      return {
        replyTo: {
          sender: replySender,
          text: replyText,
        },
      };
    }
    return null;
  }

  function handleElement(el) {
    // Only process new messages after initialization
    if (!isInitialized) return;

    const container = findNearestMessageContainer(el) || el;
    if (!isChatBubble(container)) return;

    const text = getTextFromElement(container);
    if (!text) return;
    if (isLikelyNonMessage(text)) return;

    const info = getActiveChatInfo();
    const sessionKey = `${info.sessionId}::${text}`;

    // Completely ignore any message that existed during context loading
    if (existingMessages.has(sessionKey)) return;
    if (seen(sessionKey)) return;

    pushRecent(sessionKey);

    const parsedTs =
      (typeof parseTimestampFromElement === "function"
        ? parseTimestampFromElement(container)
        : null) || Date.now();

    // NEW: Extract reply info if present
    const replyInfo = extractReplyInfo(container);

    const msgObj = {
      text,
      timestamp: parsedTs,
      platform: "whatsapp",
      type: guessDirection(container),
      sessionId: info.sessionId,
      chatTitle: info.chatTitle,
      ...(replyInfo || {}),
    };

    console.log(
      "[CONTENT] 💬 Processing new message at bottom:",
      text.substring(0, 50) + "...",
      new Date(parsedTs).toISOString(),
      replyInfo ? `(reply to: ${replyInfo.replyTo.text})` : ""
    );
    saveMessage(msgObj);
  }

  // Check if element is currently visible in viewport
  function isInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const viewHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= viewHeight &&
      rect.right <= viewWidth
    );
  }

  // Capture last 5 messages from bottom of chat when entering a chat (context load)
  function scanLast5Messages() {
    const info = getActiveChatInfo();

    // Wait for chat to be fully loaded
    const chatContainer =
      document.querySelector("#main div[data-tab='1']") ||
      document.querySelector("#main .copyable-area") ||
      document.querySelector("#main");

    if (!chatContainer) {
      console.log("[CONTENT] No chat container found, retrying...");
      setTimeout(scanLast5Messages, 500);
      return;
    }

    const allMessages = [];
    const seenTexts = new Set(); // Prevent duplicates during scan

    // First pass: scan ALL messages to build comprehensive existing message set
    messageSelectors.forEach((sel) => {
      const allNodes = Array.from(chatContainer.querySelectorAll(sel));
      allNodes.forEach((n) => {
        if (!isChatBubble(n)) return;
        const text = getTextFromElement(n);
        if (!text || isLikelyNonMessage(text)) return;
        const sessionKey = `${info.sessionId}::${text}`;
        existingMessages.add(sessionKey); // Add ALL existing messages to the set
      });
    });

    // Second pass: collect all chat bubbles, robustly dedupe, and sort by timestamp and DOM order
    let allNodes = [];
    messageSelectors.forEach((sel) => {
      const messagePane =
        chatContainer.querySelector('[aria-label="Message list"]') ||
        chatContainer.querySelector(
          '[data-testid="conversation-panel-messages"]'
        ) ||
        chatContainer;
      allNodes = allNodes.concat(Array.from(messagePane.querySelectorAll(sel)));
    });

    // Remove duplicates (same DOM node)
    allNodes = Array.from(new Set(allNodes));

    // Sort nodes by DOM order (top to bottom)
    allNodes.sort((a, b) => {
      const posA = a.compareDocumentPosition(b);
      return posA & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const seenKeys = new Set();
    allNodes.forEach((n, idx) => {
      if (!isChatBubble(n)) return;
      const text = getTextFromElement(n);
      if (!text || isLikelyNonMessage(text)) return;

      // Parse timestamp from the element; fallback to DOM index for uniqueness
      let ts =
        typeof parseTimestampFromElement === "function"
          ? parseTimestampFromElement(n)
          : null;
      if (!ts || isNaN(ts)) ts = 1000000000000 + idx; // fallback: unique, stable, and sorts after real timestamps

      // Use both text and timestamp for deduplication
      const dedupeKey = `${info.sessionId}::${ts}::${text}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      pushRecent(dedupeKey); // Add to dedupe buffer immediately

      allMessages.push({
        text,
        timestamp: ts,
        domIndex: idx,
        platform: "whatsapp",
        type: guessDirection(n),
        sessionId: info.sessionId,
        chatTitle: info.chatTitle,
      });
    });

    // Sort all messages by parsed timestamp (asc) and domIndex (asc) to ensure stable ordering
    allMessages.sort((a, b) =>
      a.timestamp === b.timestamp
        ? (a.domIndex || 0) - (b.domIndex || 0)
        : a.timestamp - b.timestamp
    );

    // Take the last MAX_HISTORY (most recent) messages from the end
    const last5 = allMessages.slice(-MAX_HISTORY);
    console.log(
      `[CONTENT] 📖 Found ${existingMessages.size} total existing messages in chat`
    );
    if (last5.length > 0) {
      console.log(
        `[CONTENT] 📖 Loaded last ${last5.length} messages from bottom of chat:`
      );
      last5.forEach((msg, i) => {
        console.log(`  ${i + 1}. [${msg.type}] ${msg.text}`);
      });

      // Store the context messages (ensure newest-first ordering)
      chrome.storage.local.get(["messages"], ({ messages = [] } = {}) => {
        try {
          const lastReversed = last5.slice().reverse();
          const updated = [
            ...lastReversed,
            ...messages.filter((m) => m.sessionId !== info.sessionId),
          ];
          const capped = capMessagesPerSession(updated, MAX_HISTORY);
          chrome.storage.local.set({ messages: capped });
        } catch (e) {
          console.warn("[CONTENT] context save error", e);
        }
      });
    } else {
      console.log("[CONTENT] 📖 No messages found in chat");
    }
  }

  // Detect when user switches to a different chat
  function detectChatChange() {
    const info = getActiveChatInfo();
    const newSessionId = info.sessionId;

    if (currentChatSession !== newSessionId) {
      console.log(
        `[CONTENT] 🔄 Chat changed from "${currentChatSession}" to "${newSessionId}"`
      );
      currentChatSession = newSessionId;

      // Reset state for new chat
      isInitialized = false;
      existingMessages.clear();
      recent.length = 0;

      // Clear any pending context loading
      if (contextLoadingTimeout) {
        clearTimeout(contextLoadingTimeout);
      }

      // Load context after chat fully loads (give time for messages to render)
      contextLoadingTimeout = setTimeout(() => {
        scanLast5Messages();

        // Enable new message capture after context loads
        setTimeout(() => {
          isInitialized = true;
          console.log("[CONTENT] 🔄 Now capturing new messages only");
        }, 1000);
      }, 1500); // Wait for chat to fully load
    }
  }

  function attachObserver() {
    const body = document.body;
    if (!body) return console.warn("[CONTENT] document.body not ready");

    console.log("[CONTENT] observing document.body for new messages");

    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!node?.querySelectorAll) return;

          messageSelectors.forEach((sel) => {
            node.querySelectorAll(sel).forEach((f) => handleElement(f));
          });

          handleElement(node);
        });
      });
    });

    obs.observe(body, { childList: true, subtree: true });
  }

  // Check if a message node is at the bottom of the chat (truly new)
  function isAtBottomOfChat(el) {
    if (!el) return false;

    const chatContainer =
      document.querySelector("#main div[data-tab='1']") ||
      document.querySelector("#main .copyable-area") ||
      document.querySelector("#main");

    if (!chatContainer) return false;

    const rect = el.getBoundingClientRect();
    const containerRect = chatContainer.getBoundingClientRect();

    // Check if the message is in the bottom 20% of the visible chat area
    const bottomThreshold = containerRect.bottom - containerRect.height * 0.2;

    return rect.top >= bottomThreshold;
  }

  // Set up observers for both new messages and chat changes
  function startObservers() {
    const body = document.body;
    if (!body) {
      setTimeout(startObservers, 500);
      return;
    }

    console.log("[CONTENT] 👀 Monitoring for chat changes and new messages");

    const obs = new MutationObserver((mutations) => {
      // Check for chat changes on any DOM mutation
      detectChatChange();

      // Only process new messages if initialized for current chat
      if (!isInitialized) return;

      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!node?.querySelectorAll) return;

          messageSelectors.forEach((sel) => {
            node.querySelectorAll(sel).forEach((f) => {
              // Only process messages that appear at the bottom (truly new messages)
              if (isAtBottomOfChat(f)) {
                handleElement(f);
              }
            });
          });

          // Check the node itself if it appears at bottom
          if (isAtBottomOfChat(node)) {
            handleElement(node);
          }
        });
      });
    });

    obs.observe(body, { childList: true, subtree: true });

    // Initial chat detection
    detectChatChange();
  }

  // Message handlers for communication with popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "RESET_STATE") {
      // Reset all state variables
      existingMessages.clear();
      recent.length = 0;
      isInitialized = false;
      currentChatSession = null;
      if (contextLoadingTimeout) {
        clearTimeout(contextLoadingTimeout);
        contextLoadingTimeout = null;
      }
      console.log("[CONTENT] State reset complete");
      sendResponse({ ok: true });
      return;
    }

    if (request.type === "GET_DEBUG_INFO") {
      // Get current state for debugging
      chrome.storage.local.get(["messages"], ({ messages = [] }) => {
        const debugInfo = {
          existingMessagesCount: existingMessages.size,
          recentCount: recent.length,
          currentSessionId: currentChatSession?.sessionId || "None",
          lastChatChangeTime: currentChatSession?.timestamp || "None",
          storageCount: messages.length,
          isInitialized: isInitialized,
        };
        console.log("[CONTENT] Debug info:", debugInfo);
        sendResponse(debugInfo);
      });
      return true; // Indicates we'll send response asynchronously
    }

    if (request.type === "SCAN_NOW") {
      // Force re-scan of current chat
      scanLast5Messages(true);
      sendResponse({ ok: true });
      return;
    }
  });

  // Start monitoring when content script loads
  startObservers();

  function getTextFromElement(el) {
    if (!el) return "";
    try {
      const rendered = (el.innerText || "").toString().trim();
      if (rendered) return normalizeSpaces(rendered);

      const raw = (el.textContent || "").toString().trim();
      if (raw) return normalizeSpaces(raw);

      const parts = [];
      const nodes = el.querySelectorAll("span, p, div");
      nodes.forEach((n) => {
        const t = (n.innerText || n.textContent || "").toString().trim();
        if (t) parts.push(t);
      });
      return normalizeSpaces(parts.join(" "));
    } catch (e) {
      return "";
    }
  }
})();
