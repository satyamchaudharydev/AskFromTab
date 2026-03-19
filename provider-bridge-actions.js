// Provider payload injection, send triggering, and image attachment.
(function registerT2CProviderBridgeActions() {
  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

async function injectPayload(message) {
  const providerId = bridge.detectProvider(message.provider);
  const config = bridge.PROVIDER_CONFIG[providerId];
  if (!config) {
    throw new Error("Provider bridge could not detect provider on this tab.");
  }

  const prompt = String(message.prompt || "").trim();
  if (!prompt) {
    throw new Error("Prompt is empty.");
  }

  const input = await bridge.waitForElement(config.inputSelectors, 12000);
  if (!input) {
    throw new Error(`Could not find input box for ${providerId}.`);
  }

  if (providerId === "chatgpt") {
    try {
      await applyChatGPTModePreference(message.chatgptResponseMode || "instant", input);
    } catch {
      // Mode switching is best-effort; do not block prompt send.
    }
  }

  fillPromptInput(input, prompt);

  if (message.imageDataUrl) {
    await attachImage(config, message.imageDataUrl);
  }

  if (message.autoSend) {
    await submitPrompt({
      providerId,
      config,
      input
    });
  }

  if (message.requestId && typeof message.sourceTabId !== "undefined") {
    bridge.startStream({
      providerId,
      requestId: message.requestId,
      sourceTabId: message.sourceTabId
    });
  }

  return { provider: providerId };
}

function fillPromptInput(input, value) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setInputLikeValue(input, value);
    return;
  }

  if (input.isContentEditable) {
    setContentEditableValue(input, value);
    return;
  }

  throw new Error("Unsupported input element type.");
}

function setInputLikeValue(input, value) {
  input.focus();

  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = descriptor?.set;

  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setContentEditableValue(input, value) {
  input.focus();

  const range = document.createRange();
  range.selectNodeContents(input);
  range.deleteContents();

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  // Fallback to native text insertion when available.
  const insertedByCommand = document.execCommand
    ? document.execCommand("insertText", false, value)
    : false;

  if (!insertedByCommand) {
    input.textContent = value;
  }

  input.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      inputType: "insertText",
      data: value
    })
  );
  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    })
  );
}

async function applyChatGPTModePreference(mode, input) {
  const targetMode = bridge.normalizeChatGPTResponseMode(mode);
  const scope = getChatGPTComposerScope(input);
  if (!scope) return false;

  if (isChatGPTModeActive(scope, targetMode)) {
    return true;
  }

  if (clickChatGPTModeOption(scope, targetMode)) {
    await bridge.sleep(120);
    return true;
  }

  const toggles = findChatGPTModeToggleButtons(scope);
  for (const toggle of toggles) {
    if (!bridge.isElementClickable(toggle)) continue;
    toggle.click();
    await bridge.sleep(140);
    if (clickChatGPTModeOption(document, targetMode)) {
      await bridge.sleep(140);
      return true;
    }
  }

  return false;
}

function getChatGPTComposerScope(input) {
  if (input instanceof HTMLElement) {
    const byForm = input.closest("form");
    if (byForm) return byForm;
    const byComposer = input.closest('[class*="composer"]');
    if (byComposer) return byComposer;
  }
  return (
    document.querySelector('form[class*="composer"]') ||
    document.querySelector("main") ||
    document.body
  );
}

function isChatGPTModeActive(scope, mode) {
  if (!(scope instanceof Element || scope instanceof Document)) return false;
  const activeCandidates = scope.querySelectorAll(
    'button[aria-pressed="true"], [role="option"][aria-selected="true"], [aria-current="true"], [data-state="active"], [data-active="true"]'
  );
  for (const node of activeCandidates) {
    if (!(node instanceof HTMLElement)) continue;
    const text = extractModeDescriptor(node);
    if (matchesChatGPTModeText(text, mode)) {
      return true;
    }
  }
  return false;
}

function clickChatGPTModeOption(scope, mode) {
  if (!(scope instanceof Element || scope instanceof Document)) return false;

  const preferredSelectors =
    mode === "thinking"
      ? [
          'button[aria-label*="thinking" i]',
          'button[aria-label*="reason" i]',
          '[role="option"][aria-label*="thinking" i]',
          '[role="option"][aria-label*="reason" i]',
          '[role="menuitem"][aria-label*="thinking" i]',
          '[role="menuitem"][aria-label*="reason" i]',
          '[data-testid*="thinking"]',
          '[data-testid*="reasoning"]'
        ]
      : [
          'button[aria-label*="instant" i]',
          'button[aria-label*="fast" i]',
          'button[aria-label*="quick" i]',
          'button[aria-label*="standard" i]',
          '[role="option"][aria-label*="instant" i]',
          '[role="option"][aria-label*="fast" i]',
          '[role="menuitem"][aria-label*="instant" i]',
          '[role="menuitem"][aria-label*="fast" i]',
          '[data-testid*="instant"]',
          '[data-testid*="fast"]'
        ];

  for (const selector of preferredSelectors) {
    let elements = [];
    try {
      elements = Array.from(scope.querySelectorAll(selector));
    } catch {
      elements = [];
    }
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!bridge.isElementClickable(element)) continue;
      const text = extractModeDescriptor(element);
      if (matchesChatGPTModeText(text, mode)) {
        element.click();
        return true;
      }
    }
  }

  const generic = scope.querySelectorAll(
    'button, [role="button"], [role="option"], [role="menuitem"], li[role="option"]'
  );
  for (const element of generic) {
    if (!(element instanceof HTMLElement)) continue;
    if (!bridge.isElementClickable(element)) continue;
    const text = extractModeDescriptor(element);
    if (!text || isModeControlNoise(text)) continue;
    if (!matchesChatGPTModeText(text, mode)) continue;
    element.click();
    return true;
  }

  return false;
}

