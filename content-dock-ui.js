// Dock state/actions and UI behavior.
(function registerTab2ChatGPTDockUI() {
  const ns = (window.__T2C_DOCK__ = window.__T2C_DOCK__ || {});

  ns.initDock = function initTab2ChatGPTDock() {
  if (window !== window.top) return;
  if (!/^https?:/i.test(window.location.protocol)) return;

  const providerHostRegex =
    /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|(^|\.)gemini\.google\.com$|(^|\.)claude\.ai$/i;
  if (providerHostRegex.test(window.location.hostname)) return;

  const mountId = "t2c-dock-mount";
  if (document.getElementById(mountId)) return;

  const PROVIDERS = [
    { id: "chatgpt", label: "ChatGPT" },
    { id: "gemini", label: "Gemini" },
    { id: "claude", label: "Claude" }
  ];

  const state = {
    open: false,
    stage: "compose",
    sending: false,
    settings: {
      defaultProvider: "chatgpt",
      includeScreenshot: true,
      includeScreenshotEveryMessage: false,
      includeFullContext: false,
      chatgptResponseMode: "instant",
      autoSend: true
    },
    selectedProvider: "chatgpt",
    hasSentConversationContext: false,
    activeStreamId: "",
    activeStreamProvider: "",
    activeStreamTimer: null,
    activeStreamTimeoutCount: 0,
    messages: [],
    panelLayout: {
      left: null,
      top: null,
      width: 760,
      height: 620
    },
    dragState: null,
    resizeState: null,
    status: { text: "", type: "" }
  };

  const mount = document.createElement("div");
  mount.id = mountId;
  document.documentElement.appendChild(mount);

  const shadow = mount.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .t2c-root {
        position: fixed;
        --t2c-panel-width: 760px;
        --t2c-panel-height: 620px;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        font-family: "Space Grotesk", "Sora", "Avenir Next", "Helvetica Neue", sans-serif;
        color: #f8fafc;
      }

      .t2c-shell {
        display: none;
        flex-direction: column;
        gap: 10px;
        align-items: flex-end;
        position: relative;
      }

      .t2c-shell.open {
        display: flex;
      }

      .t2c-card {
        border-radius: 22px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background:
          radial-gradient(circle at 15% 20%, rgba(240, 119, 82, 0.23), transparent 38%),
          radial-gradient(circle at 74% 24%, rgba(86, 102, 245, 0.18), transparent 48%),
          linear-gradient(130deg, rgba(19, 22, 34, 0.97), rgba(10, 13, 23, 0.98));
        box-shadow:
          0 30px 70px rgba(5, 7, 15, 0.55),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(8px);
      }

      .t2c-compose {
        width: min(var(--t2c-panel-width), calc(100vw - 36px));
        padding: 12px 14px;
        display: none;
        position: relative;
      }

      .t2c-compose.open {
        display: block;
      }

      .t2c-compose-drag {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 14px;
        cursor: move;
      }

      .t2c-compose-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto;
        gap: 10px;
        align-items: center;
      }

      .t2c-star {
        width: 24px;
        height: 24px;
        color: #f07752;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0.95;
      }

      .t2c-compose-input {
        width: 100%;
        min-height: 42px;
        max-height: 130px;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        color: #f8fafc;
        font-size: 19px;
        line-height: 1.35;
        font-weight: 500;
        padding: 6px 2px;
      }

      .t2c-compose-input::placeholder {
        color: rgba(226, 232, 240, 0.42);
      }

      .t2c-select {
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.04);
        color: #e2e8f0;
        height: 38px;
        padding: 0 12px;
        font-size: 13px;
        font-weight: 600;
        outline: none;
      }

      .t2c-select:focus {
        border-color: rgba(240, 119, 82, 0.72);
      }

      .t2c-toggle-btn {
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.04);
        color: #cbd5e1;
        height: 38px;
        padding: 0 11px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .t2c-toggle-btn.active {
        border-color: rgba(240, 119, 82, 0.78);
        color: #fff1ea;
        background: rgba(240, 119, 82, 0.13);
      }

      .t2c-send-btn {
        border: none;
        border-radius: 12px;
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #f08b61, #de6d4a);
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 14px 30px rgba(240, 119, 82, 0.32);
      }

      .t2c-send-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .t2c-hint {
        margin-top: 8px;
        font-size: 11px;
        color: rgba(226, 232, 240, 0.52);
        letter-spacing: 0.02em;
      }

      .t2c-chat {
        width: min(var(--t2c-panel-width), calc(100vw - 28px));
        height: min(var(--t2c-panel-height), calc(100vh - 28px));
        display: none;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }

      .t2c-chat.open {
        display: flex;
      }

      .t2c-chat-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        cursor: move;
      }

      .t2c-chat-title {
        font-size: 15px;
        font-weight: 700;
        color: #f8fafc;
      }

      .t2c-chat-sub {
        font-size: 11px;
        color: rgba(226, 232, 240, 0.58);
      }

      .t2c-head-actions {
        display: inline-flex;
        gap: 8px;
      }

      .t2c-ghost-btn {
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.03);
        color: #cbd5e1;
        padding: 6px 9px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }

      .t2c-ghost-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .t2c-chat-body {
        flex: 1;
        overflow: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .t2c-empty {
        margin: auto;
        color: rgba(226, 232, 240, 0.62);
        text-align: center;
        font-size: 12px;
      }

      .t2c-msg-row {
        display: flex;
        width: 100%;
      }

      .t2c-msg-row.user {
        justify-content: flex-end;
      }

      .t2c-msg-row.assistant {
        justify-content: flex-start;
      }

      .t2c-bubble {
        max-width: 84%;
        border-radius: 16px;
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .t2c-bubble.user {
        background: rgba(195, 180, 239, 0.22);
        color: #f8fafc;
        border: 1px solid rgba(195, 180, 239, 0.42);
      }

      .t2c-bubble.assistant {
        background: rgba(15, 23, 42, 0.68);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .t2c-bubble.assistant.error {
        border-color: rgba(248, 113, 113, 0.66);
        color: #fecaca;
      }

      .t2c-bubble.assistant.rich {
        white-space: normal;
      }

      .t2c-md-root {
        color: inherit;
      }

      .t2c-md-root > *:first-child {
        margin-top: 0;
      }

      .t2c-md-root > *:last-child {
        margin-bottom: 0;
      }

      .t2c-md-root p {
        margin: 0 0 9px;
      }

      .t2c-md-root h1,
      .t2c-md-root h2,
      .t2c-md-root h3,
      .t2c-md-root h4,
      .t2c-md-root h5,
      .t2c-md-root h6 {
        margin: 10px 0 8px;
        line-height: 1.3;
        letter-spacing: 0.01em;
      }

      .t2c-md-root h1 { font-size: 19px; }
      .t2c-md-root h2 { font-size: 17px; }
      .t2c-md-root h3 { font-size: 15px; }
      .t2c-md-root h4,
      .t2c-md-root h5,
      .t2c-md-root h6 { font-size: 14px; }

      .t2c-md-root ul,
      .t2c-md-root ol {
        margin: 0 0 10px;
        padding-left: 18px;
      }

      .t2c-md-root li {
        margin: 3px 0;
      }

      .t2c-md-root blockquote {
        margin: 0 0 10px;
        padding: 6px 10px;
        border-left: 3px solid rgba(240, 119, 82, 0.7);
        background: rgba(240, 119, 82, 0.08);
        border-radius: 8px;
      }

      .t2c-md-root pre {
        margin: 0 0 10px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(2, 6, 15, 0.86);
        border: 1px solid rgba(148, 163, 184, 0.24);
        overflow: auto;
      }

      .t2c-md-root pre code {
        white-space: pre;
      }

      .t2c-md-root code {
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
        background: rgba(15, 23, 42, 0.74);
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 6px;
        padding: 1px 5px;
      }

      .t2c-md-root a {
        color: #f9b896;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .t2c-md-root hr {
        border: none;
        border-top: 1px solid rgba(148, 163, 184, 0.3);
        margin: 8px 0 10px;
      }

      .t2c-md-root table {
        width: 100%;
        border-collapse: collapse;
        margin: 0 0 10px;
        font-size: 12px;
      }

      .t2c-md-root th,
      .t2c-md-root td {
        border: 1px solid rgba(148, 163, 184, 0.28);
        padding: 6px 8px;
        vertical-align: top;
        text-align: left;
      }

      .t2c-md-root th {
        background: rgba(30, 41, 59, 0.5);
      }

      .t2c-chat-foot {
        padding: 10px 14px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .t2c-follow-tools {
        display: flex;
        justify-content: flex-start;
        margin-bottom: 7px;
      }

      .t2c-follow-tool {
        height: 30px;
        padding: 0 10px;
        font-size: 11px;
      }

      .t2c-follow-row {
        position: relative;
      }

      .t2c-follow-input {
        width: 100%;
        min-height: 40px;
        max-height: 120px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.04);
        color: #f8fafc;
        resize: none;
        outline: none;
        font-size: 13px;
        line-height: 1.4;
        padding: 11px 82px 11px 12px;
      }

      .t2c-follow-input::placeholder {
        color: rgba(226, 232, 240, 0.5);
      }

      .t2c-follow-send {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        height: 34px;
        border-radius: 10px;
        border: none;
        width: 64px;
        background: linear-gradient(135deg, #f08b61, #de6d4a);
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        font-weight: 700;
        box-shadow: 0 8px 18px rgba(240, 119, 82, 0.26);
      }

      .t2c-follow-send:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .t2c-status {
        margin-top: 8px;
        min-height: 16px;
        font-size: 11px;
        color: rgba(226, 232, 240, 0.7);
      }

      .t2c-status.error {
        color: #fecaca;
      }

      .t2c-status.ok {
        color: #bbf7d0;
      }

      .t2c-resizer {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 18px;
        height: 18px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(15, 23, 42, 0.62);
        cursor: nwse-resize;
      }

      .t2c-fab {
        border: none;
        border-radius: 999px;
        padding: 12px 15px;
        min-width: 110px;
        background: linear-gradient(135deg, #101425, #090b14);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 16px 34px rgba(5, 7, 15, 0.45);
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
      }

      .t2c-fab.hidden {
        display: none;
      }

      @media (max-width: 720px) {
        .t2c-root {
          top: auto !important;
          right: 10px;
          left: 10px;
          bottom: 10px;
          --t2c-panel-width: calc(100vw - 20px);
          --t2c-panel-height: min(76vh, 620px);
        }

        .t2c-compose {
          width: calc(100vw - 20px);
          padding: 10px;
        }

        .t2c-compose-row {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "input input"
            "select send";
          row-gap: 8px;
        }

        .t2c-star,
        .t2c-toggle-btn {
          display: none;
        }

        .t2c-compose-input {
          grid-area: input;
          font-size: 16px;
          min-height: 46px;
        }

        .t2c-select {
          grid-area: select;
          width: 100%;
        }

        .t2c-send-btn {
          grid-area: send;
          width: 48px;
          height: 40px;
          border-radius: 10px;
        }

        .t2c-chat {
          width: calc(100vw - 20px);
          height: min(76vh, 620px);
        }

        .t2c-resizer {
          display: none;
        }
      }
    </style>

    <div class="t2c-root">
      <div id="t2c-shell" class="t2c-shell">
        <section id="t2c-compose" class="t2c-card t2c-compose">
          <div id="t2c-compose-drag" class="t2c-compose-drag" aria-hidden="true"></div>
          <div class="t2c-compose-row">
            <span class="t2c-star" aria-hidden="true">*</span>
            <textarea id="t2c-compose-input" class="t2c-compose-input" placeholder="What can I help you with today?"></textarea>
            <select id="t2c-provider-select" class="t2c-select"></select>
            <button id="t2c-image-toggle" class="t2c-toggle-btn active" type="button">Image On</button>
            <button id="t2c-full-context-toggle" class="t2c-toggle-btn" type="button">Full Ctx Off</button>
            <button id="t2c-gpt-mode-toggle" class="t2c-toggle-btn" type="button">GPT Instant</button>
            <button id="t2c-compose-send" class="t2c-send-btn" type="button" title="Send">Go</button>
          </div>
          <div class="t2c-hint">Enter to send • Shift+Enter for new line • Cmd/Ctrl+Shift+K toggle</div>
        </section>

        <section id="t2c-chat" class="t2c-card t2c-chat">
          <div class="t2c-chat-head">
            <div>
              <div class="t2c-chat-title">In-page AI Chat</div>
              <div id="t2c-chat-sub" class="t2c-chat-sub">Provider: ChatGPT</div>
            </div>
            <div class="t2c-head-actions">
              <button id="t2c-new-chat" class="t2c-ghost-btn" type="button">New chat</button>
              <button id="t2c-collapse" class="t2c-ghost-btn" type="button">Collapse</button>
            </div>
          </div>

          <div id="t2c-chat-body" class="t2c-chat-body">
            <div class="t2c-empty">Ask your first question to start.</div>
          </div>

          <div class="t2c-chat-foot">
            <div class="t2c-follow-tools">
              <button id="t2c-image-every-toggle" class="t2c-toggle-btn t2c-follow-tool" type="button">Img Each Off</button>
            </div>
            <div class="t2c-follow-row">
              <textarea id="t2c-follow-input" class="t2c-follow-input" placeholder="Ask follow-up"></textarea>
              <button id="t2c-follow-send" class="t2c-follow-send" type="button" title="Send follow-up">Go</button>
            </div>
            <div id="t2c-status" class="t2c-status"></div>
          </div>
          <div id="t2c-resizer" class="t2c-resizer" title="Resize"></div>
        </section>
      </div>

      <button id="t2c-fab" class="t2c-fab" type="button">Ask AI</button>
    </div>
  `;

  const rootEl = shadow.querySelector(".t2c-root");
  const shellEl = shadow.getElementById("t2c-shell");
  const composeEl = shadow.getElementById("t2c-compose");
  const composeDragEl = shadow.getElementById("t2c-compose-drag");
  const composeInputEl = shadow.getElementById("t2c-compose-input");
  const providerSelectEl = shadow.getElementById("t2c-provider-select");
  const imageToggleEl = shadow.getElementById("t2c-image-toggle");
  const imageEveryToggleEl = shadow.getElementById("t2c-image-every-toggle");
  const fullContextToggleEl = shadow.getElementById("t2c-full-context-toggle");
  const gptModeToggleEl = shadow.getElementById("t2c-gpt-mode-toggle");
  const composeSendEl = shadow.getElementById("t2c-compose-send");
  const chatEl = shadow.getElementById("t2c-chat");
  const chatHeadEl = shadow.querySelector(".t2c-chat-head");
  const chatSubEl = shadow.getElementById("t2c-chat-sub");
  const newChatEl = shadow.getElementById("t2c-new-chat");
  const collapseEl = shadow.getElementById("t2c-collapse");
  const resizerEl = shadow.getElementById("t2c-resizer");
  const chatBodyEl = shadow.getElementById("t2c-chat-body");
  const followInputEl = shadow.getElementById("t2c-follow-input");
  const followSendEl = shadow.getElementById("t2c-follow-send");
  const statusEl = shadow.getElementById("t2c-status");
  const fabEl = shadow.getElementById("t2c-fab");

  for (const provider of PROVIDERS) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    providerSelectEl.appendChild(option);
  }

  fabEl.addEventListener("click", () => {
    setOpen(!state.open);
  });

  composeSendEl.addEventListener("click", async () => {
    await submitInitialQuestion();
  });

  composeInputEl.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await submitInitialQuestion();
  });

  followSendEl.addEventListener("click", async () => {
    await submitFollowupQuestion();
  });

  followInputEl.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await submitFollowupQuestion();
  });

  providerSelectEl.addEventListener("change", async () => {
    const previousProvider = state.selectedProvider;
    state.selectedProvider = providerSelectEl.value;
    chatSubEl.textContent = `Provider: ${providerLabel(state.selectedProvider)}`;
    if (previousProvider !== state.selectedProvider) {
      state.hasSentConversationContext = false;
    }
    await persistSetting({ defaultProvider: state.selectedProvider });
  });

  imageToggleEl.addEventListener("click", async () => {
    const next = !state.settings.includeScreenshot;
    state.settings.includeScreenshot = next;
    imageToggleEl.classList.toggle("active", next);
    imageToggleEl.textContent = next ? "Image On" : "Image Off";
    await persistSetting({ includeScreenshot: next });
  });

  imageEveryToggleEl.addEventListener("click", async () => {
    const next = !state.settings.includeScreenshotEveryMessage;
    state.settings.includeScreenshotEveryMessage = next;
    imageEveryToggleEl.classList.toggle("active", next);
    imageEveryToggleEl.textContent = next ? "Img Each On" : "Img Each Off";
    await persistSetting({ includeScreenshotEveryMessage: next });
  });

  fullContextToggleEl.addEventListener("click", async () => {
    const next = !state.settings.includeFullContext;
    state.settings.includeFullContext = next;
    fullContextToggleEl.classList.toggle("active", next);
    fullContextToggleEl.textContent = next ? "Full Ctx On" : "Full Ctx Off";
    await persistSetting({ includeFullContext: next });
  });

  gptModeToggleEl.addEventListener("click", async () => {
    const next = state.settings.chatgptResponseMode === "thinking" ? "instant" : "thinking";
    state.settings.chatgptResponseMode = next;
    applyChatGPTModeToggle();
    await persistSetting({ chatgptResponseMode: next });
  });

  newChatEl.addEventListener("click", () => {
    state.messages = [];
    state.hasSentConversationContext = false;
    state.activeStreamId = "";
    state.activeStreamProvider = "";
    followInputEl.value = "";
    setStage("compose");
    renderMessages();
    setStatus("New chat ready.", "ok");
  });

  collapseEl.addEventListener("click", () => {
    setOpen(false);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "TOGGLE_DOCK") {
      setOpen(!state.open);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "QUICK_SEND_DEFAULT") {
      const text = state.stage === "chat" ? followInputEl.value.trim() : composeInputEl.value.trim();
      const defaultProvider = state.settings.defaultProvider || "chatgpt";
      const previousProvider = state.selectedProvider;
      state.selectedProvider = defaultProvider;
      providerSelectEl.value = defaultProvider;
      chatSubEl.textContent = `Provider: ${providerLabel(defaultProvider)}`;
      if (previousProvider !== defaultProvider) {
        state.hasSentConversationContext = false;
      }
      sendWithContext(defaultProvider, text || "Summarize this page and answer the key user intent.", {
        followup: state.stage === "chat" && Boolean(text)
      })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "CHAT_STREAM_EVENT") {
      handleStreamEvent(message);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  window.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || !event.shiftKey) return;

    if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      setOpen(!state.open);
    }
  });

  setStage(state.stage);
  syncEnabledState();
  initDragResize();
  hydrateFromSettings();

  async function hydrateFromSettings() {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok) {
      setStatus("Could not load extension settings.", "error");
      return;
    }

    state.settings = response.settings;
    state.selectedProvider = response.settings.defaultProvider || "chatgpt";
    providerSelectEl.value = state.selectedProvider;
    chatSubEl.textContent = `Provider: ${providerLabel(state.selectedProvider)}`;
    imageToggleEl.classList.toggle("active", state.settings.includeScreenshot);
    imageToggleEl.textContent = state.settings.includeScreenshot ? "Image On" : "Image Off";
    imageEveryToggleEl.classList.toggle("active", Boolean(state.settings.includeScreenshotEveryMessage));
    imageEveryToggleEl.textContent = state.settings.includeScreenshotEveryMessage ? "Img Each On" : "Img Each Off";
    fullContextToggleEl.classList.toggle("active", Boolean(state.settings.includeFullContext));
    fullContextToggleEl.textContent = state.settings.includeFullContext ? "Full Ctx On" : "Full Ctx Off";
    state.settings.chatgptResponseMode =
      state.settings.chatgptResponseMode === "thinking" ? "thinking" : "instant";
    applyChatGPTModeToggle();
    renderMessages();
    setStatus("Ready.", "ok");
  }

  async function persistSetting(partial) {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: partial
    });

    if (!response?.ok) {
      setStatus(response?.error || "Could not save setting.", "error");
      return;
    }
    state.settings = response.settings;
  }

  async function submitInitialQuestion() {
    const question = composeInputEl.value.trim() || "Summarize this page and answer my likely intent clearly.";
    await sendWithContext(state.selectedProvider, question, { followup: false });
    composeInputEl.value = "";
  }

  async function submitFollowupQuestion() {
    const question = followInputEl.value.trim();
    if (!question) return;
    await sendWithContext(state.selectedProvider, question, { followup: true });
    followInputEl.value = "";
  }

  async function sendWithContext(providerId, question, options = {}) {
    if (state.sending) return;
    const followup = Boolean(options.followup);
    const supportsStreaming = providerSupportsStream(providerId);

    state.sending = true;
    syncEnabledState();
    setStage("chat");

    const requestId = generateRequestId();
    state.activeStreamId = requestId;
    state.activeStreamProvider = providerId;
    state.activeStreamTimeoutCount = 0;
    if (supportsStreaming) {
      armStreamTimeout(requestId, 40000);
    } else {
      clearStreamTimeout();
    }

    appendMessage({ role: "user", text: question, requestId: "" });
    appendMessage({
      role: "assistant",
      text:
        supportsStreaming
          ? "Thinking..."
          : `Sent to ${providerLabel(providerId)}. Streaming is not enabled for this provider yet.`,
      requestId,
      error: false
    });

    try {
      const includeContextBundle = !state.hasSentConversationContext;
      const includeScreenshot = includeContextBundle
        ? state.settings.includeScreenshot || Boolean(state.settings.includeScreenshotEveryMessage)
        : Boolean(state.settings.includeScreenshotEveryMessage);
      const includeFullContext = includeContextBundle
        ? Boolean(state.settings.includeFullContext)
        : false;
      let context = null;

      if (includeContextBundle) {
        setStatus("Collecting current page context...", "");
        context = await refreshContextSnapshot(question);
      } else {
        setStatus("Sending follow-up without full page context...", "");
      }

      const response = await chrome.runtime.sendMessage({
        type: "SEND_WITH_CONTEXT",
        provider: providerId,
        requestId,
        question,
        includeScreenshot,
        includeFullContext,
        includeContextBundle,
        chatgptResponseMode: state.settings.chatgptResponseMode,
        autoSend: true,
        showProviderTab: false,
        context
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Failed to send context to provider.");
      }

      if (includeContextBundle) {
        state.hasSentConversationContext = true;
      }

      const screenshotSuffix = includeScreenshot ? " + image" : "";
      const contextSuffix = includeContextBundle ? " (with page context)" : " (follow-up only)";
      const gptModeSuffix =
        providerId === "chatgpt"
          ? ` [${state.settings.chatgptResponseMode === "thinking" ? "Thinking" : "Instant"}]`
          : "";
      setStatus(
        `Sent to ${providerLabel(providerId)}${screenshotSuffix}${contextSuffix}${gptModeSuffix}.`,
        "ok"
      );

      if (!supportsStreaming) {
        updateAssistantMessage(requestId, `Sent to ${providerLabel(providerId)} successfully.`, false);
        clearStreamTimeout();
      }

      if (!followup) {
        setOpen(true);
      }
    } catch (error) {
      updateAssistantMessage(requestId, error.message || "Failed to send prompt.", true);
      setStatus(error.message || "Failed to send prompt.", "error");
      if (state.activeStreamId === requestId) {
        state.activeStreamId = "";
        state.activeStreamProvider = "";
      }
      clearStreamTimeout();
    } finally {
      state.sending = false;
      syncEnabledState();
    }
  }

  function setOpen(nextOpen) {
    state.open = nextOpen;
    shellEl.classList.toggle("open", nextOpen);
    fabEl.classList.toggle("hidden", nextOpen);
    setStage(state.stage);
    if (nextOpen) {
      ensurePanelAnchored();
      applyPanelLayout();
    }

    if (!nextOpen) {
      stopPointerInteraction();
      applyDockedFabLayout();
      return;
    }

    if (state.stage === "chat") {
      followInputEl.focus();
    } else {
      composeInputEl.focus();
    }
  }

  function setStage(nextStage) {
    state.stage = nextStage === "chat" ? "chat" : "compose";
    composeEl.classList.toggle("open", state.stage === "compose");
    chatEl.classList.toggle("open", state.stage === "chat");
    if (state.open) {
      constrainPanelLayout();
      applyPanelLayout();
    }
  }

  function initDragResize() {
    composeDragEl?.addEventListener("pointerdown", (event) => {
      beginDrag(event);
    });

    chatHeadEl?.addEventListener("pointerdown", (event) => {
      if (isInteractiveTarget(event.target)) return;
      beginDrag(event);
    });

    resizerEl?.addEventListener("pointerdown", (event) => {
      beginResize(event);
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerInteraction);
    window.addEventListener("pointercancel", stopPointerInteraction);
    window.addEventListener("resize", () => {
      constrainPanelLayout();
      applyPanelLayout();
    });
  }

  function beginDrag(event) {
    if (event.button !== 0) return;
    if (!state.open || isMobileViewport()) return;
    ensurePanelAnchored();
    stopPointerInteraction();
    state.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: state.panelLayout.left,
      startTop: state.panelLayout.top
    };
    event.preventDefault();
  }

  function beginResize(event) {
    if (event.button !== 0) return;
    if (!state.open || isMobileViewport()) return;
    ensurePanelAnchored();
    stopPointerInteraction();
    const anchorLeft = Number(state.panelLayout.left);
    const anchorTop = Number(state.panelLayout.top);
    state.resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: state.panelLayout.width,
      startHeight: state.panelLayout.height,
      anchorLeft,
      anchorTop
    };
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (state.dragState && event.pointerId === state.dragState.pointerId) {
      const dx = event.clientX - state.dragState.startX;
      const dy = event.clientY - state.dragState.startY;
      state.panelLayout.left = Math.round(state.dragState.startLeft + dx);
      state.panelLayout.top = Math.round(state.dragState.startTop + dy);
      constrainPanelLayout();
      applyPanelLayout();
      return;
    }

    if (state.resizeState && event.pointerId === state.resizeState.pointerId) {
      const widthFromPointer = Math.round(event.clientX - state.resizeState.anchorLeft);
      const heightFromPointer = Math.round(event.clientY - state.resizeState.anchorTop);
      state.panelLayout.width = widthFromPointer;
      state.panelLayout.height = heightFromPointer;
      constrainPanelLayout();
      applyPanelLayout();
    }
  }

  function stopPointerInteraction() {
    state.dragState = null;
    state.resizeState = null;
  }

  function ensurePanelAnchored() {
    if (!rootEl) return;
    if (isMobileViewport()) return;

    if (!Number.isFinite(state.panelLayout.width) || state.panelLayout.width <= 0) {
      state.panelLayout.width = 760;
    }
    if (!Number.isFinite(state.panelLayout.height) || state.panelLayout.height <= 0) {
      state.panelLayout.height = 620;
    }

    if (!Number.isFinite(state.panelLayout.left) || !Number.isFinite(state.panelLayout.top)) {
      const margin = 20;
      const composeRect = composeEl.getBoundingClientRect();
      const composeVisibleHeight =
        composeRect.height > 48 ? Math.round(composeRect.height) : 120;
      const anchorHeight = state.stage === "chat" ? state.panelLayout.height : composeVisibleHeight;
      state.panelLayout.left = Math.round(window.innerWidth - state.panelLayout.width - margin);
      state.panelLayout.top = Math.round(window.innerHeight - anchorHeight - margin);
    }
    constrainPanelLayout();
  }

  function constrainPanelLayout() {
    const margin = 8;
    const minWidth = 560;
    const minHeight = 400;
    const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
    const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);

    state.panelLayout.width = clamp(state.panelLayout.width, minWidth, maxWidth);
    state.panelLayout.height = clamp(state.panelLayout.height, minHeight, maxHeight);

    if (!Number.isFinite(state.panelLayout.left) || !Number.isFinite(state.panelLayout.top)) {
      return;
    }

    const maxLeft = Math.max(margin, window.innerWidth - state.panelLayout.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - state.panelLayout.height - margin);
    state.panelLayout.left = clamp(state.panelLayout.left, margin, maxLeft);
    state.panelLayout.top = clamp(state.panelLayout.top, margin, maxTop);
  }

  function applyPanelLayout() {
    if (!rootEl) return;
    if (!state.open) return;
    if (isMobileViewport()) {
      rootEl.style.left = "10px";
      rootEl.style.right = "10px";
      rootEl.style.bottom = "10px";
      rootEl.style.top = "auto";
      rootEl.style.removeProperty("--t2c-panel-width");
      rootEl.style.removeProperty("--t2c-panel-height");
      return;
    }

    if (!Number.isFinite(state.panelLayout.left) || !Number.isFinite(state.panelLayout.top)) {
      ensurePanelAnchored();
    }
    rootEl.style.right = "auto";
    rootEl.style.bottom = "auto";
    rootEl.style.left = `${state.panelLayout.left}px`;
    rootEl.style.top = `${state.panelLayout.top}px`;
    rootEl.style.setProperty("--t2c-panel-width", `${state.panelLayout.width}px`);
    rootEl.style.setProperty("--t2c-panel-height", `${state.panelLayout.height}px`);
  }

  function applyDockedFabLayout() {
    if (!rootEl) return;
    rootEl.style.removeProperty("left");
    rootEl.style.removeProperty("top");
    rootEl.style.removeProperty("right");
    rootEl.style.removeProperty("bottom");
  }

  function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button, textarea, input, select, a, label"));
  }

  function isMobileViewport() {
    return window.innerWidth <= 720;
  }

  function clamp(value, min, max) {
    const next = Number(value);
    if (!Number.isFinite(next)) return min;
    if (next < min) return min;
    if (next > max) return max;
    return next;
  }

  function syncEnabledState() {
    const disabled = state.sending;
    composeSendEl.disabled = disabled;
    followSendEl.disabled = disabled;
    providerSelectEl.disabled = disabled;
    imageToggleEl.disabled = disabled;
    imageEveryToggleEl.disabled = disabled;
    fullContextToggleEl.disabled = disabled;
    gptModeToggleEl.disabled = disabled;
    newChatEl.disabled = disabled;
  }

  async function refreshContextSnapshot(question) {
    const context = extractPageContext(question || "");
    return context;
  }

  function appendMessage(message) {
    const role = String(message.role || "assistant");
    const isError = Boolean(message.error);
    const rawHtml = role === "assistant" ? String(message.html || "") : "";
    state.messages.push({
      id: generateRequestId(),
      role,
      text: String(message.text || ""),
      requestId: String(message.requestId || ""),
      error: isError,
      html: rawHtml,
      safeHtml: role === "assistant" && !isError && rawHtml ? sanitizeProviderHtml(rawHtml) : ""
    });
    renderMessages();
  }

  function updateAssistantMessage(requestId, text, isError, html = "") {
    const idx = findAssistantMessageIndex(requestId);
    if (idx < 0) {
      appendMessage({ role: "assistant", text, requestId, error: isError, html });
      return;
    }

    const target = state.messages[idx];
    const nextText = String(text || "");
    const nextError = Boolean(isError);
    const nextHtml = nextError ? "" : String(html || "");
    const unchanged = target.text === nextText && target.error === nextError && target.html === nextHtml;
    if (unchanged) {
      return;
    }

    target.text = nextText;
    target.error = nextError;
    target.html = nextHtml;
    target.safeHtml = nextError || !nextHtml ? "" : sanitizeProviderHtml(nextHtml);
    renderMessages();
  }

  function findAssistantMessageIndex(requestId) {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role !== "assistant") continue;
      if (state.messages[i].requestId === requestId) return i;
    }
    return -1;
  }

  function renderMessages() {
    chatBodyEl.innerHTML = "";

    if (!state.messages.length) {
      const empty = document.createElement("div");
      empty.className = "t2c-empty";
      empty.textContent = "Ask your first question to start.";
      chatBodyEl.appendChild(empty);
      return;
    }

    for (const message of state.messages) {
      const row = document.createElement("div");
      row.className = `t2c-msg-row ${message.role}`;

      const bubble = document.createElement("div");
      bubble.className = `t2c-bubble ${message.role}`;
      if (message.role === "assistant" && message.error) {
        bubble.classList.add("error");
      }
      const text = message.text || (message.role === "assistant" ? "..." : "");
      if (message.role === "assistant" && !message.error) {
        bubble.classList.add("rich");
        if (message.safeHtml) {
          renderAssistantHtml(bubble, message.safeHtml, text);
        } else {
          renderAssistantMarkdown(bubble, text);
        }
      } else {
        bubble.textContent = text;
      }
      row.appendChild(bubble);
      chatBodyEl.appendChild(row);
    }

    requestAnimationFrame(() => {
      chatBodyEl.scrollTop = chatBodyEl.scrollHeight;
    });
  }

  function handleStreamEvent(message) {
    if (!message?.requestId) return;

    const requestId = String(message.requestId);
    if (message.provider && state.activeStreamId === requestId) {
      state.activeStreamProvider = String(message.provider);
    }
    if (message.phase === "start") {
      updateAssistantMessage(requestId, "Generating response...", false, "");
      if (state.activeStreamId === requestId) {
        state.activeStreamTimeoutCount = 0;
        armStreamTimeout(requestId, 45000);
      }
      return;
    }

    if (message.phase === "update") {
      updateAssistantMessage(
        requestId,
        message.text || "Streaming...",
        false,
        message.html || ""
      );
      if (state.activeStreamId === requestId) {
        state.activeStreamTimeoutCount = 0;
        armStreamTimeout(requestId, 30000);
      }
      return;
    }

    if (message.phase === "done") {
      const text = message.text || "No response text captured.";
      updateAssistantMessage(requestId, text, false, message.html || "");
      setStatus("Response streamed.", "ok");
      if (state.activeStreamId === requestId) {
        state.activeStreamId = "";
        state.activeStreamProvider = "";
      }
      clearStreamTimeout();
      return;
    }

    if (message.phase === "error") {
      updateAssistantMessage(requestId, message.error || "Stream error.", true, "");
      setStatus(message.error || "Stream failed.", "error");
      if (state.activeStreamId === requestId) {
        state.activeStreamId = "";
        state.activeStreamProvider = "";
      }
      clearStreamTimeout();
    }
  }

  function armStreamTimeout(requestId, timeoutMs = 30000) {
    clearStreamTimeout();
    state.activeStreamTimer = setTimeout(() => {
      void (async () => {
        if (state.activeStreamId !== requestId) return;

        const pulled = await attemptPullLatestProviderResponse(requestId);
        if (pulled) {
          return;
        }

        if (state.activeStreamTimeoutCount < 2) {
          state.activeStreamTimeoutCount += 1;
          setStatus("Still waiting for provider response...", "");
          armStreamTimeout(requestId, 25000);
          return;
        }

        setStatus("Waiting for provider response. Open provider tab once if this stays stuck.", "error");
        updateAssistantMessage(
          requestId,
          "No stream update yet. The prompt was sent, but provider UI did not emit updates in time.",
          true
        );
      })();
    }, Math.max(8000, Number(timeoutMs) || 30000));
  }

  function clearStreamTimeout() {
    if (state.activeStreamTimer) {
      clearTimeout(state.activeStreamTimer);
      state.activeStreamTimer = null;
    }
    state.activeStreamTimeoutCount = 0;
  }

  async function attemptPullLatestProviderResponse(requestId) {
    const providerId = state.activeStreamProvider || state.selectedProvider;
    if (!providerSupportsStream(providerId)) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "PULL_PROVIDER_RESPONSE",
        requestId,
        provider: providerId
      });

      if (!response?.ok) {
        return false;
      }

      const text = String(response.text || "").trim();
      const html = String(response.html || "");
      const finalText = text || extractTextFromHtml(html);
      if (!finalText || finalText.length < 8) {
        return false;
      }

      updateAssistantMessage(requestId, finalText, false, html);
      setStatus(`Response synced from ${providerLabel(providerId)}.`, "ok");
      state.activeStreamId = "";
      state.activeStreamProvider = "";
      clearStreamTimeout();
      return true;
    } catch {
      return false;
    }
  }

  function setStatus(text, type) {
    state.status = { text: text || "", type: type || "" };
    statusEl.textContent = state.status.text;
    statusEl.className = `t2c-status ${state.status.type}`.trim();
  }

  function generateRequestId() {
    if (typeof crypto?.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function providerLabel(providerId) {
    const provider = PROVIDERS.find((item) => item.id === providerId);
    return provider ? provider.label : "Unknown";
  }

  function providerSupportsStream(providerId) {
    return providerId === "chatgpt" || providerId === "gemini" || providerId === "claude";
  }

  function applyChatGPTModeToggle() {
    const mode = state.settings.chatgptResponseMode === "thinking" ? "thinking" : "instant";
    const isThinking = mode === "thinking";
    gptModeToggleEl.classList.toggle("active", isThinking);
    gptModeToggleEl.textContent = isThinking ? "GPT Thinking" : "GPT Instant";
  }


    function renderAssistantHtml(container, safeHtml, fallbackText) {
      const renderer = window.__T2C_DOCK__?.renderer;
      if (renderer?.renderAssistantHtml) {
        renderer.renderAssistantHtml(container, safeHtml, fallbackText);
        return;
      }
      container.textContent = String(fallbackText || "");
    }

    function renderAssistantMarkdown(container, text) {
      const renderer = window.__T2C_DOCK__?.renderer;
      if (renderer?.renderAssistantMarkdown) {
        renderer.renderAssistantMarkdown(container, text);
        return;
      }
      container.textContent = String(text || "");
    }

    function extractTextFromHtml(rawHtml) {
      const renderer = window.__T2C_DOCK__?.renderer;
      if (renderer?.extractTextFromHtml) {
        return renderer.extractTextFromHtml(rawHtml);
      }
      return String(rawHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    function sanitizeProviderHtml(rawHtml) {
      const renderer = window.__T2C_DOCK__?.renderer;
      if (renderer?.sanitizeProviderHtml) {
        return renderer.sanitizeProviderHtml(rawHtml);
      }
      return "";
    }

    function extractPageContext(query) {
      const extractor = window.__T2C_DOCK__?.extractPageContext;
      if (typeof extractor === "function") {
        return extractor(query);
      }
      return {
        title: document.title || "",
        url: window.location.href || "",
        selection: "",
        headings: [],
        formPrompts: [],
        formFields: [],
        keyValuePairs: [],
        tableSummaries: [],
        fullPageText: "",
        mainContentPreview: "",
        summary: "",
        rankedChunks: [],
        extractionMethod: "fallback",
        readability: null
      };
    }

  };
})();
