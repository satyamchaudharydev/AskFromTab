// Provider response scraping and generation detection.
(function registerT2CProviderBridgeScrape() {
  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

function readLatestAssistantSnapshot() {
  const candidates = collectAssistantCandidates();
  if (!candidates.length) {
    return { text: "", html: "", fingerprint: "" };
  }

  const last = candidates[candidates.length - 1];
  const snapshot = extractNodeSnapshot(last);
  const text = snapshot.text;
  const html = snapshot.html;
  const fingerprint = buildAssistantFingerprint(last, text);
  return { text, html, fingerprint };
}

function readLatestGeminiSnapshot() {
  const candidates = collectGeminiResponseCandidates();
  if (!candidates.length) {
    return { text: "", html: "", fingerprint: "" };
  }

  const last = candidates[candidates.length - 1];
  const snapshot = extractNodeSnapshot(last);
  const text = snapshot.text;
  const html = snapshot.html;
  const fingerprint = buildAssistantFingerprint(last, text);
  return { text, html, fingerprint };
}

function readLatestClaudeSnapshot() {
  const candidates = collectClaudeResponseCandidates();
  if (!candidates.length) {
    return { text: "", html: "", fingerprint: "" };
  }

  const last = candidates[candidates.length - 1];
  const snapshot = extractNodeSnapshot(last);
  const text = snapshot.text;
  const html = snapshot.html;
  const fingerprint = buildAssistantFingerprint(last, text);
  return { text, html, fingerprint };
}

function collectAssistantCandidates() {
  const nodes = [];
  const seen = new Set();

  const directAssistant = document.querySelectorAll('[data-message-author-role="assistant"]');
  for (const node of directAssistant) {
    pushCandidate(node);
  }

  const turns = document.querySelectorAll('[data-testid^="conversation-turn-"]');
  for (const turn of turns) {
    if (!(turn instanceof HTMLElement)) continue;
    if (turn.getAttribute("data-message-author-role") === "assistant") {
      pushCandidate(turn);
      continue;
    }

    const nestedAssistant = turn.querySelector('[data-message-author-role="assistant"]');
    if (nestedAssistant) {
      pushCandidate(nestedAssistant);
      continue;
    }

    if (!turn.querySelector('[data-message-author-role="user"]')) {
      pushCandidate(turn);
    }
  }

  const assistantArticles = document.querySelectorAll(
    'article[data-author-role=\"assistant\"], article[aria-label*=\"assistant\" i]'
  );
  for (const node of assistantArticles) {
    pushCandidate(node);
  }

  return nodes;

  function pushCandidate(node) {
    if (!(node instanceof HTMLElement)) return;
    if (seen.has(node)) return;
    const text = extractNodeText(node);
    if (!text) return;
    seen.add(node);
    nodes.push(node);
  }
}

function collectGeminiResponseCandidates() {
  const root = document.querySelector("main") || document.body;
  if (!root) return [];

  const nodes = [];
  const seenNode = new Set();
  const seenText = new Set();

  const selectors = [
    'div[id^="model-response-message-contentr_"]',
    'message-content[id^="message-content-id-r_"]',
    "structured-content-container.model-response-text",
    "structured-content-container.processing-state-visible",
    "div.response-content",
    "div.markdown.markdown-main-panel",
    "model-response",
    "chat-response",
    "message-content",
    '[data-message-content]',
    '[class*="model-response"]',
    '[class*="response-content"]',
    'main [class*="markdown"]'
  ];

  for (const selector of selectors) {
    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll(selector));
    } catch {
      elements = [];
    }
    for (const node of elements) {
      pushCandidate(node);
    }
  }

  nodes.sort(compareByDomOrder);

  return nodes;

  function pushCandidate(node) {
    if (!(node instanceof HTMLElement)) return;
    if (seenNode.has(node)) return;
    if (isInsideGeminiComposer(node)) return;
    if (isLikelyGeminiUserNode(node)) return;

    const text = extractNodeText(node);
    if (!text || text.length < 24) return;
    if (isGeminiNoiseText(text)) return;

    const textKey = `${text.length}|${text.slice(-220).toLowerCase()}`;
    if (seenText.has(textKey)) return;

    seenNode.add(node);
    seenText.add(textKey);
    nodes.push(node);
  }
}

