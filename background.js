const DEFAULT_SETTINGS = {
  defaultProvider: "chatgpt",
  includeScreenshot: true,
  includeScreenshotEveryMessage: false,
  includeFullContext: false,
  chatgptResponseMode: "instant",
  autoSend: true
};

const PROVIDERS = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    openUrl: "https://chatgpt.com/",
    urlPatterns: ["*://chatgpt.com/*", "*://chat.openai.com/*"],
    hostnames: ["chatgpt.com", "chat.openai.com"]
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    openUrl: "https://gemini.google.com/app",
    urlPatterns: ["*://gemini.google.com/*"],
    hostnames: ["gemini.google.com"]
  },
  claude: {
    id: "claude",
    label: "Claude",
    openUrl: "https://claude.ai/new",
    urlPatterns: ["*://claude.ai/*"],
    hostnames: ["claude.ai"]
  }
};

const PROVIDER_BRIDGE_FILES = [
  "provider-bridge-config.js",
  "provider-bridge-utils.js",
  "provider-bridge-scrape.js",
  "provider-bridge-stream.js",
  "provider-bridge-actions.js",
  "provider-bridge.js"
];

const STREAM_SESSIONS = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.sync.set({ assistantSettings: settings });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DOCK" });
  } catch {
    // The active page may not allow content scripts.
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;

  if (command === "toggle-assistant") {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DOCK" });
    } catch {
      // Ignore pages where content scripts are blocked.
    }
    return;
  }

  if (command === "quick-send-default") {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "QUICK_SEND_DEFAULT" });
    } catch {
      // Ignore pages where content scripts are blocked.
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {})
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CAPTURE_PREVIEW_IMAGE") {
    const sourceTab = sender?.tab;
    if (!sourceTab || sourceTab.windowId === undefined) {
      sendResponse({ ok: false, error: "Active tab for preview was not found." });
      return true;
    }

    captureVisibleScreenshot(sourceTab.windowId)
      .then((imageDataUrl) => sendResponse({ ok: true, imageDataUrl: imageDataUrl || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SEND_WITH_CONTEXT") {
    handleSendWithContext(message, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CHAT_STREAM_EVENT") {
    forwardChatStreamEvent(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PULL_PROVIDER_RESPONSE") {
    pullProviderResponse(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getSettings() {
  const stored = await chrome.storage.sync.get("assistantSettings");
  const raw = stored.assistantSettings || {};

  return {
    defaultProvider: normalizeProvider(raw.defaultProvider || DEFAULT_SETTINGS.defaultProvider),
    includeScreenshot:
      typeof raw.includeScreenshot === "boolean"
        ? raw.includeScreenshot
        : DEFAULT_SETTINGS.includeScreenshot,
    includeScreenshotEveryMessage:
      typeof raw.includeScreenshotEveryMessage === "boolean"
        ? raw.includeScreenshotEveryMessage
        : DEFAULT_SETTINGS.includeScreenshotEveryMessage,
    includeFullContext:
      typeof raw.includeFullContext === "boolean"
        ? raw.includeFullContext
        : DEFAULT_SETTINGS.includeFullContext,
    chatgptResponseMode: normalizeChatGPTResponseMode(
      raw.chatgptResponseMode || DEFAULT_SETTINGS.chatgptResponseMode
    ),
    autoSend: typeof raw.autoSend === "boolean" ? raw.autoSend : DEFAULT_SETTINGS.autoSend
  };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = {
    defaultProvider: normalizeProvider(partialSettings.defaultProvider || current.defaultProvider),
    includeScreenshot:
      typeof partialSettings.includeScreenshot === "boolean"
        ? partialSettings.includeScreenshot
        : current.includeScreenshot,
    includeScreenshotEveryMessage:
      typeof partialSettings.includeScreenshotEveryMessage === "boolean"
        ? partialSettings.includeScreenshotEveryMessage
        : current.includeScreenshotEveryMessage,
    includeFullContext:
      typeof partialSettings.includeFullContext === "boolean"
        ? partialSettings.includeFullContext
        : current.includeFullContext,
    chatgptResponseMode: normalizeChatGPTResponseMode(
      partialSettings.chatgptResponseMode || current.chatgptResponseMode
    ),
    autoSend:
      typeof partialSettings.autoSend === "boolean" ? partialSettings.autoSend : current.autoSend
  };

  await chrome.storage.sync.set({ assistantSettings: next });
  return next;
}

function normalizeProvider(providerId) {
  return PROVIDERS[providerId] ? providerId : DEFAULT_SETTINGS.defaultProvider;
}

function normalizeChatGPTResponseMode(value) {
  return String(value || "").toLowerCase() === "thinking" ? "thinking" : "instant";
}

async function handleSendWithContext(message, sender) {
  const sourceTab = sender?.tab;
  if (!sourceTab?.id || sourceTab.windowId === undefined) {
    throw new Error("Source tab was not found.");
  }

  const settings = await getSettings();
  const providerId = normalizeProvider(message.provider || settings.defaultProvider);
  const includeContextBundle =
    typeof message.includeContextBundle === "boolean" ? message.includeContextBundle : true;
  const includeScreenshot =
    typeof message.includeScreenshot === "boolean"
      ? message.includeScreenshot
      : includeContextBundle
        ? settings.includeScreenshot
        : false;
  const includeFullContext =
    includeContextBundle && typeof message.includeFullContext === "boolean"
      ? message.includeFullContext
      : includeContextBundle
        ? settings.includeFullContext
        : false;
  const autoSend = typeof message.autoSend === "boolean" ? message.autoSend : settings.autoSend;
  const chatgptResponseMode = normalizeChatGPTResponseMode(
    message.chatgptResponseMode || settings.chatgptResponseMode
  );
  const showProviderTab = Boolean(message.showProviderTab);
  const context = includeContextBundle ? sanitizeContext(message.context || {}) : sanitizeContext({});
  const question = String(message.question || "").trim();
  const requestId = String(message.requestId || "");

  let screenshotDataUrl = null;
  if (includeScreenshot) {
    screenshotDataUrl = await captureVisibleScreenshot(sourceTab.windowId);
  }

  const prompt = buildPrompt(context, question, {
    includeFullContext,
    includeContextBundle
  });
  let targetTabId = await openProviderTab(providerId, { showProviderTab });
  const payload = {
    type: "INJECT_PROVIDER_PAYLOAD",
    provider: providerId,
    prompt,
    autoSend,
    imageDataUrl: screenshotDataUrl,
    requestId,
    sourceTabId: sourceTab.id,
    chatgptResponseMode: providerId === "chatgpt" ? chatgptResponseMode : "instant",
    source: {
      title: context.title || "",
      url: context.url || ""
    }
  };

  let injected = await sendPayloadToProviderTab(targetTabId, payload);
  let upgradedToForeground = false;
  if (!injected.ok && !showProviderTab) {
    upgradedToForeground = true;
    targetTabId = await openProviderTab(providerId, { showProviderTab: true });
    injected = await sendPayloadToProviderTab(targetTabId, payload);
  }

  if (!injected.ok) {
    throw new Error(injected.error || `Failed to inject prompt into ${providerId}.`);
  }

  trackStreamSession({
    requestId,
    providerId,
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    providerTabId: targetTabId,
    showProviderTab
  });

  return {
    provider: providerId,
    attachedScreenshot: Boolean(screenshotDataUrl),
    includeContextBundle,
    includeFullContext,
    chatgptResponseMode,
    autoSend,
    upgradedToForeground
  };
}

async function captureVisibleScreenshot(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch {
    return null;
  }
}

async function openProviderTab(providerId, options = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  const showProviderTab = Boolean(options.showProviderTab);

  const existingTabs = await chrome.tabs.query({ url: provider.urlPatterns });
  let targetTab = pickBestProviderTab(existingTabs);

  if (targetTab?.id) {
    if (showProviderTab) {
      await chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId !== undefined) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }
    }
  } else {
    targetTab = await chrome.tabs.create({ url: provider.openUrl, active: showProviderTab });
  }

  if (!targetTab?.id) {
    throw new Error(`Could not open ${provider.label}.`);
  }

  await waitForTabLoadComplete(targetTab.id, 16000);

  const finalTab = await chrome.tabs.get(targetTab.id);
  const finalUrl = String(finalTab.url || "");
  if (!isExpectedProviderHost(provider, finalUrl)) {
    const safeHost = extractHostname(finalUrl);
    throw new Error(
      `${provider.label} is not ready (current host: ${safeHost || "unknown"}). Sign in/open ${provider.openUrl} and retry.`
    );
  }

  return targetTab.id;
}

function pickBestProviderTab(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return null;
  }

  const usable = tabs.filter((tab) => tab && tab.id);
  if (!usable.length) {
    return null;
  }

  usable.sort((a, b) => {
    const aActive = a.active ? 1 : 0;
    const bActive = b.active ? 1 : 0;
    if (aActive !== bActive) {
      return bActive - aActive;
    }

    const aLast = Number(a.lastAccessed || 0);
    const bLast = Number(b.lastAccessed || 0);
    return bLast - aLast;
  });

  return usable[0] || null;
}

function waitForTabLoadComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const interval = setInterval(async () => {
      const timedOut = Date.now() - startedAt > timeoutMs;
      if (timedOut) {
        cleanup();
        reject(new Error("Timed out while waiting for provider tab to load."));
        return;
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          cleanup();
          resolve();
        }
      } catch {
        cleanup();
        reject(new Error("Provider tab closed before it could be used."));
      }
    }, 250);

    function cleanup() {
      clearInterval(interval);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendPayloadToProviderTab(tabId, payload) {
  const bridgeReady = await ensureProviderBridge(tabId);
  if (!bridgeReady) {
    return {
      ok: false,
      error:
        "Could not initialize provider bridge on that tab. Keep the provider tab open, then retry."
    };
  }

  const firstTry = await attemptProviderPayloadSend(tabId, payload, {
    maxAttempts: 36,
    delayMs: 220
  });
  if (firstTry?.ok || firstTry?.error) {
    return firstTry;
  }

  // One forced reload pass helps when provider scripts were stale.
  try {
    await chrome.tabs.reload(tabId);
    await waitForTabLoadComplete(tabId, 18000);
  } catch {
    // Continue to final failure handling.
  }

  const bridgeReadyAfterReload = await ensureProviderBridge(tabId);
  if (!bridgeReadyAfterReload) {
    return {
      ok: false,
      error:
        "Provider bridge failed after tab reload. Open the provider once, then retry from the source page."
    };
  }

  const secondTry = await attemptProviderPayloadSend(tabId, payload, {
    maxAttempts: 26,
    delayMs: 240
  });
  if (secondTry?.ok || secondTry?.error) {
    return secondTry;
  }

  return {
    ok: false,
    error: "Provider bridge did not respond in time. Reload the provider tab and retry."
  };
}

async function attemptProviderPayloadSend(tabId, payload, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 24);
  const delayMs = Math.max(120, Number(options.delayMs) || 200);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, payload);
      if (response?.ok) {
        return response;
      }
      if (response?.error) {
        return response;
      }
    } catch {
      // Content script may not be ready yet.
    }
    await delay(delayMs);
  }

  return { ok: false };
}

