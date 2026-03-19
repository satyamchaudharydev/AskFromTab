// Shared rendering/sanitization helpers for the in-page dock.
(function registerT2CDockRenderer() {
  const ns = (window.__T2C_DOCK__ = window.__T2C_DOCK__ || {});

function renderAssistantHtml(container, safeHtml, fallbackText) {
  const html = String(safeHtml || "").trim();
  if (!html) {
    renderAssistantMarkdown(container, fallbackText);
    return;
  }
  container.innerHTML = `<div class="t2c-md-root">${html}</div>`;
}

function renderAssistantMarkdown(container, text) {
  const value = String(text || "");
  if (!value) {
    container.textContent = "...";
    return;
  }

  if (isStreamingPlaceholder(value)) {
    container.textContent = value;
    return;
  }

  const html = markdownToHtml(value);
  if (!html) {
    container.textContent = value;
    return;
  }
  container.innerHTML = `<div class="t2c-md-root">${html}</div>`;
}

function isStreamingPlaceholder(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "..." ||
    normalized === "thinking..." ||
    normalized === "streaming..." ||
    normalized === "generating response..."
  );
}

function markdownToHtml(input) {
  const src = String(input || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!src) return "";

  const codeBlocks = [];
  const lines = src
    .replace(/```([^\n`]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const token = `@@T2C_CODE_${codeBlocks.length}@@`;
      const language = escapeHtml(String(lang || "").trim());
      const safeCode = escapeHtml(String(code || "").replace(/\n+$/g, ""));
      codeBlocks.push(
        `<pre><code class="lang-${language || "plain"}">${safeCode}</code></pre>`
      );
      return `\n${token}\n`;
    })
    .split("\n");

  const html = [];
  const paragraph = [];
  let listType = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };

  const closeList = () => {
    if (!listType) return;
    html.push(listType === "ul" ? "</ul>" : "</ol>");
    listType = "";
  };

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const codeMatch = trimmed.match(/^@@T2C_CODE_(\d+)@@$/);
    if (codeMatch) {
      flushParagraph();
      closeList();
      const idx = Number(codeMatch[1]);
      html.push(codeBlocks[idx] || "");
      continue;
    }

    const hrMatch = trimmed.match(/^([-*_])\1{2,}$/);
    if (hrMatch) {
      flushParagraph();
      closeList();
      html.push("<hr />");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = Math.min(6, headingMatch[1].length);
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return html.join("");
}

function renderInlineMarkdown(input) {
  const inlineCodes = [];
  const inlineLinks = [];
  let text = String(input || "").replace(/`([^`\n]+)`/g, (match, code) => {
    const token = `@@T2C_INLINE_${inlineCodes.length}@@`;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text);

  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (match, label, rawUrl) => {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return `${label} (${rawUrl})`;
    const token = `@@T2C_LINK_${inlineLinks.length}@@`;
    inlineLinks.push(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    return token;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  text = text.replace(/@@T2C_INLINE_(\d+)@@/g, (match, idx) => inlineCodes[Number(idx)] || "");
  text = text.replace(/@@T2C_LINK_(\d+)@@/g, (match, idx) => inlineLinks[Number(idx)] || "");
  return text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""), window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractTextFromHtml(rawHtml) {
  const value = String(rawHtml || "").trim();
  if (!value) return "";
  const host = document.createElement("div");
  host.innerHTML = value;
  return String(host.textContent || "").replace(/\s+/g, " ").trim();
}

function sanitizeProviderHtml(rawHtml) {
  const value = String(rawHtml || "").trim();
  if (!value) return "";

  const template = document.createElement("template");
  template.innerHTML = value;

  const output = document.createElement("div");
  const children = Array.from(template.content.childNodes);
  for (const child of children) {
    const safe = sanitizeProviderNode(child);
    if (safe) {
      output.appendChild(safe);
    }
  }
  return output.innerHTML.trim();
}

function sanitizeProviderNode(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node;
  const tag = String(element.tagName || "").toLowerCase();
  if (!tag) return null;

  const DROP_WITH_CHILDREN = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "canvas",
    "noscript",
    "meta",
    "link"
  ]);
  if (DROP_WITH_CHILDREN.has(tag)) {
    return null;
  }

  const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "ins",
    "mark",
    "small",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
    "div"
  ]);

  if (!ALLOWED_TAGS.has(tag)) {
    return sanitizeProviderChildren(element);
  }

  const clean = document.createElement(tag);

  if (tag === "a") {
    const href = sanitizeUrl(element.getAttribute("href") || "");
    if (href) {
      clean.setAttribute("href", href);
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer");
    }
    const title = String(element.getAttribute("title") || "").trim();
    if (title) {
      clean.setAttribute("title", title.slice(0, 280));
    }
  }

  if (tag === "ol") {
    const startRaw = Number(element.getAttribute("start"));
    if (Number.isInteger(startRaw) && startRaw > 0 && startRaw < 100000) {
      clean.setAttribute("start", String(startRaw));
    }
  }

  if (tag === "th" || tag === "td") {
    const colspanRaw = Number(element.getAttribute("colspan"));
    const rowspanRaw = Number(element.getAttribute("rowspan"));
    if (Number.isInteger(colspanRaw) && colspanRaw > 1 && colspanRaw <= 24) {
      clean.setAttribute("colspan", String(colspanRaw));
    }
    if (Number.isInteger(rowspanRaw) && rowspanRaw > 1 && rowspanRaw <= 24) {
      clean.setAttribute("rowspan", String(rowspanRaw));
    }
  }

  for (const child of Array.from(element.childNodes)) {
    const safeChild = sanitizeProviderNode(child);
    if (safeChild) {
      clean.appendChild(safeChild);
    }
  }

  return clean;
}

function sanitizeProviderChildren(element) {
  if (!(element instanceof Element)) return null;
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(element.childNodes)) {
    const safeChild = sanitizeProviderNode(child);
    if (safeChild) {
      fragment.appendChild(safeChild);
    }
  }
  return fragment.childNodes.length ? fragment : null;
}

  ns.renderer = {
    renderAssistantHtml,
    renderAssistantMarkdown,
    extractTextFromHtml,
    sanitizeProviderHtml
  };
})();