function collectClaudeResponseCandidates() {
  const root = document.querySelector("main") || document.body;
  if (!root) return [];

  const nodes = [];
  const seenNode = new Set();
  const seenText = new Set();

  const selectors = [
    '[data-testid="assistant-turn"]',
    '[data-testid*="assistant"][data-testid*="turn"]',
    '[data-testid*="assistant_message"]',
    '[data-testid*="assistant"][class*="message"]',
    'article[aria-label*="assistant" i]',
    '[data-message-author="assistant"]',
    '[data-author="assistant"]',
    '[data-role="assistant"]',
    'main [class*="assistant"] [class*="prose"]',
    'main [class*="prose"]',
    'main [class*="markdown"]'
  ];

  for (const selector of selectors) {
    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll(selector));
    } catch {
      elements = [];
    }
    for (const node of elements) {
      pushCandidate(node);
    }
  }

  nodes.sort(compareByDomOrder);
  return nodes;

  function pushCandidate(node) {
    if (!(node instanceof HTMLElement)) return;
    if (seenNode.has(node)) return;
    if (isInsideClaudeComposer(node)) return;
    if (isLikelyClaudeUserNode(node)) return;

    const text = extractNodeText(node);
    if (!text || text.length < 24) return;
    if (isClaudeNoiseText(text)) return;

    const textKey = `${text.length}|${text.slice(-220).toLowerCase()}`;
    if (seenText.has(textKey)) return;

    seenNode.add(node);
    seenText.add(textKey);
    nodes.push(node);
  }
}

function compareByDomOrder(a, b) {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function isInsideGeminiComposer(node) {
  if (!(node instanceof HTMLElement)) return false;
  return Boolean(
    node.closest('div.ql-editor') ||
      node.closest('[contenteditable="true"][aria-label*="prompt" i]') ||
      node.closest('[contenteditable="true"][aria-label*="message" i]') ||
      node.closest('textarea[aria-label*="prompt" i]') ||
      node.closest('footer')
  );
}

function isLikelyGeminiUserNode(node) {
  if (!(node instanceof HTMLElement)) return false;
  const marker = [
    node.getAttribute("data-message-author"),
    node.getAttribute("data-author"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.className || ""
  ]
    .join(" ")
    .toLowerCase();
  if (marker.includes("user")) return true;
  if (node.closest("user-query")) return true;
  if (node.closest('[class*="user-query"]')) return true;
  return false;
}

function isGeminiNoiseText(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return true;
  const noise = [
    "gemini can make mistakes",
    "double-check",
    "help",
    "privacy",
    "terms",
    "new chat"
  ];
  if (normalized.length < 30) return true;
  return noise.some((part) => normalized === part || normalized.startsWith(part));
}

function isInsideClaudeComposer(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return Boolean(
    node.closest('[contenteditable="true"]') ||
      node.closest("div.ProseMirror") ||
      node.closest('textarea[placeholder*="Claude" i]') ||
      node.closest('[data-testid*="composer"]') ||
      node.closest('[class*="composer"]') ||
      node.closest("footer")
  );
}

function isLikelyClaudeUserNode(node) {
  if (!(node instanceof HTMLElement)) return false;
  const marker = [
    node.getAttribute("data-message-author"),
    node.getAttribute("data-author"),
    node.getAttribute("data-role"),
    node.getAttribute("data-testid"),
    node.getAttribute("aria-label"),
    node.className || ""
  ]
    .join(" ")
    .toLowerCase();
  if (marker.includes("user") || marker.includes("human")) return true;
  if (node.closest('[data-testid*="user"]')) return true;
  if (node.closest('[class*="user"]')) return true;
  return false;
}

function isClaudeNoiseText(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return true;
  const noise = [
    "claude can make mistakes",
    "new chat",
    "privacy",
    "terms",
    "help",
    "retry",
    "stop generating"
  ];
  if (normalized.length < 30) return true;
  return noise.some((part) => normalized === part || normalized.startsWith(part));
}

function forceChatGPTToLatest() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (!(host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com" || host.endsWith(".chat.openai.com"))) {
    return;
  }

  const root = document.querySelector("main") || document.body;
  if (!root) return;

  const jumpSelectors = [
    'button[data-testid*="jump-to-bottom"]',
    'button[data-testid*="scroll-to-bottom"]',
    'button[aria-label*="bottom" i]',
    'button[title*="bottom" i]'
  ];
  for (const selector of jumpSelectors) {
    const buttons = root.querySelectorAll(selector);
    for (const button of buttons) {
      if (bridge.isElementClickable(button)) {
        button.click();
      }
    }
  }

  const scrollCandidates = [];
  const scrollSelectors = [
    '[data-testid*="conversation"]',
    '[class*="conversation"]',
    '[class*="thread"]',
    '[class*="messages"]',
    '[class*="overflow-y-auto"]'
  ];
  for (const selector of scrollSelectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!bridge.isScrollableElement(element)) continue;
      scrollCandidates.push(element);
    }
  }

  const unique = Array.from(new Set(scrollCandidates)).slice(0, 12);
  for (const element of unique) {
    element.scrollTop = element.scrollHeight;
  }

  const docScroller =
    document.scrollingElement ||
    document.documentElement ||
    document.body;
  if (docScroller) {
    docScroller.scrollTop = docScroller.scrollHeight;
  }
}