async function ensureProviderBridge(tabId) {
  if (await pingProviderBridge(tabId)) {
    return true;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: PROVIDER_BRIDGE_FILES
    });
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (await pingProviderBridge(tabId)) {
      return true;
    }
    await delay(180);
  }

  return false;
}

async function pingProviderBridge(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PROVIDER_BRIDGE_PING" });
    return response?.ok && response?.bridge === "ready";
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackStreamSession({
  requestId,
  providerId,
  sourceTabId,
  sourceWindowId,
  providerTabId,
  showProviderTab
}) {
  const reqId = String(requestId || "");
  if (!reqId || !["chatgpt", "gemini", "claude"].includes(providerId) || showProviderTab) {
    return;
  }

  clearStreamSession(reqId);

  const session = {
    requestId: reqId,
    providerId,
    sourceTabId: Number(sourceTabId),
    sourceWindowId: Number(sourceWindowId),
    providerTabId: Number(providerTabId),
    createdAt: Date.now(),
    lastEventAt: 0,
    phase: "created",
    rescueAttempts: 0,
    rescueTimer: null
  };

  STREAM_SESSIONS.set(reqId, session);
  scheduleStreamRescueCheck(reqId, 10000);
}

function updateStreamSessionFromEvent(message) {
  const reqId = String(message?.requestId || "");
  if (!reqId) return;

  const session = STREAM_SESSIONS.get(reqId);
  if (!session) return;

  session.lastEventAt = Date.now();
  session.phase = String(message?.phase || "update");

  if (session.phase === "done" || session.phase === "error") {
    clearStreamSession(reqId);
  }
}

function scheduleStreamRescueCheck(requestId, delayMs) {
  const session = STREAM_SESSIONS.get(requestId);
  if (!session) return;
  if (session.rescueTimer) {
    clearTimeout(session.rescueTimer);
  }
  session.rescueTimer = setTimeout(() => {
    runStreamRescueCheck(requestId).catch(() => {});
  }, Math.max(2000, Number(delayMs) || 10000));
}

async function runStreamRescueCheck(requestId) {
  const session = STREAM_SESSIONS.get(requestId);
  if (!session) return;

  if (session.phase === "done" || session.phase === "error") {
    clearStreamSession(requestId);
    return;
  }

  const now = Date.now();
  const baseTs = session.lastEventAt || session.createdAt;
  const staleMs = now - baseTs;

  if (staleMs < 9000) {
    scheduleStreamRescueCheck(requestId, 5000);
    return;
  }

  if (session.rescueAttempts >= 2) {
    clearStreamSession(requestId);
    return;
  }

  session.rescueAttempts += 1;
  await pulseProviderTabForRendering(session);
  scheduleStreamRescueCheck(requestId, 9000);
}

async function pulseProviderTabForRendering(session) {
  if (!session || !Number.isInteger(session.providerTabId)) {
    return;
  }

  let sourceTab = null;
  let providerTab = null;

  try {
    sourceTab = await chrome.tabs.get(session.sourceTabId);
  } catch {
    sourceTab = null;
  }

  try {
    providerTab = await chrome.tabs.get(session.providerTabId);
  } catch {
    clearStreamSession(session.requestId);
    return;
  }

  const sourceWindowId =
    sourceTab && sourceTab.windowId !== undefined ? sourceTab.windowId : session.sourceWindowId;

  try {
    await chrome.tabs.update(session.providerTabId, { active: true });
    if (providerTab.windowId !== undefined) {
      await chrome.windows.update(providerTab.windowId, { focused: true });
    }
  } catch {
    return;
  }

  try {
    await chrome.tabs.sendMessage(session.providerTabId, { type: "FORCE_SCROLL_LATEST" });
  } catch {
    // Bridge might be unavailable during navigation. Ignore.
  }

  await delay(650);

  if (!sourceTab?.id) {
    return;
  }

  try {
    await chrome.tabs.update(sourceTab.id, { active: true });
    if (sourceWindowId !== undefined && sourceWindowId !== null) {
      await chrome.windows.update(sourceWindowId, { focused: true });
    }
  } catch {
    // Source tab could be closed.
  }
}

function clearStreamSession(requestId) {
  const session = STREAM_SESSIONS.get(requestId);
  if (!session) return;
  if (session.rescueTimer) {
    clearTimeout(session.rescueTimer);
  }
  STREAM_SESSIONS.delete(requestId);
}

async function pullProviderResponse(message) {
  const requestId = String(message?.requestId || "");
  const providerId = normalizeProvider(message?.provider || DEFAULT_SETTINGS.defaultProvider);
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error("Unsupported provider for pull.");
  }

  let providerTabId = Number(message?.providerTabId);
  if (!Number.isInteger(providerTabId)) {
    const session = STREAM_SESSIONS.get(requestId);
    providerTabId = Number(session?.providerTabId);
  }

  if (!Number.isInteger(providerTabId)) {
    const matchingTabs = await chrome.tabs.query({ url: provider.urlPatterns });
    const bestTab = pickBestProviderTab(matchingTabs);
    providerTabId = Number(bestTab?.id);
  }

  if (!Number.isInteger(providerTabId)) {
    return {
      provider: providerId,
      text: "",
      html: ""
    };
  }

  const bridgeReady = await ensureProviderBridge(providerTabId);
  if (!bridgeReady) {
    return {
      provider: providerId,
      text: "",
      html: ""
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(providerTabId, {
      type: "READ_LATEST_RESPONSE",
      provider: providerId
    });
    if (response?.ok) {
      const text = String(response.text || "").trim();
      const html = String(response.html || "");
      return {
        provider: response.provider || providerId,
        text,
        html
      };
    }
  } catch {
    // Provider tab may be reloading. Fall through.
  }

  return {
    provider: providerId,
    text: "",
    html: ""
  };
}

async function forwardChatStreamEvent(message) {
  updateStreamSessionFromEvent(message);

  const sourceTabId = Number(message.sourceTabId);
  if (!Number.isInteger(sourceTabId)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(sourceTabId, {
      type: "CHAT_STREAM_EVENT",
      requestId: message.requestId || "",
      provider: message.provider || "chatgpt",
      phase: message.phase || "update",
      text: message.text || "",
      html: message.html || "",
      error: message.error || ""
    });
  } catch {
    // The source tab might be closed or not support content scripts.
  }
}

function isExpectedProviderHost(provider, tabUrl) {
  const host = extractHostname(tabUrl);
  if (!host) return false;
  return provider.hostnames.some((name) => host === name || host.endsWith(`.${name}`));
}

function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function sanitizeContext(rawContext) {
  return {
    title: sanitizeText(rawContext.title, 240),
    url: sanitizeText(rawContext.url, 500),
    selection: sanitizeMultilineText(rawContext.selection, 1200),
    summary: sanitizeMultilineText(rawContext.summary, 7600),
    extractionMethod: sanitizeText(rawContext.extractionMethod, 40),
    headings: Array.isArray(rawContext.headings)
      ? rawContext.headings.map((item) => sanitizeText(item, 140)).filter(Boolean).slice(0, 12)
      : [],
    rankedChunks: Array.isArray(rawContext.rankedChunks)
      ? rawContext.rankedChunks
          .map((item) => sanitizeText(item, 700))
          .filter(Boolean)
          .slice(0, 10)
      : [],
    fullPageText: sanitizeMultilineText(rawContext.fullPageText, 45000),
    mainContentPreview: sanitizeMultilineText(rawContext.mainContentPreview, 12000),
    formPrompts: Array.isArray(rawContext.formPrompts)
      ? rawContext.formPrompts
          .map((item) => sanitizeText(item, 260))
          .filter(Boolean)
          .slice(0, 6)
      : [],
    formFields: Array.isArray(rawContext.formFields)
      ? rawContext.formFields
          .map((field) => sanitizeFormField(field))
          .filter(Boolean)
          .slice(0, 16)
      : [],
    keyValuePairs: Array.isArray(rawContext.keyValuePairs)
      ? rawContext.keyValuePairs
          .map((pair) => sanitizeKeyValuePair(pair))
          .filter(Boolean)
          .slice(0, 18)
      : [],
    tableSummaries: Array.isArray(rawContext.tableSummaries)
      ? rawContext.tableSummaries
          .map((table) => sanitizeTableSummary(table))
          .filter(Boolean)
          .slice(0, 6)
      : [],
    readability: rawContext.readability
      ? {
          title: sanitizeText(rawContext.readability.title, 240),
          excerpt: sanitizeText(rawContext.readability.excerpt, 560),
          byline: sanitizeText(rawContext.readability.byline, 180),
          length: Number(rawContext.readability.length) || 0
        }
      : null
  };
}

function buildPrompt(context, question, options = {}) {
  const userQuestion = question || "Explain this role clearly from this website context.";
  const includeContextBundle =
    typeof options.includeContextBundle === "boolean" ? options.includeContextBundle : true;
  const includeFullContext = Boolean(options.includeFullContext);
  if (!includeContextBundle) {
    return [
      "--- FOLLOW-UP QUESTION ---",
      userQuestion,
      "",
      "Continue this provider chat thread and answer only this follow-up."
    ].join("\n");
  }
  const primaryContextText = context.fullPageText || context.mainContentPreview || context.summary;

  const headingLines = context.headings.map((heading, index) => `[H${String(index + 1).padStart(2, "0")}] ${heading}`);
  const formQuestionLines = context.formPrompts.map(
    (item, index) => `[FQ${String(index + 1).padStart(2, "0")}] ${item}`
  );
  const formFieldLines = context.formFields.map((field, index) => {
    const parts = [];
    if (field.label) parts.push(`label="${field.label}"`);
    if (field.name) parts.push(`name="${field.name}"`);
    if (field.type) parts.push(`type="${field.type}"`);
    if (field.required) parts.push("required");
    if (field.placeholder) parts.push(`placeholder="${field.placeholder}"`);
    if ((field.type === "checkbox" || field.type === "radio") && field.checked) {
      parts.push("checked=true");
    }
    if (field.options && field.options.length) {
      parts.push(`options="${field.options.join(" | ")}"`);
    }
    if (field.constraints) {
      parts.push(`constraints="${field.constraints}"`);
    }
    if (field.hint) {
      parts.push(`hint="${field.hint}"`);
    }
    parts.push(`value="${field.value || ""}"`);
    return `[FF${String(index + 1).padStart(2, "0")}] ${parts.join(" ")}`.trim();
  });
  const chunkLines = context.rankedChunks.map(
    (chunk, index) => `[CHUNK_${String(index + 1).padStart(2, "0")}] ${chunk}`
  );

  const maxPromptTokens = includeFullContext ? 7600 : 2400;
  const websiteBlock = [
    "--- WEBSITE ---",
    `"${context.title || "Unknown title"}"`,
    context.url ? `URL: ${context.url}` : "URL: unknown"
  ];
  const headingsBlock = headingLines.length
    ? ["--- HEADINGS ---", ...headingLines]
    : ["--- HEADINGS ---", "None"];
  const formBlock = formQuestionLines.length
    ? ["--- FORM QUESTIONS ---", ...formQuestionLines]
    : ["--- FORM QUESTIONS ---", "None"];
  const formFieldsBlock = formFieldLines.length
    ? ["--- FORM FIELDS ---", ...formFieldLines]
    : ["--- FORM FIELDS ---", "None"];
  const keyValueLines = context.keyValuePairs.map(
    (item, index) => `[KV${String(index + 1).padStart(2, "0")}] ${item.key}: ${item.value}`
  );
  const keyValueBlock = keyValueLines.length
    ? ["--- KEY-VALUE ---", ...keyValueLines]
    : ["--- KEY-VALUE ---", "None"];
  const tableBlocks = buildTableBlocks(context.tableSummaries);
  const tablesBlock = tableBlocks.length
    ? ["--- TABLES ---", ...tableBlocks]
    : ["--- TABLES ---", "None"];
  const userBlock = ["--- USER ASKED ---", userQuestion];

  const fixedTokens = estimateTokens(
    [
      ...websiteBlock,
      "",
      ...headingsBlock,
      "",
      ...formBlock,
      "",
      ...formFieldsBlock,
      "",
      ...keyValueBlock,
      "",
      ...tablesBlock,
      "",
      ...userBlock
    ].join("\n")
  );
  const remainingTokens = Math.max(420, maxPromptTokens - fixedTokens);
  const mainContentBudget = includeFullContext
    ? Math.max(2600, Math.floor(remainingTokens * 0.84))
    : Math.min(1300, Math.floor(remainingTokens * 0.6));
  const chunksBudget = includeFullContext
    ? Math.max(120, remainingTokens - mainContentBudget)
    : Math.max(220, remainingTokens - mainContentBudget);
  const contextHeading = includeFullContext ? "--- FULL SCRAPED CONTEXT ---" : "--- SCRAPED CONTEXT ---";
  const contextText = includeFullContext
    ? context.fullPageText || primaryContextText
    : primaryContextText;

  const mainContentBlock = [
    contextHeading,
    contextText ? fitTextFieldToTokens(contextText, mainContentBudget) : "No strong content extracted."
  ];
  const chunksBlock = ["--- CHUNKS ---", ...fitLinesToTokenBudget(chunkLines, chunksBudget)];
  if (chunksBlock.length === 1) chunksBlock.push("No ranked chunks extracted.");

  return [
    ...websiteBlock,
    "",
    ...headingsBlock,
    "",
    ...formBlock,
    "",
    ...formFieldsBlock,
    "",
    ...keyValueBlock,
    "",
    ...tablesBlock,
    "",
    ...mainContentBlock,
    "",
    ...chunksBlock,
    "",
    ...userBlock
  ].join("\n");
}

function sanitizeText(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function sanitizeFormField(field) {
  if (!field || typeof field !== "object") return null;
  return {
    label: sanitizeText(field.label, 160),
    name: sanitizeText(field.name, 80),
    type: sanitizeText(field.type, 40),
    group: sanitizeText(field.group, 140),
    required: Boolean(field.required),
    placeholder: sanitizeText(field.placeholder, 160),
    value: sanitizeText(field.value, 260),
    checked: Boolean(field.checked),
    options: Array.isArray(field.options)
      ? field.options.map((opt) => sanitizeText(opt, 120)).filter(Boolean).slice(0, 10)
      : [],
    constraints: sanitizeText(field.constraints, 140),
    hint: sanitizeText(field.hint, 220)
  };
}

function sanitizeKeyValuePair(pair) {
  if (!pair || typeof pair !== "object") return null;
  return {
    key: sanitizeText(pair.key, 140),
    value: sanitizeText(pair.value, 320)
  };
}

function sanitizeTableSummary(table) {
  if (!table || typeof table !== "object") return null;
  return {
    caption: sanitizeText(table.caption, 140),
    headers: Array.isArray(table.headers)
      ? table.headers.map((cell) => sanitizeText(cell, 120)).filter(Boolean).slice(0, 8)
      : [],
    rows: Array.isArray(table.rows)
      ? table.rows
          .map((row) =>
            Array.isArray(row)
              ? row.map((cell) => sanitizeText(cell, 120)).filter(Boolean).slice(0, 8)
              : []
          )
          .filter((row) => row.length > 0)
          .slice(0, 6)
      : []
  };
}

function buildTableBlocks(tables) {
  if (!Array.isArray(tables)) return [];
  const blocks = [];
  tables.forEach((table, index) => {
    const label = `[TB${String(index + 1).padStart(2, "0")}] ${table.caption || "Table"}`;
    blocks.push(label);
    if (table.headers.length) {
      blocks.push(`| ${table.headers.map(escapeTableCell).join(" | ")} |`);
      blocks.push(`| ${table.headers.map(() => "---").join(" | ")} |`);
    }
    for (const row of table.rows) {
      blocks.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
    }
    blocks.push("");
  });
  return blocks.filter(Boolean);
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "¦").replace(/\r?\n/g, " ").trim();
}

function sanitizeMultilineText(value, maxLength) {
  const lines = String(value || "")
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const joined = lines.join("\n");
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}...` : joined;
}

function estimateTokens(value) {
  return Math.ceil(String(value || "").length / 4);
}

function fitLinesToTokenBudget(lines, maxTokens) {
  const fitted = [];
  let usedTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (fitted.length > 0 && usedTokens + lineTokens > maxTokens) {
      continue;
    }
    fitted.push(line);
    usedTokens += lineTokens;
  }

  return fitted;
}

function fitTextFieldToTokens(text, maxTokens) {
  const value = String(text || "").trim();
  if (!value) return "";

  if (estimateTokens(value) <= maxTokens) {
    return value;
  }

  const maxChars = Math.max(120, maxTokens * 4 - 3);
  return `${value.slice(0, maxChars)}...`;
}
