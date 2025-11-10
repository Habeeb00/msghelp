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

      return titleEl.innerText.trim();
    } catch (e) {
      return "";
    }
  }

  // Backwards-compatible active chat info extractor. Uses the title extractor above
  // and falls back to URL hash when necessary.
  function getActiveChatInfo() {
    const chatTitle = normalizeSpaces(String(getChatTitleByYourMethod() || ""));
    const hrefHash = (location.hash || "").replace(/^#/, "");
    const sessionId = chatTitle
      ? `${chatTitle}::${hrefHash || "local"}`
      : hrefHash || `unknown::${location.pathname}`;
    return { sessionId, chatTitle, hrefHash };
  }

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

  function containsMedia(el) {
    if (!el || el.nodeType !== 1) return false;
    const mediaSel = "img, video, audio, svg, picture, canvas, iframe";
    if (el.querySelector(mediaSel)) return true;

    const mediaAttrSel =
      '[data-testid*="sticker"], [data-testid*="media"], [data-testid*="video"], [data-testid*="image"], [role="img"]';
    if (el.querySelector(mediaAttrSel)) return true;

    return false;
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
          chrome.storage.local.set(
            { messages: messages.slice(0, MAX_HISTORY) },
            () => {
              if (chrome.runtime?.lastError) {
                console.warn(
                  "[CONTENT] storage.set error",
                  chrome.runtime.lastError
                );
              } else {
                console.log("[CONTENT] ✅ saved", msg.text, {
                  session: msg.sessionId,
                });
              }
            }
          );
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

  function handleElement(el) {
    const container = findNearestMessageContainer(el) || el;
    if (!isChatBubble(container)) return;

    const text = getTextFromElement(container);
    if (!text) return;
    if (isLikelyNonMessage(text)) return;

    const info = getActiveChatInfo();
    const sessionKey = `${info.sessionId}::${text}`;
    if (seen(sessionKey)) return;

    pushRecent(sessionKey);

    saveMessage({
      text,
      timestamp: Date.now(),
      platform: "whatsapp",
      type: guessDirection(container),
      sessionId: info.sessionId,
      chatTitle: info.chatTitle,
    });
  }

  function scanExisting() {
    messageSelectors.forEach((sel) => {
      const nodes = document.querySelectorAll(sel);
      nodes.forEach((n) => handleElement(n));
    });
  }

  function attachObserver() {
    const body = document.body;
    if (!body) return console.warn("[CONTENT] document.body not ready");

    console.log("[CONTENT] observing document.body");

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

  scanExisting();
  attachObserver();
})();