function forceGeminiToLatest() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (!(host === "gemini.google.com" || host.endsWith(".gemini.google.com"))) {
    return;
  }

  const root = document.querySelector("main") || document.body;
  if (!root) return;

  const jumpSelectors = [
    'button[aria-label*="latest" i]',
    'button[aria-label*="bottom" i]',
    'button[mattooltip*="latest" i]',
    'button[mattooltip*="bottom" i]'
  ];
  for (const selector of jumpSelectors) {
    const buttons = root.querySelectorAll(selector);
    for (const button of buttons) {
      if (bridge.isElementClickable(button)) {
        button.click();
      }
    }
  }

  const scrollCandidates = [];
  const scrollSelectors = [
    '[class*="conversation"]',
    '[class*="chat"]',
    '[class*="thread"]',
    '[class*="messages"]',
    '[class*="scroll"]',
    "main"
  ];
  for (const selector of scrollSelectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!bridge.isScrollableElement(element)) continue;
      scrollCandidates.push(element);
    }
  }

  const unique = Array.from(new Set(scrollCandidates)).slice(0, 16);
  for (const element of unique) {
    element.scrollTop = element.scrollHeight;
  }

  const docScroller =
    document.scrollingElement ||
    document.documentElement ||
    document.body;
  if (docScroller) {
    docScroller.scrollTop = docScroller.scrollHeight;
  }
}

