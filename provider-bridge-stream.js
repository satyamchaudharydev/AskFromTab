// Provider-agnostic stream engine for ChatGPT, Gemini, and Claude.
(function registerT2CProviderBridgeStream() {
  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

  let streamTickQueued = false;

  function startStream({ providerId, requestId, sourceTabId }) {
    stopActiveStream();

    bridge.forceToLatest(providerId);
    const baseline = bridge.readLatestSnapshot(providerId);
    const streamState = {
      requestId,
      sourceTabId,
      provider: providerId || "chatgpt",
      lastText: "",
      lastHtml: "",
      baselineFingerprint: baseline.fingerprint || "",
      lastFingerprint: baseline.fingerprint || "",
      sawFreshAssistant: false,
      lastUpdateAt: Date.now(),
      lastPulseAt: Date.now(),
      lastAutoScrollAt: 0,
      startedAt: Date.now(),
      observer: null,
      interval: null
    };

    window.__T2C_STREAM_STATE__ = streamState;
    sendStreamEvent(streamState, "start", "");

    const root = document.querySelector("main") || document.body;
    const observer = new MutationObserver(() => {
      scheduleStreamTick(streamState);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
    streamState.observer = observer;

    streamState.interval = setInterval(() => {
      streamTick(streamState);
    }, 450);

    streamTick(streamState);
  }

  function scheduleStreamTick(streamState) {
    if (streamTickQueued) return;
    streamTickQueued = true;
    setTimeout(() => {
      streamTickQueued = false;
      streamTick(streamState);
    }, 120);
  }

  function streamTick(streamState) {
    if (!streamState || window.__T2C_STREAM_STATE__ !== streamState) return;

    const now = Date.now();
    const providerId = streamState.provider || "chatgpt";
    const isGenerating = bridge.isGenerating(providerId);
    maybeAutoScrollToLatest(streamState, providerId, isGenerating, now);

    const latest = bridge.readLatestSnapshot(providerId);
    const latestText = latest.text || "";
    const latestHtml = latest.html || "";
    const latestFingerprint = latest.fingerprint || "";
    const isFreshAssistant =
      Boolean(latestFingerprint) && latestFingerprint !== streamState.baselineFingerprint;

    if (
      isFreshAssistant &&
      latestText &&
      (latestText !== streamState.lastText || latestFingerprint !== streamState.lastFingerprint)
    ) {
      streamState.sawFreshAssistant = true;
      streamState.lastText = latestText;
      streamState.lastHtml = latestHtml;
      streamState.lastFingerprint = latestFingerprint;
      streamState.lastUpdateAt = now;
      streamState.lastPulseAt = now;
      sendStreamEvent(streamState, "update", latestText, "", latestHtml);
    }

    if (isGenerating && now - streamState.lastPulseAt > 2600) {
      streamState.lastPulseAt = now;
      sendStreamEvent(streamState, "update", streamState.lastText || "Streaming...");
    }

    const timeSinceUpdate = now - streamState.lastUpdateAt;
    const elapsed = now - streamState.startedAt;
    const noResponseTimeoutMs = providerId === "chatgpt" ? 70000 : 90000;

    if (!streamState.sawFreshAssistant && !isGenerating && elapsed > noResponseTimeoutMs) {
      sendStreamEvent(streamState, "error", "", "No assistant response found yet.");
      stopActiveStream();
      return;
    }

    if (streamState.sawFreshAssistant && !isGenerating && timeSinceUpdate > 1800) {
      sendStreamEvent(
        streamState,
        "done",
        streamState.lastText || latestText || "",
        "",
        streamState.lastHtml || latestHtml || ""
      );
      stopActiveStream();
      return;
    }

    if (elapsed > 180000) {
      sendStreamEvent(
        streamState,
        "done",
        streamState.lastText || latestText || "",
        "",
        streamState.lastHtml || latestHtml || ""
      );
      stopActiveStream();
    }
  }

  function maybeAutoScrollToLatest(streamState, providerId, isGenerating, nowTs) {
    if (!streamState) return;
    const now = Number(nowTs) || Date.now();
    const minInterval = providerId === "chatgpt" ? 650 : 700;
    if (now - streamState.lastAutoScrollAt < minInterval) return;
    if (!isGenerating && streamState.sawFreshAssistant) return;
    streamState.lastAutoScrollAt = now;
    bridge.forceToLatest(providerId);
  }

  function sendStreamEvent(streamState, phase, text, error, html) {
    chrome.runtime.sendMessage({
      type: "CHAT_STREAM_EVENT",
      requestId: streamState.requestId,
      sourceTabId: streamState.sourceTabId,
      provider: streamState.provider || "chatgpt",
      phase,
      text: text || "",
      html: html || "",
      error: error || ""
    });
  }

  function stopActiveStream() {
    const active = window.__T2C_STREAM_STATE__;
    if (!active) return;
    if (active.observer) {
      active.observer.disconnect();
    }
    if (active.interval) {
      clearInterval(active.interval);
    }
    window.__T2C_STREAM_STATE__ = null;
  }

  bridge.startStream = startStream;
  bridge.stopActiveStream = stopActiveStream;
})();