function findChatGPTModeToggleButtons(scope) {
  if (!(scope instanceof Element || scope instanceof Document)) return [];
  const selectors = [
    'button[aria-haspopup="menu"][aria-label*="mode" i]',
    'button[aria-haspopup="menu"][aria-label*="reason" i]',
    'button[aria-haspopup="menu"][aria-label*="think" i]',
    'button[data-testid*="mode"]',
    'button[data-testid*="reason"]',
    'button[data-testid*="thinking"]'
  ];
  const nodes = [];
  const seen = new Set();
  for (const selector of selectors) {
    let elements = [];
    try {
      elements = Array.from(scope.querySelectorAll(selector));
    } catch {
      elements = [];
    }
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (seen.has(element)) continue;
      seen.add(element);
      nodes.push(element);
    }
  }

  const fuzzyButtons = scope.querySelectorAll('button, [role="button"]');
  for (const element of fuzzyButtons) {
    if (!(element instanceof HTMLElement)) continue;
    if (seen.has(element)) continue;
    const text = extractModeDescriptor(element);
    if (!text || isModeControlNoise(text)) continue;
    if (!/mode|thinking|reasoning|instant|fast|quick|standard/i.test(text)) continue;
    seen.add(element);
    nodes.push(element);
  }

  return nodes;
}

function extractModeDescriptor(element) {
  if (!(element instanceof HTMLElement)) return "";
  return bridge.normalizeWhitespace(
    [
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.getAttribute("data-testid") || "",
      element.innerText || element.textContent || ""
    ]
      .join(" ")
      .slice(0, 260)
  ).toLowerCase();
}

function matchesChatGPTModeText(text, mode) {
  const value = String(text || "").toLowerCase();
  if (!value) return false;
  if (mode === "thinking") {
    return /thinking|reason|reasoning|deep|extended|deliberate|high effort|longer/i.test(value);
  }
  return /instant|fast|quick|standard|default|auto|low effort/i.test(value);
}

function isModeControlNoise(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return true;
  return /send|attach|upload|stop|new chat|voice|search|copy|edit|share|regenerate|retry/i.test(
    value
  );
}

async function submitPrompt({ providerId, config, input }) {
  await bridge.sleep(550);

  let method = "";
  const sendButton = await bridge.waitForClickableElement(
    config.sendSelectors,
    providerId === "chatgpt" ? 9000 : 6000
  );
  if (sendButton) {
    sendButton.click();
    method = "button";
  }

  if (!method && providerId === "chatgpt") {
    const form = await bridge.waitForElement(config.formSelectors || [], 1200);
    if (form) {
      requestSubmitForm(form);
      method = "form";
    }
  }

  if (!method) {
    triggerEnterSubmit(input);
    method = "enter";
  }

  let started = await waitForSendKickoff({
    providerId,
    config,
    input,
    timeoutMs: providerId === "chatgpt" ? 12000 : 5200
  });

  if (!started && providerId === "chatgpt") {
    const form = await bridge.waitForElement(config.formSelectors || [], 800);
    if (form && method !== "form") {
      requestSubmitForm(form);
    }
    if (method !== "enter") {
      triggerEnterSubmit(input);
    }
    started = await waitForSendKickoff({
      providerId,
      config,
      input,
      timeoutMs: 7000
    });
  }

  // Background tabs can delay DOM state changes; avoid hard-failing after submit attempts.
}

function triggerEnterSubmit(input) {
  if (!(input instanceof HTMLElement)) return;
  input.focus();

  const eventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  };
  input.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  input.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  input.dispatchEvent(new KeyboardEvent("keyup", eventInit));
}

function requestSubmitForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  try {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return;
    }
    form.dispatchEvent(
      new Event("submit", {
        bubbles: true,
        cancelable: true
      })
    );
  } catch {
    // Keep fallback flow running.
  }
}

async function waitForSendKickoff({ providerId, config, input, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (bridge.isGenerating(providerId)) {
      return true;
    }

    const sendButton = await bridge.findFirst(config.sendSelectors);
    if (sendButton && bridge.isElementDisabled(sendButton)) {
      return true;
    }

    const currentInputValue = readInputValue(input);
    if (!currentInputValue) {
      return true;
    }

    await bridge.sleep(120);
  }
  return false;
}

function readInputValue(input) {
  if (!input) return "";
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return bridge.normalizeWhitespace(input.value || "");
  }
  if (input instanceof HTMLElement && input.isContentEditable) {
    return bridge.normalizeWhitespace(input.innerText || input.textContent || "");
  }
  return "";
}

async function attachImage(config, imageDataUrl) {
  let fileInput = await bridge.findFirst(config.fileInputSelectors);

  if (!fileInput) {
    const attachButton = await bridge.findFirst(config.attachButtonSelectors);
    if (attachButton) {
      attachButton.click();
      await bridge.sleep(300);
      fileInput = await bridge.waitForElement(config.fileInputSelectors, 6000);
    }
  }

  if (!fileInput) {
    throw new Error("Could not find image upload input in provider UI.");
  }

  const file = await dataUrlToFile(imageDataUrl, "page-context.png");
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await bridge.sleep(900);
}

async function dataUrlToFile(dataUrl, filename) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || "image/png",
    lastModified: Date.now()
  });
}

  bridge.injectPayload = injectPayload;
})();