function forceClaudeToLatest() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (!(host === "claude.ai" || host.endsWith(".claude.ai"))) {
    return;
  }

  const root = document.querySelector("main") || document.body;
  if (!root) return;

  const jumpSelectors = [
    'button[aria-label*="latest" i]',
    'button[aria-label*="bottom" i]',
    'button[data-testid*="jump"]',
    'button[data-testid*="bottom"]'
  ];
  for (const selector of jumpSelectors) {
    const buttons = root.querySelectorAll(selector);
    for (const button of buttons) {
      if (bridge.isElementClickable(button)) {
        button.click();
      }
    }
  }

  const scrollCandidates = [];
  const scrollSelectors = [
    '[data-testid*="conversation"]',
    '[data-testid*="chat"]',
    '[class*="conversation"]',
    '[class*="thread"]',
    '[class*="messages"]',
    '[class*="scroll"]',
    "main"
  ];
  for (const selector of scrollSelectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!bridge.isScrollableElement(element)) continue;
      scrollCandidates.push(element);
    }
  }

  const unique = Array.from(new Set(scrollCandidates)).slice(0, 16);
  for (const element of unique) {
    element.scrollTop = element.scrollHeight;
  }

  const docScroller =
    document.scrollingElement ||
    document.documentElement ||
    document.body;
  if (docScroller) {
    docScroller.scrollTop = docScroller.scrollHeight;
  }
}

function extractNodeSnapshot(node) {
  if (!(node instanceof HTMLElement)) return { text: "", html: "" };
  const focusedContent = node.querySelector(
    'div[id^=\"model-response-message-contentr_\"], message-content[id^=\"message-content-id-r_\"], structured-content-container.model-response-text, div.response-content, [data-message-content], [data-testid*=\"message-content\"], .markdown, [class*=\"prose\"], [class*=\"whitespace-pre-wrap\"]'
  );
  const source = focusedContent instanceof HTMLElement ? focusedContent : node;
  const rawText = source.innerText || source.textContent || "";
  const text = bridge.normalizeWhitespace(rawText);
  const html = normalizeHtml(source.innerHTML || "");
  return { text, html };
}

function extractNodeText(node) {
  return extractNodeSnapshot(node).text || "";
}

function normalizeHtml(value) {
  return String(value || "").trim();
}

function buildAssistantFingerprint(node, text) {
  const id =
    node.getAttribute("data-message-id") ||
    node.getAttribute("data-testid") ||
    node.id ||
    "";
  const tail = text.slice(-120);
  return `${id}|${text.length}|${tail}`;
}

function isChatGPTGenerating() {
  return Boolean(
    document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[data-testid*="stop"]') ||
      document.querySelector('button[aria-label*="Stop generating"]') ||
      document.querySelector('[data-testid*="result-streaming"]') ||
      document.querySelector('[data-status="streaming"]') ||
      document.querySelector('[class*="result-streaming"]')
  );
}

function isGeminiGenerating() {
  return Boolean(
    document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="Stop generating"]') ||
      document.querySelector('button[mattooltip*="Stop"]') ||
      document.querySelector("structured-content-container.processing-state-visible") ||
      document.querySelector('[class*="processing-state-visible"]') ||
      document.querySelector('[aria-busy="true"]') ||
      document.querySelector('[class*="loading"][class*="response"]')
  );
}

function isClaudeGenerating() {
  return Boolean(
    document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="Stop generating"]') ||
      document.querySelector('button[data-testid*="stop"]') ||
      document.querySelector('[data-state="streaming"]') ||
      document.querySelector('[aria-busy="true"]') ||
      document.querySelector('[class*="streaming"]') ||
      document.querySelector('[class*="generating"]')
  );
}

  function readLatestSnapshot(providerId) {
    if (providerId === "gemini") return readLatestGeminiSnapshot();
    if (providerId === "claude") return readLatestClaudeSnapshot();
    return readLatestAssistantSnapshot();
  }

  function forceToLatest(providerId) {
    if (providerId === "gemini") {
      forceGeminiToLatest();
      return;
    }
    if (providerId === "claude") {
      forceClaudeToLatest();
      return;
    }
    forceChatGPTToLatest();
  }

  function isGenerating(providerId) {
    if (providerId === "gemini") return isGeminiGenerating();
    if (providerId === "claude") return isClaudeGenerating();
    return isChatGPTGenerating();
  }

  bridge.readLatestSnapshot = readLatestSnapshot;
  bridge.forceToLatest = forceToLatest;
  bridge.isGenerating = isGenerating;
})();
