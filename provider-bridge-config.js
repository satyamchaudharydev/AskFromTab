// Provider config and detection helpers.
(function registerT2CProviderBridgeConfig() {
  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

const PROVIDER_CONFIG = {
  chatgpt: {
    hosts: ["chatgpt.com", "chat.openai.com"],
    inputSelectors: [
      "#prompt-textarea",
      'textarea[data-testid*="prompt"]',
      'textarea[placeholder*="Message"]',
      '[contenteditable="true"][role="textbox"]'
    ],
    formSelectors: [
      'form[class~="group/composer"]',
      'form[class*="group/composer"]',
      'form[class*="composer"]',
      'form[data-testid*="composer"]'
    ],
    sendSelectors: [
      "button.composer-submit-button",
      'form[class~="group/composer"] button[type="submit"]',
      'form[class*="group/composer"] button[type="submit"]',
      'form[class*="composer"] button[type="submit"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]'
    ],
    fileInputSelectors: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    attachButtonSelectors: ['button[aria-label*="Attach"]', 'button[aria-label*="Upload"]']
  },
  gemini: {
    hosts: ["gemini.google.com"],
    inputSelectors: [
      'div.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][aria-label*="prompt"]',
      '[contenteditable="true"][aria-label*="message"]',
      'textarea[aria-label*="prompt"]'
    ],
    sendSelectors: [
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'button[mattooltip*="Send"]'
    ],
    fileInputSelectors: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    attachButtonSelectors: ['button[aria-label*="Upload"]', 'button[aria-label*="Attach"]']
  },
  claude: {
    hosts: ["claude.ai"],
    inputSelectors: [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      '[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Claude"]'
    ],
    sendSelectors: [
      'button[aria-label*="Send"]',
      'button[data-testid*="send"]',
      'button[aria-label*="send"]'
    ],
    fileInputSelectors: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    attachButtonSelectors: ['button[aria-label*="Attach"]', 'button[aria-label*="Upload"]']
  }
};

  function detectProvider(requestedProvider) {
    if (requestedProvider && bridge.PROVIDER_CONFIG[requestedProvider]) {
      return requestedProvider;
    }

    const host = window.location.hostname.toLowerCase();
    for (const [providerId, config] of Object.entries(bridge.PROVIDER_CONFIG)) {
      if (config.hosts.some((item) => host === item || host.endsWith(`.${item}`))) {
        return providerId;
      }
    }
    return null;
  }

  function normalizeChatGPTResponseMode(value) {
    return String(value || "").toLowerCase() === "thinking" ? "thinking" : "instant";
  }

  bridge.PROVIDER_CONFIG = PROVIDER_CONFIG;
  bridge.detectProvider = detectProvider;
  bridge.normalizeChatGPTResponseMode = normalizeChatGPTResponseMode;
})();
