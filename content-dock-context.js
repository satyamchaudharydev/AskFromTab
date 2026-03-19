// Dedicated page-context extraction module for the in-page dock.
(function registerT2CDockContext() {
  const ns = (window.__T2C_DOCK__ = window.__T2C_DOCK__ || {});

function extractPageContext(query) {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const truncate = (value, maxLength) => {
    const normalized = normalize(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
  };
  const canonicalize = (value) =>
    normalize(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const NOISE_PATTERNS = [
    /top\s*\d+%/i,
    /responds within/i,
    /actively hiring/i,
    /recruiter recently active/i,
    /\bshare\b/i,
    /\bsave\b/i,
    /search for jobs/i,
    /ready to interview/i
  ];
  const JOB_SECTION_HINTS = [
    /about the job/i,
    /job description/i,
    /responsibilit/i,
    /requirement/i,
    /qualification/i,
    /what you(?:'|’)ll do/i,
    /what we(?:'|’)re looking for/i,
    /skills/i,
    /benefits/i,
    /who you are/i
  ];

  const metaDescription =
    document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const selection = String(window.getSelection ? window.getSelection() : "");
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((el) => normalize(el.textContent))
    .filter(Boolean)
    .slice(0, 16);
  const formPrompts = collectFormPrompts();
  const formFields = collectFormFieldsDetailed();
  const keyValuePairs = collectKeyValuePairs();
  const tableSummaries = collectTableSummaries();
  const structuredSections = extractStructuredSections();
  const readabilityResult = parseWithReadability();
  const fallbackUnits = collectFallbackUnits();
  const fullPageText = collectFullPageText();
  const exhaustiveUnits = buildExhaustiveUnits(fullPageText);

  const sectionUnits = structuredSections.map((section, index) => ({
    text: `${section.heading}: ${section.text}`,
    kind: index < 3 ? "priority-section" : "section"
  }));
  const readabilityUnits = readabilityResult?.units || [];
  const mergedUnits = dedupeUnits([
    ...sectionUnits,
    ...readabilityUnits,
    ...fallbackUnits,
    ...exhaustiveUnits
  ]);

  const rankedChunks = buildRankedChunks({
    units: mergedUnits,
    query,
    selection,
    headings,
    title: document.title,
    formPrompts
  });
  const mainContentPreview = buildMainContentPreview(structuredSections, rankedChunks, fullPageText);

  const summaryParts = [
    metaDescription ? `Meta description: ${metaDescription}` : "",
    readabilityResult?.articleTitle ? `Readability title: ${readabilityResult.articleTitle}` : "",
    readabilityResult?.excerpt ? `Readability excerpt: ${readabilityResult.excerpt}` : "",
    structuredSections.length
      ? `Structured sections: ${structuredSections
          .slice(0, 3)
          .map((item) => item.heading)
          .join(" | ")}`
      : "",
    formPrompts.length ? `Application questions: ${formPrompts.join(" | ")}` : ""
  ].filter(Boolean);

  const extractionMode = [
    readabilityResult ? "readability" : "fallback",
    structuredSections.length ? "sections" : ""
  ]
    .filter(Boolean)
    .join("+");

  return {
    title: truncate(document.title, 260),
    url: truncate(window.location.href, 520),
    selection: truncate(selection, 1200),
    headings,
    formPrompts,
    formFields,
    keyValuePairs,
    tableSummaries,
    fullPageText,
    mainContentPreview,
    summary: truncate(summaryParts.join("\n"), 7800),
    rankedChunks,
    extractionMethod: extractionMode || "fallback",
    readability: readabilityResult
      ? {
          title: truncate(readabilityResult.articleTitle, 260),
          excerpt: truncate(readabilityResult.excerpt, 560),
          byline: truncate(readabilityResult.byline, 180),
          length: readabilityResult.length
        }
      : null
  };

  function formatNodeText(node, text) {
    if (!node || !text) return text;
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "li") return `- ${text}`;
    if (tag === "h1") return `# ${text}`;
    if (tag === "h2") return `## ${text}`;
    if (tag === "h3") return `### ${text}`;
    return text;
  }

  function isNoisyText(text) {
    if (!text) return true;
    return NOISE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function shouldKeepNarrativeText(text) {
    const normalized = normalize(text);
    if (normalized.length < 32) return false;
    if (isNoisyText(normalized)) return false;
    const punctuationHits = (normalized.match(/[.!?;:]/g) || []).length;
    return normalized.length > 80 || punctuationHits > 0;
  }

  function extractStructuredSections() {
    const root = document.querySelector("main, [role='main'], article") || document.body;
    const nodes = Array.from(root.querySelectorAll("h1, h2, h3, p, li"));
    if (!nodes.length) return [];

    let currentHeading = "Overview";
    const sectionMap = new Map();

    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text) continue;

      if (node.matches("h1, h2, h3")) {
        if (text.length > 2 && text.length < 120) {
          currentHeading = text;
        }
        continue;
      }

      if (!shouldKeepNarrativeText(text)) continue;

      if (!sectionMap.has(currentHeading)) {
        sectionMap.set(currentHeading, []);
      }
      sectionMap.get(currentHeading).push(formatNodeText(node, text));
    }

    const sections = [];
    for (const [heading, lines] of sectionMap.entries()) {
      const dedupedLines = dedupeLines(lines).slice(0, 18);
      const text = dedupedLines.join(" ");
      if (text.length < 120) continue;
      if (isNoisyText(heading) && !JOB_SECTION_HINTS.some((pattern) => pattern.test(heading))) {
        continue;
      }

      const headingBonus = JOB_SECTION_HINTS.some((pattern) => pattern.test(heading)) ? 4 : 0;
      const score = headingBonus + Math.min(3.5, text.length / 420);

      sections.push({
        heading: truncate(heading, 90),
        text: truncate(text, 1500),
        score
      });
    }

    return sections
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => ({ heading: item.heading, text: item.text }));
  }

  function collectFormPrompts() {
    const prompts = [];
    const fields = Array.from(
      document.querySelectorAll(
        "textarea, input[type='text'], input:not([type]), [contenteditable='true'][role='textbox']"
      )
    ).slice(0, 30);

    for (const field of fields) {
      const fromLabels = Array.from(field.labels || [])
        .map((label) => normalize(label.textContent))
        .filter(Boolean);
      const ariaLabel = normalize(field.getAttribute?.("aria-label") || "");
      const placeholder = normalize(field.getAttribute?.("placeholder") || "");

      let nearby = "";
      let cursor = field.previousElementSibling;
      let hops = 0;
      while (cursor && hops < 3) {
        const maybeText = normalize(cursor.textContent || "");
        if (maybeText.length >= 10 && maybeText.length <= 220) {
          nearby = maybeText;
          break;
        }
        cursor = cursor.previousElementSibling;
        hops += 1;
      }

      const candidate = [fromLabels[0], ariaLabel, nearby, placeholder].find(
        (item) => item && item.length >= 8
      );
      if (!candidate || isNoisyText(candidate)) continue;
      prompts.push(candidate);
    }

    return dedupeLines(prompts).slice(0, 5).map((item) => truncate(item, 220));
  }

  function collectFormFieldsDetailed() {
    const results = [];
    const fields = Array.from(
      document.querySelectorAll(
        "textarea, input, select, [contenteditable='true'][role='textbox']"
      )
    ).slice(0, 80);

    const radioGroups = new Map();
    const checkboxGroups = new Map();

    for (const field of fields) {
      if (field.closest("[aria-hidden='true'],[hidden]")) continue;

      const tag = field.tagName ? field.tagName.toLowerCase() : "input";
      let type = tag === "input" ? (field.getAttribute("type") || "text").toLowerCase() : tag;
      if (type === "password" || type === "hidden" || type === "file") continue;
      if (["submit", "button", "reset", "image"].includes(type)) continue;

      const labelInfo = collectFieldLabels(field);
      const name = normalize(field.getAttribute?.("name") || "") || normalize(field.id || "");
      const group = collectFieldGroupLabel(field);
      const constraints = collectFieldConstraints(field);
      const hint = collectFieldHint(field);

      if (type === "radio") {
        const key = `${name || labelInfo.label || "radio"}::${group || ""}`;
        const optionLabel = labelInfo.label || normalize(field.value || "");
        const entry = radioGroups.get(key) || {
          label: labelInfo.label || group || name || "Radio group",
          name,
          group,
          type: "radio-group",
          required: Boolean(field.required || field.getAttribute?.("aria-required") === "true"),
          options: [],
          value: "",
          checked: false,
          hint,
          constraints
        };
        entry.options.push({
          label: truncate(optionLabel, 140) || "(option)",
          value: truncate(normalize(field.value || ""), 120),
          checked: Boolean(field.checked)
        });
        if (field.checked) {
          entry.value = truncate(optionLabel || field.value || "", 160);
          entry.checked = true;
        }
        radioGroups.set(key, entry);
        continue;
      }

      if (type === "checkbox") {
        const key = `${name || labelInfo.label || "checkbox"}::${group || ""}`;
        const optionLabel = labelInfo.label || normalize(field.value || "") || name || "Checkbox";
        const entry = checkboxGroups.get(key) || {
          label: labelInfo.label || group || name || "Checkbox group",
          name,
          group,
          type: "checkbox-group",
          required: Boolean(field.required || field.getAttribute?.("aria-required") === "true"),
          options: [],
          value: "",
          checked: false,
          hint,
          constraints
        };
        entry.options.push({
          label: truncate(optionLabel, 140),
          value: truncate(normalize(field.value || ""), 120),
          checked: Boolean(field.checked)
        });
        checkboxGroups.set(key, entry);
        continue;
      }

      const fieldValueInfo = collectFieldValue(field, type);
      const optionList = collectFieldOptions(field);
      let value = fieldValueInfo.value;
      let checked = fieldValueInfo.checked;

      if (isSensitiveField(type, name, labelInfo.label, labelInfo.placeholder)) {
        value = value ? "(redacted)" : "";
      }

      results.push({
        label: truncate(labelInfo.label, 160),
        name: truncate(name, 80),
        type,
        group: truncate(group, 140),
        required: Boolean(field.required || field.getAttribute?.("aria-required") === "true"),
        placeholder: truncate(labelInfo.placeholder, 160),
        value: truncate(value, 260),
        checked,
        options: optionList.length ? optionList.map((opt) => truncate(opt, 120)) : [],
        hint: truncate(hint, 220),
        constraints
      });
    }

    for (const entry of radioGroups.values()) {
      results.push(entry);
    }
    for (const entry of checkboxGroups.values()) {
      if (entry.options.length > 1) {
        results.push(entry);
      } else if (entry.options.length === 1) {
        const option = entry.options[0];
        results.push({
          label: truncate(option.label || entry.label, 160),
          name: truncate(entry.name, 80),
          type: "checkbox",
          group: truncate(entry.group, 140),
          required: entry.required,
          placeholder: "",
          value: truncate(option.value, 260),
          checked: Boolean(option.checked),
          options: [],
          hint: truncate(entry.hint, 220),
          constraints: entry.constraints
        });
      }
    }

    return results.slice(0, 20);
  }

  function collectFieldLabels(field) {
    const fromLabels = Array.from(field.labels || [])
      .map((label) => normalize(label.textContent))
      .filter(Boolean);
    const ariaLabel = normalize(field.getAttribute?.("aria-label") || "");
    const placeholder = normalize(field.getAttribute?.("placeholder") || "");
    let nearby = "";
    let cursor = field.previousElementSibling;
    let hops = 0;
    while (cursor && hops < 3) {
      const maybeText = normalize(cursor.textContent || "");
      if (maybeText.length >= 10 && maybeText.length <= 220) {
        nearby = maybeText;
        break;
      }
      cursor = cursor.previousElementSibling;
      hops += 1;
    }

    const label = [fromLabels[0], ariaLabel, nearby, placeholder].find(
      (item) => item && item.length >= 4
    ) || "";

    return { label, placeholder };
  }

  function collectFieldGroupLabel(field) {
    const fieldset = field.closest("fieldset");
    const legendText = normalize(fieldset?.querySelector("legend")?.textContent || "");
    return legendText;
  }

  function collectFieldHint(field) {
    const describedBy = field.getAttribute?.("aria-describedby");
    if (describedBy) {
      const texts = describedBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => normalize(el.textContent))
        .filter(Boolean);
      if (texts.length) return texts.join(" ");
    }

    const hintEl =
      field.closest("label")?.querySelector(".hint,.help,.helper") ||
      field.parentElement?.querySelector(".hint,.help,.helper");
    return normalize(hintEl?.textContent || "");
  }

  function collectFieldConstraints(field) {
    const constraints = [];
    const min = field.getAttribute?.("min");
    const max = field.getAttribute?.("max");
    const step = field.getAttribute?.("step");
    const minLength = field.getAttribute?.("minlength");
    const maxLength = field.getAttribute?.("maxlength");
    const pattern = field.getAttribute?.("pattern");

    if (min) constraints.push(`min=${min}`);
    if (max) constraints.push(`max=${max}`);
    if (step) constraints.push(`step=${step}`);
    if (minLength) constraints.push(`minLength=${minLength}`);
    if (maxLength) constraints.push(`maxLength=${maxLength}`);
    if (pattern) constraints.push(`pattern=${pattern}`);

    return constraints.join(" ");
  }

  function collectFieldOptions(field) {
    if (field.tagName?.toLowerCase() === "select") {
      return Array.from(field.options || [])
        .map((opt) => normalize(opt.textContent || opt.value))
        .filter(Boolean)
        .slice(0, 10);
    }
    const listId = field.getAttribute?.("list");
    if (listId) {
      const datalist = document.getElementById(listId);
      if (datalist) {
        return Array.from(datalist.querySelectorAll("option"))
          .map((opt) => normalize(opt.value || opt.textContent))
          .filter(Boolean)
          .slice(0, 10);
      }
    }
    return [];
  }

  function collectFieldValue(field, type) {
    let value = "";
    let checked = false;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (type === "checkbox" || type === "radio") {
        checked = Boolean(field.checked);
        value = normalize(field.value || "");
      } else {
        value = normalize(field.value || "");
      }
    } else if (field.tagName?.toLowerCase() === "select") {
      const selected = Array.from(field.selectedOptions || [])
        .map((opt) => normalize(opt.textContent || opt.value))
        .filter(Boolean);
      value = selected.join(", ");
    } else if (field.isContentEditable) {
      value = normalize(field.textContent || "");
    }
    return { value, checked };
  }

  function isSensitiveField(type, name, label, placeholder) {
    if (type === "password") return true;
    const combined = `${name} ${label} ${placeholder}`.toLowerCase();
    return /(password|passcode|otp|ssn|social|credit|card|cvv|cvc)/.test(combined);
  }

  function collectKeyValuePairs() {
    const pairs = [];
    const dlNodes = Array.from(document.querySelectorAll("dl")).slice(0, 10);
    for (const dl of dlNodes) {
      const terms = Array.from(dl.querySelectorAll("dt"));
      for (const dt of terms) {
        const dd = dt.nextElementSibling;
        if (!dd || dd.tagName.toLowerCase() !== "dd") continue;
        const key = normalize(dt.textContent);
        const value = normalize(dd.textContent);
        if (key && value) {
          pairs.push({ key, value });
        }
      }
    }

    const tablePairs = collectTableKeyValuePairs();
    return dedupeKeyValuePairs([...pairs, ...tablePairs]).slice(0, 16);
  }

  function collectTableKeyValuePairs() {
    const pairs = [];
    const tables = Array.from(document.querySelectorAll("table")).slice(0, 6);
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr")).slice(0, 12);
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("th,td")).map((cell) =>
          normalize(cell.textContent)
        );
        if (cells.length === 2 && cells[0] && cells[1]) {
          if (cells[0].length <= 60) {
            pairs.push({ key: cells[0], value: cells[1] });
          }
        }
      }
    }
    return pairs;
  }

  function dedupeKeyValuePairs(pairs) {
    const seen = new Set();
    const out = [];
    for (const pair of pairs) {
      const key = canonicalize(pair.key);
      const value = canonicalize(pair.value);
      if (!key || !value) continue;
      const signature = `${key}:${value}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push(pair);
    }
    return out;
  }

  function collectTableSummaries() {
    const tables = Array.from(document.querySelectorAll("table")).slice(0, 4);
    return tables.map((table) => {
      const caption = normalize(table.querySelector("caption")?.textContent || "");
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((th) => normalize(th.textContent))
        .filter(Boolean)
        .slice(0, 8);
      const rows = Array.from(table.querySelectorAll("tbody tr, tr"))
        .slice(0, 6)
        .map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => normalize(cell.textContent))
            .filter(Boolean)
            .slice(0, 8)
        )
        .filter((cells) => cells.length > 0);

      return {
        caption: truncate(caption, 120),
        headers,
        rows
      };
    });
  }

  function parseWithReadability() {
    if (typeof Readability !== "function") {
      return null;
    }

    try {
      const shouldPreferReadability =
        (typeof isProbablyReaderable === "function" &&
          isProbablyReaderable(document, { minContentLength: 120, minScore: 18 })) ||
        (document.body?.innerText || "").length > 2600;

      if (!shouldPreferReadability) {
        return null;
      }

      const cloned = document.cloneNode(true);
      const parsed = new Readability(cloned, {
        charThreshold: 220,
        keepClasses: false
      }).parse();

      if (!parsed?.textContent) {
        return null;
      }

      const container = document.createElement("div");
      container.innerHTML = parsed.content || "";
      const nodes = container.querySelectorAll("h1, h2, h3, p, li, blockquote, pre");
      const units = [];

      for (const node of nodes) {
        if (units.length >= 220) break;
      const text = normalize(node.textContent);
      if (text.length < (node.matches("h1, h2, h3") ? 8 : 35)) continue;
      if (isNoisyText(text)) continue;

      units.push({
        text: formatNodeText(node, text),
        kind: node.tagName.toLowerCase()
      });
    }

      return {
        articleTitle: parsed.title || "",
        excerpt: parsed.excerpt || "",
        byline: parsed.byline || "",
        length: parsed.length || parsed.textContent.length || 0,
        units
      };
    } catch {
      return null;
    }
  }

  function collectFallbackUnits() {
    const root = document.querySelector("main, [role='main'], article") || document.body;
    const units = [];
    const candidates = root.querySelectorAll("article p, section p, main p, p, li, h2, h3");

    for (const node of candidates) {
      if (units.length >= 180) break;
      const text = normalize(node.textContent);
      if (text.length < (node.matches("h2, h3") ? 8 : 35)) continue;
      if (isNoisyText(text)) continue;
      units.push({
        text: formatNodeText(node, text),
        kind: node.tagName.toLowerCase()
      });
    }

    return units;
  }

  function collectFullPageText() {
    const root =
      document.querySelector("main, [role='main'], article, .main-content") || document.body;
    const skipSelectors =
      "script,style,noscript,svg,canvas,video,audio,iframe,nav,header,footer,[aria-hidden='true'],[hidden]";
    const nodes = Array.from(root.querySelectorAll("h1,h2,h3,p,li"));
    const lines = [];
    const seen = new Set();
    let totalChars = 0;
    const maxChars = 45000;

    for (const node of nodes) {
      if (node.closest(skipSelectors)) continue;
      const raw = normalize(node.textContent);
      if (!raw || raw.length < 2) continue;

      const formatted = formatNodeText(node, raw);
      const key = canonicalize(formatted);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      lines.push(formatted);
      totalChars += formatted.length + 1;
      if (totalChars >= maxChars) break;
    }

    return truncate(lines.join("\n"), maxChars);
  }

  function buildExhaustiveUnits(fullText) {
    if (!fullText) return [];
    return fullText
      .split(/\n+/)
      .map((line) => normalize(line))
      .filter((line) => line.length >= 22)
      .slice(0, 240)
      .map((text) => ({ text, kind: "fulltext" }));
  }

  function dedupeUnits(units) {
    const out = [];
    const seen = new Set();

    for (const unit of units) {
      const text = normalize(unit?.text);
      if (!text) continue;
      if (isNoisyText(text)) continue;

      const key = canonicalize(text).slice(0, 180);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text, kind: unit?.kind || "text" });
    }

    return out;
  }

  function dedupeLines(lines) {
    const seen = new Set();
    const out = [];
    for (const line of lines) {
      const text = normalize(line);
      if (!text) continue;
      const key = canonicalize(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  function buildRankedChunks(params) {
    const sourceUnits = params.units || [];
    if (!sourceUnits.length) return [];

    const queryTerms = extractKeywords(params.query || "");
    const contextTerms = extractKeywords(
      [
        params.selection || "",
        params.title || "",
        (params.headings || []).join(" "),
        (params.formPrompts || []).join(" ")
      ].join(" ")
    );
    const allTerms = new Set([...queryTerms, ...contextTerms]);
    const hasQuery = queryTerms.size > 0;

    const scored = sourceUnits
      .map((unit, index) => {
        const text = normalize(unit.text);
        const lower = text.toLowerCase();
        if (isNoisyText(lower)) return null;

        let keywordScore = 0;
        for (const term of allTerms) {
          if (lower.includes(term)) {
            keywordScore += queryTerms.has(term) ? 3.2 : 1.0;
          }
        }

        const positionScore = Math.max(0, 2.4 - index * 0.05);
        const structureScore =
          unit.kind === "priority-section"
            ? 4
            : unit.kind === "section"
              ? 2
              : unit.kind.startsWith("h")
                ? 1.2
                : 0;
        const narrativeScore = text.length > 140 ? 1.5 : text.length > 90 ? 0.8 : 0;

        return {
          text,
          index,
          score: keywordScore + positionScore + structureScore + narrativeScore
        };
      })
      .filter(Boolean);

    const sorted = scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    let shortlisted = sorted.slice(0, 18);
    if (!hasQuery) {
      shortlisted = shortlisted
        .filter((item) => item.text.length >= 90)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.index - b.index;
        });
    }

    const ordered = shortlisted.sort((a, b) => a.index - b.index);

    const maxApproxTokens = 1050;
    let tokenBudget = 0;
    const chunks = [];
    const seenChunkKeys = new Set();

    for (const item of ordered) {
      const chunkText = truncate(item.text, 760);
      const chunkKey = canonicalize(chunkText).slice(0, 200);
      if (!chunkKey || seenChunkKeys.has(chunkKey)) continue;

      const chunkTokens = Math.ceil(chunkText.length / 4);
      if (chunks.length > 0 && tokenBudget + chunkTokens > maxApproxTokens) {
        continue;
      }

      seenChunkKeys.add(chunkKey);
      chunks.push(chunkText);
      tokenBudget += chunkTokens;
      if (chunks.length >= 9) break;
    }

    return chunks;
  }

  function buildMainContentPreview(sections, chunks, fullText) {
    if (fullText) {
      return truncate(fullText, 12000);
    }

    const blocks = [];
    for (const section of sections.slice(0, 4)) {
      if (!section?.text) continue;
      blocks.push(`${section.heading}\n${section.text}`);
    }

    if (blocks.length === 0 && Array.isArray(chunks) && chunks.length > 0) {
      blocks.push(chunks.join("\n\n"));
    }

    const combined = blocks.join("\n\n");
    return truncate(combined, 12000);
  }

  function extractKeywords(text) {
    const STOP_WORDS = new Set([
      "about",
      "after",
      "again",
      "also",
      "another",
      "because",
      "before",
      "between",
      "could",
      "first",
      "from",
      "have",
      "into",
      "just",
      "more",
      "most",
      "other",
      "over",
      "same",
      "such",
      "than",
      "that",
      "their",
      "there",
      "these",
      "they",
      "this",
      "those",
      "what",
      "when",
      "where",
      "which",
      "while",
      "with",
      "would",
      "your"
    ]);

    const normalized = normalize(text).toLowerCase();
    if (!normalized) return new Set();

    const terms = normalized.match(/[a-z0-9]{3,}/g) || [];
    const filtered = terms.filter((term) => !STOP_WORDS.has(term)).slice(0, 42);
    return new Set(filtered);
  }
}

  ns.extractPageContext = extractPageContext;
})();
