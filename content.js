// Minimal WhatsApp Web DOM-based message retriever
// - Only reads from the page DOM
// - Finds existing messages on load and observes new messages via MutationObserver
// - Saves messages into chrome.storage.local.messages (most recent first)

(function () {
  if (!location.hostname.includes("web.whatsapp.com")) {
    // not the target site
    return;
  }
  // (debug banner removed in trimmed build) -- keep console logs for debugging
  console.log("[CONTENT] WhatsApp DOM retriever loaded (minimal)");
  // (postMessage removed in trimmed build)

  // Minimal selectors: prefer the WhatsApp message marker. Keep container simple.
  const messageSelectors = ["div[data-pre-plain-text]"];
  const containerCandidates = ["#main"];
  const MAX_HISTORY = 5;

  // small recent cache to avoid duplicates
  const recent = [];
  const RECENT_LIMIT = 5;

  // counters for diagnostics
  const skipCounters = { mediaOnly: 0, uiTokens: 0, duplicates: 0 };

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

  function getTextFromElement(el) {
    if (!el) return "";

    // Prefer rendered innerText. If that's empty, fall back to textContent or
    // collect text from common descendant tags (span, p, div) which WhatsApp
    // often uses for message fragments.
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

  function guessDirection(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const cls = (node.className || "").toString().toLowerCase();
      if (cls.indexOf("message-out") !== -1 || cls.indexOf("out") !== -1)
        return "outgoing";
      if (cls.indexOf("message-in") !== -1 || cls.indexOf("in") !== -1)
        return "incoming";
    }
    return "unknown";
  }

  function saveMessage(msg) {
    chrome.storage.local.get(["messages"], ({ messages = [] }) => {
      // avoid duplicate consecutive saves: if the most recent stored message
      // has the same text and type, skip saving to prevent duplication.
      if (
        messages &&
        messages.length &&
        messages[0] &&
        messages[0].text === msg.text &&
        messages[0].type === msg.type
      ) {
        skipCounters.duplicates += 1;
        console.log(
          `[CONTENT] skipped duplicate (#${skipCounters.duplicates})`,
          msg.text
        );
        return;
      }
      messages.unshift(msg);
      messages = messages.slice(0, MAX_HISTORY);
      chrome.storage.local.set({ messages }, () => {
        console.log(
          "[CONTENT] saved",
          msg.type,
          "@",
          msg.platform,
          msg.text.substring(0, 120)
        );
      });
    });
  }

  // return true if the given element or any descendant looks like media
  function containsMedia(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      // common media tags
      const mediaSel = "img, video, audio, svg, picture, canvas, iframe";
      if (el.querySelector && el.querySelector(mediaSel)) return true;

      // some WhatsApp elements or web clients use data-testid or role attributes
      const mediaAttrSel =
        '[data-testid*="sticker"], [data-testid*="media"], [data-testid*="video"], [data-testid*="image"], [role="img"]';
      if (el.querySelector && el.querySelector(mediaAttrSel)) return true;

      // check for aria-label hints (e.g. "image" or "video")
      const nodes = el.querySelectorAll ? el.querySelectorAll("*") : [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        try {
          const aria = n.getAttribute && n.getAttribute("aria-label");
          if (aria && /image|photo|video|sticker|audio|voice/i.test(aria))
            return true;
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  // Heuristic to detect UI/control text that should not be treated as a user message
  function isLikelyNonMessage(text, el) {
    if (!text) return true;
    const t = text.trim();
    // durations like 0:26 or 12:34
    if (/^\d{1,2}:\d{2}$/.test(t)) return true;
    // icon or resource names like ic-mood, ic-chevron-down-wide
    if (/^ic[-_][\w-]+$/i.test(t)) return true;
    // common UI labels or control tokens
    if (
      /^(play|pause|download|forward|reply|delete|media|sticker|audio|video|image|mic|mute|unmute|cancel|more|close|open|next|prev|send|save|preview)s?$/i.test(
        t
      )
    )
      return true;
    // tokens containing 'audio-play' or 'media-cancel' etc
    if (
      /(audio|media|sticker|icon|btn|control|play|pause|download)/i.test(t) &&
      /[-_]/.test(t)
    )
      return true;
    // only punctuation or symbols (no letters/digits)
    if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;
    // very short tokens that contain no letter (e.g., ':' or '-')
    if (t.length <= 2 && !/[A-Za-z0-9]/.test(t)) return true;
    return false;
  }

  function handleElement(el) {
    // prefer an ancestor that looks like a message container
    const container = findNearestMessageContainer(el) || el;

    // skip containers that include media (images, videos, stickers, audio)
    if (containsMedia(container)) return;

    const text = getTextFromElement(container);
    if (!text) return;
    // skip UI-like tokens (durations, icon names, control labels)
    if (isLikelyNonMessage(text, container)) return;
    const key = text;
    if (seen(key)) return;
    pushRecent(key);
    const m = {
      text,
      platform: "whatsapp",
      timestamp: Date.now(),
      type: guessDirection(container),
    };
    saveMessage(m);
  }

  function scanExisting() {
    // Scan explicit selectors only (minimal mode)
    messageSelectors.forEach((sel) => {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes && nodes.length) nodes.forEach((n) => handleElement(n));
      } catch (e) {
        /* ignore selector errors */
      }
    });
  }

  // findChatArea removed in minimal mode (unused fallback heuristics)

  // Find nearest element that looks like a message container by climbing
  // ancestors looking for known markers. Return null if none found.
  function findNearestMessageContainer(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      try {
        if (node.matches && node.matches("div[data-pre-plain-text]"))
          return node;
      } catch (e) {}
      const cls = (node.className || "").toString().toLowerCase();
      if (cls.indexOf("message-") !== -1 || cls.indexOf("message") !== -1)
        return node;
      try {
        if (
          node.classList &&
          (node.classList.contains("copyable-text") ||
            node.classList.contains("selectable-text"))
        )
          return node;
      } catch (e) {}
    }
    return null;
  }

  // walkTextNodes removed in minimal mode

  function attachObserver() {
    // helper to set up observers on a specific container
    function setupObservers(container, label) {
      try {
        console.log(
          "[CONTENT] attaching observer to",
          label || container.tagName
        );
        const obs = new MutationObserver((mutations) => {
          const seenContainers = new Set();
          mutations.forEach((m) => {
            m.addedNodes.forEach((node) => {
              if (!node) return;

              // 1) Try the usual selector matches inside node
              messageSelectors.forEach((ms) => {
                try {
                  const found = node.querySelectorAll
                    ? node.querySelectorAll(ms)
                    : null;
                  if (found && found.length)
                    found.forEach((f) => {
                      const c = findNearestMessageContainer(f) || f;
                      if (c && !seenContainers.has(c)) {
                        seenContainers.add(c);
                        handleElement(c);
                      }
                    });
                } catch (e) {}
              });

              // 3) the node itself may be a message container
              try {
                const c2 =
                  findNearestMessageContainer(node) ||
                  (node.nodeType === 1 ? node : null);
                if (c2 && !seenContainers.has(c2)) {
                  seenContainers.add(c2);
                  handleElement(c2);
                }
              } catch (e) {}
            });
          });
        });
        obs.observe(container, { childList: true, subtree: true });

        return true;
      } catch (e) {
        return false;
      }
    }

    for (const sel of containerCandidates) {
      const container = document.querySelector(sel);
      if (!container) continue;
      if (setupObservers(container, sel)) return true;
    }

    // fallback: try attaching observers to document.body once (no retry interval)
    try {
      if (document.body) {
        return setupObservers(document.body, "document.body");
      }
    } catch (e) {}
    return false;
  }

  // start
  scanExisting();
  if (!attachObserver()) {
    console.warn("[CONTENT] attachObserver() failed to attach observers");
  }
  // allow requests from popup/UI to trigger an immediate scan
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "SCAN_NOW") {
        try {
          scanExisting();
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e && e.message });
        }
        return true;
      }
      return false;
    });
  } catch (e) {
    // not in extension context
  }
})();
