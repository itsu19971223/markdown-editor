const mdWriting = document.getElementById("markdown-input");
const mdReading = document.querySelector(".reading-interface");

// 1. Strict HTML and Attribute Escaping (Prevents XSS)
const escHtml = (text) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const sanitizeUrl = (url) => {
  const trimmed = url.trim();
  // Block javascript:, data:, and vbscript: protocols
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return "about:blank";
  }
  return trimmed;
};

// 2. Safer Inline Markdown Rendering
const renderInlineMarkdown = (text) => {
  let html = escHtml(text);

  // Inline Code
  html = html.replace(/`([^`]+)`/g, "<code>\$1</code>");

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    return `<img src="${sanitizeUrl(src)}" alt="${alt}" />`;
  });

  // Explicit Markdown Links
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+\vert{}\/[^\s)]+)\)/g, (match, label, href) => {
    return `<a href="${sanitizeUrl(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Plain Text URL Auto-linking (Avoids touching already processed <a> tags)
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (match, space, url) => {
    // Basic check to see if we are inside an HTML tag attribute
    if (/href=text|src=/i.test(space)) return match;
    return `${space}<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  // Bold, Italics, and Strikethrough
  html = html.replace(/(\*\*|__)(.+?)\1/g, "<strong>\$2</strong>");
  html = html.replace(/(\*|_)(.+?)\1/g, "<em>\$2</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>\$1</del>");

  return html;
};

const splitTableRow = (row) => {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|\$/, "")
    .split("|")
    .map((cell) => cell.trim());
};

const renderTable = (headerRow, bodyRows) => {
  const headerHtml = headerRow
    .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
    .join("");
    
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>\${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");
    
  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
};

// 3. Robust Block-Level Compiler
const convMd = (text) => {
  const lines = text.split(/\r?\n/);
  const htmlLines = [];
  
  let codeBuffer = [];
  let listItems = [];
  let listType = null;
  let paragraphBuffer = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraphBuffer.length) {
      htmlLines.push(`<p>${renderInlineMarkdown(paragraphBuffer.join(" "))}</p>`);
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "ordered" ? "ol" : "ul";
    htmlLines.push(`<${tag}>${listItems.map((item) => `<li>\${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    listItems = [];
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!codeBuffer.length) return;
    htmlLines.push(`<pre><code>${escHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks take absolute priority
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Blank lines clear structural layouts
    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // Blockquotes
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      i--; // Step back to keep loop accurate
      htmlLines.push(`<blockquote>${convMd(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      htmlLines.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Ordered Lists
    const orderedListMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedListMatch) {
      flushParagraph();
      if (listType !== "ordered") {
        flushList();
        listType = "ordered";
      }
      listItems.push(orderedListMatch[1]);
      continue;
    }

    // Unordered Lists
    const unorderedListMatch = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedListMatch) {
      flushParagraph();
      if (listType !== "unordered") {
        flushList();
        listType = "unordered";
      }
      listItems.push(unorderedListMatch[1]);
      continue;
    }

    // Tables
    if (line.includes("|") && i + 1 < lines.length && /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const headerRow = splitTableRow(line);
      const separatorRow = splitTableRow(lines[i + 1]);

      if (headerRow.length && separatorRow.length === headerRow.length) {
        const rows = [];
        i += 1; // skip separator line
        while (i + 1 < lines.length && lines[i + 1].includes("|") && !/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1].trim())) {
          i++;
          rows.push(splitTableRow(lines[i]));
        }
        htmlLines.push(renderTable(headerRow, rows));
        continue;
      }
    }

    // Falling back to standard paragraph text
    paragraphBuffer.push(line);
  }

  // Final clean up flushes
  flushParagraph();
  flushList();
  if (inCodeBlock) flushCodeBlock();

  return htmlLines.join("");
};

// 4. Input Event Listener
if (mdWriting && mdReading) {
  mdWriting.addEventListener("input", () => {
    mdReading.innerHTML = convMd(mdWriting.value);
  });
}
