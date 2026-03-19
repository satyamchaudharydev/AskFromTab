// Thin provider-bridge entrypoint and message routing.
(function initProviderBridge() {
  if (window !== window.top) return;
  if (window.__T2C_PROVIDER_BRIDGE_READY__) return;
  window.__T2C_PROVIDER_BRIDGE_READY__ = true;

  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PROVIDER_BRIDGE_PING") {
      sendResponse({ ok: true, bridge: "ready" });
      return true;
    }

    if (message?.type === "FORCE_SCROLL_LATEST") {
      try {
        bridge.forceToLatest("chatgpt");
        bridge.forceToLatest("gemini");
        bridge.forceToLatest("claude");
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message?.type === "READ_LATEST_RESPONSE") {
      try {
        const providerId = bridge.detectProvider(message.provider);
        if (providerId) {
          bridge.forceToLatest(providerId);
        }
        const snapshot = providerId ? bridge.readLatestSnapshot(providerId) : { text: "", html: "", fingerprint: "" };
        sendResponse({
          ok: true,
          provider: providerId || message.provider || "",
          text: snapshot.text || "",
          html: snapshot.html || "",
          fingerprint: snapshot.fingerprint || ""
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message?.type !== "INJECT_PROVIDER_PAYLOAD") return false;

    bridge
      .injectPayload(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
})();
