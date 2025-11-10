// Popup - Simple ON/OFF Toggle
const toggle = document.getElementById("toggle");
const statusDiv = document.getElementById("status");

console.log("[POPUP] Loaded");

// Load current state
chrome.storage.local.get(["enabled"], ({ enabled = false }) => {
  toggle.checked = enabled;
  statusDiv.textContent = enabled ? "Extension ON" : "Extension OFF";
  console.log("[POPUP] Current state:", enabled);
});

// Toggle handler
toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  const msgType = enabled ? "ENABLE_EXTENSION" : "DISABLE_EXTENSION";

  console.log(`[POPUP] Sending ${msgType}`);

  chrome.runtime.sendMessage({ type: msgType }, (response) => {
    console.log("[POPUP] Response:", response);
    statusDiv.textContent = enabled ? "Extension ON" : "Extension OFF";
  });
});
