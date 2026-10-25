const mdWriting = document.getElementById("markdown-input");
const mdReading = document.querySelector(".reading-interface");

const escHtml = (text) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const renderInlineMarkdown = (text) => {
  let html = escHtml(text);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/(^|[\s(])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  html = html.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  html = html.replace(/(\*|_)(.+?)\1/g, "<em>$2</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return html;
};

const splitTableRow = (row) => {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
};

const renderTable = (headerRow, bodyRows) => {
  const headerHtml = headerRow
    .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
    .join("");

  const bodyHtml = bodyRows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
};

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
    if (!listItems.length) {
      return;
    }

    const tag = listType === "ordered" ? "ol" : "ul";
    htmlLines.push(
      `<${tag}>${listItems
        .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
        .join("")}</${tag}>`
    );
    listItems = [];
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!codeBuffer.length) {
      return;
    }

    htmlLines.push(`<pre><code>${escHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.trim().startsWith("```")) {
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

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      i -= 1;
      htmlLines.push(`<blockquote>${renderInlineMarkdown(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      htmlLines.push(`<h${level}>${renderInlineMarkdown(headingText)}</h${level}>`);
      continue;
    }

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

    if (line.includes("|") && i + 1 < lines.length && /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const headerRow = splitTableRow(line);
      const separatorRow = splitTableRow(lines[i + 1]);

      if (headerRow.length && separatorRow.length === headerRow.length) {
        const rows = [];
        i += 1;
        for (let j = i + 1; j < lines.length; j += 1) {
          if (!lines[j].includes("|")) {
            break;
          }
          rows.push(splitTableRow(lines[j]));
          i = j;
        }

        htmlLines.push(renderTable(headerRow, rows));
        continue;
      }
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  if (inCodeBlock) {
    flushCodeBlock();
  }

  return htmlLines.join("");
};

if (mdWriting && mdReading) {
  mdWriting.addEventListener("input", () => {
    mdReading.innerHTML = convMd(mdWriting.value);
  });
}
