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

  // Escape HTML for safe display
  function escapeHtml(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Floating UI for suggestions
  function injectFloatingBox() {
    // Remove existing box if it exists
    const existingBox = document.getElementById("msghelp-floating-box");
    if (existingBox) {
      existingBox.remove();
    }

    // Find the chat container to position relative to it
    const chatContainer = document.querySelector("#main");
    if (!chatContainer) {
      console.warn("[CONTENT] Chat container not found, delaying injection");
      setTimeout(injectFloatingBox, 500);
      return;
    }

    const box = document.createElement("div");
    box.id = "msghelp-floating-box";
    box.style.position = "absolute";
    box.style.top = "80px";
    box.style.left = "50%";
    box.style.transform = "translateX(-50%) translateY(-20px)";
    box.style.zIndex = "1000";

    // Light white translucent background with high transparency
    box.style.background = "rgba(255, 255, 255, 0.06)";

    // Strong frosted blur + subtle brightness to simulate distortion
    box.style.backdropFilter = "blur(40px) saturate(180%) brightness(1.05)";
    box.style.WebkitBackdropFilter =
      "blur(40px) saturate(180%) brightness(1.05)";
    box.style.filter = "drop-shadow(0 8px 24px rgba(0,0,0,0.08))";
    box.style.color = "rgba(255,255,255,0.95)";
    box.style.borderRadius = "28px";

    // Thin translucent border and subtle inner highlight for glass
    box.style.border = "1px solid rgba(255,255,255,0.12)";
    box.style.boxShadow = `0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.16)`;

    box.style.padding = "18px 22px";
    box.style.minWidth = "320px";
    box.style.maxWidth = "520px";
    box.style.fontFamily =
      "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";
    box.style.fontSize = "14.3px";
    box.style.lineHeight = "1.6";

    // Smooth fade-in (opacity) and subtle transform transitions
    box.style.opacity = "0";
    box.style.transition =
      "opacity 0.6s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1)";
    box.style.pointerEvents = "auto";
    box.style.willChange = "opacity, transform";
    box.style.overflow = "hidden";

    // Keep a gentle float animation, but remove gradient shifting
    box.style.animationName = "msghelp-float";
    box.style.animationDuration = "6s";
    box.style.animationTimingFunction = "ease-in-out";
    box.style.animationIterationCount = "infinite";

    // Frosted blur with distortion using filter
    box.style.backdropFilter = "blur(40px) saturate(180%) brightness(1.1)";
    box.style.WebkitBackdropFilter =
      "blur(40px) saturate(180%) brightness(1.1)";
    box.style.filter = "drop-shadow(0 8px 32px rgba(0, 0, 0, 0.1))";

    box.style.color = "#ffffff";

    // Rounded corners
    box.style.borderRadius = "28px";

    // Subtle border for glass effect
    box.style.border = "1px solid rgba(255, 255, 255, 0.18)";
    box.style.boxShadow = `
      0 8px 32px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      inset 0 -1px 0 rgba(255, 255, 255, 0.1)
    `;

    box.style.padding = "20px 24px";
    box.style.minWidth = "340px";
    box.style.maxWidth = "500px";
    box.style.fontFamily =
      "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, Fira Sans, sans-serif";
    box.style.fontSize = "14.5px";
    box.style.lineHeight = "1.6";

    // Smooth fade-in animation
    box.style.opacity = "0";
    box.style.transition =
      "opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
    box.style.pointerEvents = "auto";
    box.style.willChange = "opacity, transform";
    box.style.overflow = "hidden";

    // Inject CSS animations if not already present
    if (!document.getElementById("msghelp-animations")) {
      const style = document.createElement("style");
      style.id = "msghelp-animations";
      style.textContent = `
          @keyframes msghelp-float {
            0%, 100% { transform: translateX(-50%) translateY(0px); }
            50% { transform: translateX(-50%) translateY(-6px); }
          }

          @keyframes msghelp-shimmer {
            0% { background-position: -200% center; }
            100% { background-position: 200% center; }
          }

          @keyframes msghelp-pulse-glow {
            0%, 100% { box-shadow: 0 0 12px rgba(255,255,255,0.06); }
            50% { box-shadow: 0 0 18px rgba(255,255,255,0.08); }
          }
      `;
      document.head.appendChild(style);
    }

    // Add hover effect to enhance liquid glass feel
    box.addEventListener("mouseenter", () => {
      box.style.transform = "translateX(-50%) translateY(0px)";
      box.style.background = "rgba(255, 255, 255, 0)";
      box.style.boxShadow = `
        0 12px 48px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.3),
        inset 0 -1px 0 rgba(255, 255, 255, 0.15)
      `;
      box.style.borderColor = "rgba(255, 255, 255, 0.48)";
    });

    box.addEventListener("mouseleave", () => {
      box.style.transform = "translateX(-50%) translateY(0px)";
      box.style.background = "rgba(255, 255, 255, 0)";
      box.style.boxShadow = `
        0 8px 32px rgba(0, 0, 0, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.25),
        inset 0 -1px 0 rgba(255, 255, 255, 0.1)
      `;
      box.style.borderColor = "rgba(255, 255, 255, 0.18)";
    });

    box.innerHTML = `
      <div style="display: flex; align-items: center; margin-bottom: 14px; gap: 10px;">
        <div style="width: 36px; height: 36px; border-radius: 14px; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.25); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.3);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.9)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
        </div>
        <strong style="color: rgba(255, 255, 255, 0.95); font-weight: 600; font-size: 16px; flex: 1; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); letter-spacing: 0.3px;">Smart Reply</strong>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <button id="msghelp-manslater-btn" class="msghelp-manslater-btn" style="appearance:none;border:1px solid rgba(255,255,255,0.14);background:transparent;color:rgba(255,255,255,0.9);padding:6px 10px;border-radius:12px;font-size:12px;cursor:pointer;">Manslater: Off</button>
        </div>
        <button id="msghelp-close" style="background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.2); cursor: pointer; padding: 6px; color: rgba(255, 255, 255, 0.8); font-size: 22px; line-height: 1; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 12px; backdrop-filter: blur(10px); font-weight: 300;" onmouseover="this.style.background='rgba(255, 255, 255, 0.25)'; this.style.borderColor='rgba(255, 255, 255, 0.4)'; this.style.color='rgba(255, 255, 255, 1)'; this.style.transform='rotate(90deg) scale(1.05)';" onmouseout="this.style.background='rgba(255, 255, 255, 0.12)'; this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.color='rgba(255, 255, 255, 0.8)'; this.style.transform='rotate(0deg) scale(1)';">×</button>
      </div>
      <div id="msghelp-suggestions-container">
        <div style="color: rgba(255, 255, 255, 0.6); font-style: italic; font-size: 14px; text-align: center; padding: 12px;">
          <div style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: rgba(255, 255, 255, 0.6); animation: msghelp-pulse-glow 2s ease-in-out infinite; margin-right: 8px;"></div>
          Waiting for suggestions...
        </div>
      </div>
      <!-- Continue conversation footer -->
      <div id="msghelp-conversation-footer" style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:center;">
          <button id="msghelp-continue-btn" style="appearance:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.95);padding:6px 10px;border-radius:10px;font-size:13px;cursor:pointer;">Continue conversation</button>
        </div>
        <div id="msghelp-conversation-area" style="display:none; flex-direction:column; gap:8px; width:100%;">
            <div id="msghelp-convo-log" style="max-height:180px; overflow:auto; padding:10px; border-radius:10px; background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); display:flex; flex-direction:column; gap:6px;">
              <!-- conversation messages will be appended here -->
            </div>
            <div style="display:flex; gap:8px; align-items:flex-end; width:100%;">
              <textarea id="msghelp-convo-input" placeholder="Type your follow-up question..." style="flex:1; min-height:48px; max-height:140px; resize:vertical; padding:10px 12px; border-radius:10px; background: rgba(0,0,0,0.18); color: #fff; border:1px solid rgba(255,255,255,0.06); font-size:13px;"></textarea>
              <div style="display:flex; flex-direction:column; gap:6px;">
                <button id="msghelp-convo-send" style="appearance:none;border:1px solid rgba(37,211,102,0.18);background:#25d366;color:#012; padding:8px 12px;border-radius:10px; font-weight:600; cursor:pointer;">Send</button>
                <button id="msghelp-convo-close" style="appearance:none;border:1px solid rgba(255,255,255,0.08);background:transparent;color:rgba(255,255,255,0.7); padding:6px 8px;border-radius:8px; font-size:12px; cursor:pointer;">Close</button>
              </div>
            </div>
          </div>
      </div>
    `;

    // Add close button functionality with animation
    const closeBtn = box.querySelector("#msghelp-close");
    closeBtn.addEventListener("click", () => {
      box.style.opacity = "0";
      box.style.transform = "translateX(-50%) translateY(-30px)";
      setTimeout(() => {
        box.style.display = "none";
      }, 300);
    });

    chatContainer.appendChild(box);
    // Conversation UI wiring (safe guards)
    try {
      const continueBtn = box.querySelector("#msghelp-continue-btn");
      const convoArea = box.querySelector("#msghelp-conversation-area");
      const convoLog = box.querySelector("#msghelp-convo-log");
      const convoInput = box.querySelector("#msghelp-convo-input");
      const convoSend = box.querySelector("#msghelp-convo-send");
      const convoClose = box.querySelector("#msghelp-convo-close");

      if (continueBtn && convoArea) {
        continueBtn.addEventListener("click", () => {
          const opening = convoArea.style.display === "none";
          convoArea.style.display = opening ? "flex" : "none";
          // Hide suggestions container while in conversation mode
          try {
            const boxEl = document.getElementById("msghelp-floating-box");
            const containerEl =
              boxEl && boxEl.querySelector("#msghelp-suggestions-container");
            if (containerEl)
              containerEl.style.display = opening ? "none" : "block";
          } catch (e) {}

          if (opening) {
            setTimeout(() => convoInput?.focus(), 30);
          }
        });
      }

      if (convoClose) {
        convoClose.addEventListener("click", () => {
          if (convoArea) convoArea.style.display = "none";
        });
      }

      if (convoSend && convoInput) {
        convoSend.addEventListener("click", () => {
          const text = convoInput.value && convoInput.value.trim();
          if (!text) return;
          appendToConvo("user", text, convoLog);
          convoInput.value = "";
          // Send follow-up as a quick request to background
          sendInlineFollowup(text, convoLog);
        });
      }
    } catch (e) {
      console.warn("[CONTENT] Failed to wire conversation UI", e);
    }

    // Inject conversation CSS rules for bubbles and scrollbars (once)
    if (!document.getElementById("msghelp-convo-styles")) {
      const cs = document.createElement("style");
      cs.id = "msghelp-convo-styles";
      cs.textContent = `
        #msghelp-convo-log { font-size:13px; color: #fff; }
        #msghelp-convo-log .msghelp-convo-entry { display:flex; width:100%; }
        #msghelp-convo-log .msghelp-convo-bubble { padding:8px 10px; border-radius:10px; max-width:80%; word-wrap:break-word; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        #msghelp-convo-log .msghelp-convo-user { margin-left:auto; background: rgba(37,211,102,0.12); color: #e9ffef; border:1px solid rgba(37,211,102,0.14); }
        #msghelp-convo-log .msghelp-convo-assistant { margin-right:auto; background: rgba(255,255,255,0.03); color: #fff; border:1px solid rgba(255,255,255,0.03); }
        #msghelp-convo-log::-webkit-scrollbar { height:8px; width:8px; }
        #msghelp-convo-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius:8px; }
        #msghelp-convo-log::-webkit-scrollbar-track { background: transparent; }
        #msghelp-convo-input { font-family: inherit; }
      `;
      document.head.appendChild(cs);
    }

    // Inject manslater-specific CSS (pink theme) if not present
    if (!document.getElementById("msghelp-manslater-style")) {
      const ms = document.createElement("style");
      ms.id = "msghelp-manslater-style";
      ms.textContent = `
        #msghelp-floating-box.msghelp-manslater {
          background: linear-gradient(180deg, rgba(255,182,193,0.12), rgba(255,105,180,0.06));
          border-color: rgba(255,105,180,0.5) !important;
          box-shadow: 0 12px 48px rgba(255,105,180,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        #msghelp-floating-box.msghelp-manslater .msghelp-suggestion {
          background: rgba(255,182,193,0.08) !important;
          border-color: rgba(255,105,180,0.18) !important;
        }
        /* manslater status element removed - no status text displayed beneath the button */
        .msghelp-manslater-btn {
          transition: all 0.18s ease;
          opacity: 0.95;
        }
        .msghelp-manslater-btn.active {
          background: linear-gradient(90deg, rgba(255,105,180,0.18), rgba(255,120,200,0.12));
          border-color: rgba(255,105,180,0.6) !important;
          color: #fff !important;
          box-shadow: 0 6px 18px rgba(255,105,180,0.08);
          transform: translateY(-1px);
        }
      `;
      document.head.appendChild(ms);
    }

    // Hook up the manslater toggle (button) to storage and update UI
    const mansButton = box.querySelector("#msghelp-manslater-btn");

    function applyManslaterMode(enabled) {
      try {
        if (enabled) {
          box.classList.add("msghelp-manslater");
        } else {
          box.classList.remove("msghelp-manslater");
        }
      } catch (e) {
        console.warn("[CONTENT] applyManslaterMode error", e);
      }
    }

    if (mansButton) {
      // Initialize from storage
      chrome.storage.local.get(
        ["manslaterMode"],
        ({ manslaterMode = false }) => {
          try {
            if (manslaterMode) {
              mansButton.classList.add("active");
              mansButton.textContent = "Manslater: On";
            } else {
              mansButton.classList.remove("active");
              mansButton.textContent = "Manslater: Off";
            }
            applyManslaterMode(!!manslaterMode);
          } catch (e) {}
        }
      );

      mansButton.addEventListener("click", () => {
        // Toggle current state
        chrome.storage.local.get(
          ["manslaterMode"],
          ({ manslaterMode = false }) => {
            const enabled = !manslaterMode;
            chrome.storage.local.set({ manslaterMode: enabled }, () => {
              if (enabled) {
                mansButton.classList.add("active");
                mansButton.textContent = "Manslater: On";
              } else {
                mansButton.classList.remove("active");
                mansButton.textContent = "Manslater: Off";
              }
              applyManslaterMode(enabled);
            });
          }
        );
      });
    }

    // Trigger animation after a short delay
    setTimeout(() => {
      box.style.opacity = "1";
      box.style.transform = "translateX(-50%) translateY(0)";
    }, 50);

    console.log("[CONTENT] Floating box injected successfully");
  }

  // Update suggestions in floating box
  function updateFloatingSuggestions(suggestions) {
    console.log(
      "[CONTENT] updateFloatingSuggestions called with:",
      suggestions
    );
    const box = document.getElementById("msghelp-floating-box");
    if (!box) {
      console.log("[CONTENT] Floating box not found, injecting...");
      injectFloatingBox();
      return updateFloatingSuggestions(suggestions); // Retry after injection
    }

    const container = box.querySelector("#msghelp-suggestions-container");
    if (!container) {
      console.log("[CONTENT] Suggestions container not found");
      return;
    }

    // If convo area is visible, skip rendering suggestions (conversation-only mode)
    try {
      const convoArea = box.querySelector("#msghelp-conversation-area");
      if (convoArea && convoArea.style.display !== "none") {
        console.log(
          "[CONTENT] In conversation mode — skipping suggestion render"
        );
        // ensure suggestions container is hidden while in convo mode
        const c = box.querySelector("#msghelp-suggestions-container");
        if (c) c.style.display = "none";
        return;
      }
    } catch (e) {}

    // Show the box with animation if hidden
    if (box.style.display === "none" || box.style.opacity === "0") {
      box.style.display = "block";
      setTimeout(() => {
        box.style.opacity = "1";
        box.style.transform = "translateX(-50%) translateY(0)";
      }, 50);
    }

    if (!suggestions || suggestions.length === 0) {
      container.innerHTML = `
        <div style="color: rgba(255, 255, 255, 0.5); font-style: italic; font-size: 14px; text-align: center; padding: 12px;">
          <div style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, rgba(138, 99, 210, 0.6), rgba(94, 114, 228, 0.6)); animation: msghelp-pulse-glow 2s ease-in-out infinite; margin-right: 8px;"></div>
          No suggestions available
        </div>
      `;
      // Keep the box visible even if no suggestions
      console.log("[CONTENT] No suggestions to display");
      return;
    }

    // ...existing code...

    console.log(
      "[CONTENT] Creating suggestions list with",
      suggestions.length,
      "items"
    );
    // Create suggestion list with animated liquid glass styling
    const suggestionsList = suggestions
      .map(
        (suggestion, index) => `
      <div class="msghelp-suggestion" data-text="${escapeHtml(suggestion)}" 
           style="
             padding: 14px 16px; 
             margin: 8px 0; 
             background: rgba(255, 255, 255, 0.1); 
             border-radius: 18px; 
             cursor: pointer; 
             transition: all 0.3s ease; 
             border: 1px solid rgba(255, 255, 255, 0.18); 
             font-size: 14.5px; 
             color: rgba(255, 255, 255, 0.95); 
             backdrop-filter: blur(20px); 
             box-shadow: 
               0 2px 8px rgba(0, 0, 0, 0.05), 
               inset 0 1px 0 rgba(255, 255, 255, 0.2);
             position: relative;
             overflow: hidden;
             animation: msghelp-suggestion-fadein 0.5s ease ${
               index * 0.1
             }s backwards;
           "
           onmouseover="
             this.style.background='rgba(255, 255, 255, 0.18)'; 
             this.style.borderColor='rgba(255, 255, 255, 0.3)'; 
             this.style.transform='translateX(4px)'; 
             this.style.boxShadow='0 4px 16px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
           " 
           onmouseout="
             this.style.background='rgba(255, 255, 255, 0.1)'; 
             this.style.borderColor='rgba(255, 255, 255, 0.18)'; 
             this.style.transform='translateX(0)'; 
             this.style.boxShadow='0 2px 8px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
           ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 20px; height: 20px; border-radius: 8px; background: rgba(255, 255, 255, 0.15); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid rgba(255, 255, 255, 0.25);">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.8)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <span style="flex: 1; line-height: 1.5;">${escapeHtml(
            suggestion
          )}</span>
        </div>
      </div>
    `
      )
      .join("");

    // Add fade-in animation for suggestions
    if (!document.getElementById("msghelp-suggestion-animations")) {
      const style = document.createElement("style");
      style.id = "msghelp-suggestion-animations";
      style.textContent = `
        @keyframes msghelp-suggestion-fadein {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    container.innerHTML = suggestionsList;
    console.log("[CONTENT] Floating box updated and shown");

    // Add click handlers to suggestions
    container.querySelectorAll(".msghelp-suggestion").forEach((item) => {
      item.addEventListener("click", () => {
        const suggestionText = item.dataset.text;
        copyToClipboard(suggestionText);

        // Show feedback with clean glass success state
        item.style.background = "rgba(100, 220, 150, 0.15)";
        item.style.borderColor = "rgba(100, 220, 150, 0.4)";
        item.style.color = "rgba(255, 255, 255, 1)";
        item.style.transform = "scale(1.02)";
        item.style.boxShadow = `
          0 4px 20px rgba(100, 220, 150, 0.2), 
          inset 0 1px 0 rgba(255, 255, 255, 0.3)
        `;
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px; justify-content: center;">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(100, 220, 150, 0.25); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(100, 220, 150, 0.5); animation: msghelp-success-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(100, 220, 150, 1)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <span style="font-weight: 500; font-size: 15px;">Copied to clipboard!</span>
          </div>
        `;

        // Add success animation
        if (!document.getElementById("msghelp-success-animations")) {
          const style = document.createElement("style");
          style.id = "msghelp-success-animations";
          style.textContent = `
            @keyframes msghelp-success-pop {
              0% { transform: scale(0); opacity: 0; }
              50% { transform: scale(1.2); }
              100% { transform: scale(1); opacity: 1; }
            }
          `;
          document.head.appendChild(style);
        }

        setTimeout(() => {
          // Keep the box visible after copying
        }, 1500);
      });
    });
  }

  // Append a message to the small conversation log inside the floating box
  function appendToConvo(role, text, convoLogEl) {
    try {
      const log = convoLogEl || document.querySelector("#msghelp-convo-log");
      if (!log) return;
      const entry = document.createElement("div");
      entry.className = "msghelp-convo-entry";
      entry.style.margin = "6px 0";
      entry.style.display = "flex";

      const bubble = document.createElement("div");
      bubble.className =
        "msghelp-convo-bubble " +
        (role === "user" ? "msghelp-convo-user" : "msghelp-convo-assistant");
      bubble.textContent = text;

      entry.appendChild(bubble);
      log.appendChild(entry);
      // Auto-scroll
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      console.warn("[CONTENT] appendToConvo error", e);
    }
  }

  // Send a quick follow-up inline using the same REQUEST_SUGGESTION message shape
  function sendInlineFollowup(text, convoLogEl) {
    try {
      // prepare a minimal message object similar to saved messages
      const msgObj = {
        text,
        timestamp: Date.now(),
        platform: "whatsapp",
        type: "outgoing",
        sessionId: currentChatSession || null,
      };

      // show spinner in suggestions area
      const box = document.getElementById("msghelp-floating-box");
      if (box) {
        const container = box.querySelector("#msghelp-suggestions-container");
        if (container)
          container.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">' +
            '<span class="msghelp-spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(37, 211, 102, 0.3);border-top:2px solid #25d366;border-radius:50%;animation:msghelp-spin 0.8s linear infinite;"></span>' +
            ' <span style="color:#8696a0;font-size:13.5px;">Thinking...</span></div>';
      }

      chrome.runtime.sendMessage(
        {
          type: "REQUEST_SUGGESTION",
          messages: [msgObj],
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            const errText = "No response from backend";
            appendToConvo("assistant", errText, convoLogEl);
            // also show in suggestions container
            const b = document.getElementById("msghelp-floating-box");
            if (b) {
              const container = b.querySelector(
                "#msghelp-suggestions-container"
              );
              if (container)
                container.innerHTML = `<div style=\"color: rgba(255, 255, 255, 0.5); font-style: italic; font-size: 14px; text-align: center; padding: 12px;\">${escapeHtml(
                  errText
                )}</div>`;
            }
          } else {
            // response will come via SHOW_SUGGESTIONS and be appended there
          }
        }
      );
    } catch (e) {
      console.warn("[CONTENT] sendInlineFollowup error", e);
    }
  }

  // Copy text to clipboard
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  // Inject floating box when content script loads
  setTimeout(injectFloatingBox, 1000);

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
      const preview = document.querySelector("#main header span[title]");
      if (!preview) return "";
      const header = preview.closest("header") || preview.parentElement;
      if (!header) return "";
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
            // Request suggestion after context is loaded
            requestSuggestion();
          }, 1000);
        }, 1500); // Wait for chat to fully load
      } else {
        // If context already saved, just enable new message capture
        setTimeout(() => {
          isInitialized = true;
          console.log(
            "[CONTENT] 🔄 Now capturing new messages only (context already loaded)"
          );
          // Request suggestion after context is loaded
          requestSuggestion();
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

    // Auto-suggest replies for incoming messages
    if (guessDirection(container) === "incoming") {
      setTimeout(() => {
        requestSuggestion();
      }, 1000); // Small delay to let the message be saved
    }
  }

  // Request suggestion from popup/backend
  function requestSuggestion() {
    try {
      // Ensure floating box exists and show loading animation
      let box = document.getElementById("msghelp-floating-box");
      if (!box) {
        // try to inject immediately; injectFloatingBox will retry if the chat container isn't ready
        injectFloatingBox();
        box = document.getElementById("msghelp-floating-box");
      }
      if (box) {
        const container = box.querySelector("#msghelp-suggestions-container");
        if (container) {
          container.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">' +
            '<span class="msghelp-spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(37, 211, 102, 0.3);border-top:2px solid #25d366;border-radius:50%;animation:msghelp-spin 0.8s linear infinite;"></span>' +
            ' <span style="color:#8696a0;font-size:13.5px;">Generating reply...</span></div>';
          // Add spinner animation style if not present
          if (!document.getElementById("msghelp-spinner-style")) {
            const style = document.createElement("style");
            style.id = "msghelp-spinner-style";
            style.textContent =
              "@keyframes msghelp-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
            document.head.appendChild(style);
          }
        }
        // Show the box with animation if hidden
        if (box.style.display === "none" || box.style.opacity === "0") {
          box.style.display = "block";
          setTimeout(() => {
            box.style.opacity = "1";
            box.style.transform = "translateX(-50%) translateY(0)";
          }, 50);
        }
      }
      chrome.storage.local.get(["messages"], ({ messages = [] }) => {
        if (messages.length === 0) return;

        // Send request to background or popup for suggestion
        chrome.runtime.sendMessage(
          {
            type: "REQUEST_SUGGESTION",
            messages: messages.slice(0, 5),
          },
          (resp) => {
            // If background didn't respond (e.g. error), ensure box shows 'No suggestions'
            if (chrome.runtime.lastError) {
              const b = document.getElementById("msghelp-floating-box");
              if (b) {
                const container = b.querySelector(
                  "#msghelp-suggestions-container"
                );
                if (container)
                  container.innerHTML =
                    '<div style="color: rgba(255, 255, 255, 0.5); font-style: italic; font-size: 14px; text-align: center; padding: 12px;">No suggestions available</div>';
              }
            }
          }
        );
      });
    } catch (e) {
      console.log("[CONTENT] Could not request suggestion:", e);
    }
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
          chrome.storage.local.set({ messages: capped }, () => {
            // After context is saved, request a suggestion
            requestSuggestion();
          });
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

    if (request.type === "SHOW_SUGGESTIONS") {
      // Update floating box with suggestions
      console.log(
        "[CONTENT] Received SHOW_SUGGESTIONS message:",
        request.suggestions
      );
      updateFloatingSuggestions(request.suggestions);
      // If conversation area is visible, append the model replies there as well
      try {
        const convo = document.getElementById("msghelp-conversation-area");
        const convoLog = document.getElementById("msghelp-convo-log");
        if (convo && convo.style.display !== "none" && convoLog) {
          if (request.error) {
            appendToConvo("assistant", String(request.error), convoLog);
          } else if (request.suggestions && request.suggestions.length > 0) {
            request.suggestions.forEach((s) =>
              appendToConvo("assistant", s, convoLog)
            );
          }
        }
      } catch (e) {
        // ignore
      }
      sendResponse({ ok: true });
      return;
    }

    if (request.type === "TEST_FLOATING_BOX") {
      // Test function to show floating box with sample suggestions
      console.log("[CONTENT] Testing floating box with sample suggestions");
      updateFloatingSuggestions([
        "Test suggestion 1",
        "Test suggestion 2",
        "Test suggestion 3",
      ]);
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
