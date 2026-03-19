// Shared DOM and timing utilities.
(function registerT2CProviderBridgeUtils() {
  const bridge = (window.__T2C_PROVIDER_BRIDGE__ = window.__T2C_PROVIDER_BRIDGE__ || {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function isElementDisabled(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.getAttribute("aria-disabled") === "true") return true;
    if ("disabled" in element && element.disabled) return true;
    return false;
  }

  function isElementClickable(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isElementDisabled(element)) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    if (style.pointerEvents === "none") {
      return false;
    }
    if (Number(style.opacity || 1) < 0.05) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) {
      return false;
    }

    return true;
  }

  async function findFirst(selectors) {
    for (const selector of selectors || []) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      } catch {
        // Ignore invalid selector for this provider variant.
      }
    }
    return null;
  }

  async function findFirstMatching(selectors, predicate) {
    for (const selector of selectors || []) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (predicate(element)) {
            return element;
          }
        }
      } catch {
        // Ignore invalid selector for this provider variant.
      }
    }
    return null;
  }

  async function waitForElement(selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = await findFirst(selectors);
      if (match) return match;
      await sleep(150);
    }
    return null;
  }

  async function waitForClickableElement(selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = await findFirstMatching(selectors, (element) => isElementClickable(element));
      if (match) return match;
      await sleep(100);
    }
    return null;
  }

  function isScrollableElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY || "";
    const isScrollableOverflow =
      overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay");
    if (!isScrollableOverflow) return false;
    return element.scrollHeight - element.clientHeight > 40;
  }

  bridge.sleep = sleep;
  bridge.normalizeWhitespace = normalizeWhitespace;
  bridge.isElementDisabled = isElementDisabled;
  bridge.isElementClickable = isElementClickable;
  bridge.findFirst = findFirst;
  bridge.findFirstMatching = findFirstMatching;
  bridge.waitForElement = waitForElement;
  bridge.waitForClickableElement = waitForClickableElement;
  bridge.isScrollableElement = isScrollableElement;
})();
