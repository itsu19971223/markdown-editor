const escHtml = (text) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};
const sanitizeUrl = (url) => {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return "about:blank";
  }
  return trimmed;
};

const renderInlineMarkdown = (text) => {
  let html = escHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>\$1</code>");
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    return `<img src="${sanitizeUrl(src)}" alt="${alt}" />`;
  });
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label, href) => {
      return `<a href="${sanitizeUrl(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  );
  html = html.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (match, space, url) => {
      if (/href=|src=/i.test(space)) return match;
      return `${space}<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    },
  );
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
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`,
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
      htmlLines.push(
        `<p>${renderInlineMarkdown(paragraphBuffer.join(" "))}</p>`,
      );
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "ordered" ? "ol" : "ul";
    htmlLines.push(
      `<${tag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`,
    );
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

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      i--;
      htmlLines.push(
        `<blockquote>${convMd(quoteLines.join("\n"))}</blockquote>`,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      htmlLines.push(
        `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
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

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1].trim())
    ) {
      flushParagraph();
      flushList();
      const headerRow = splitTableRow(line);
      if (headerRow.length) {
        const rows = [];
        i += 1;
        while (
          i + 1 < lines.length &&
          lines[i + 1].includes("|") &&
          !/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1].trim())
        ) {
          i++;
          rows.push(splitTableRow(lines[i]));
        }
        htmlLines.push(renderTable(headerRow, rows));
        continue;
      }
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  if (inCodeBlock) flushCodeBlock();

  return htmlLines.join("");
};

const escapeXml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const markdownRunsToDocx = (text, codeBlock) => {
  const tokens = codeBlock
    ? [text]
    : text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g);

  return tokens
    .map((token) => {
      let value = token;
      const properties = [];
      if (codeBlock || /^`[^`]+`$/.test(token)) {
        value = codeBlock ? token : token.slice(1, -1);
        properties.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
      } else if (/^(\*\*|__).+\1$/.test(token)) {
        value = token.slice(2, -2);
        properties.push("<w:b/>");
      } else if (/^(\*|_).+\1$/.test(token)) {
        value = token.slice(1, -1);
        properties.push("<w:i/>");
      }

      const runProperties = properties.length
        ? `<w:rPr>${properties.join("")}</w:rPr>`
        : "";
      return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
    })
    .join("");
};

const markdownToDocxDocumentXml = (markdown) => {
  const paragraphs = [];
  let inCodeBlock = false;

  markdown.split(/\r?\n/).forEach((line) => {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (!line && !inCodeBlock) {
      paragraphs.push("<w:p/>");
      return;
    }

    let paragraphProperties = "";
    let content = line;
    if (!inCodeBlock) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const fontSize = 36 - level * 2;
        paragraphProperties = `<w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>`;
        content = `<w:r><w:rPr><w:b/><w:sz w:val="${fontSize}"/></w:rPr><w:t xml:space="preserve">${escapeXml(heading[2])}</w:t></w:r>`;
        paragraphs.push(`<w:p>${paragraphProperties}${content}</w:p>`);
        return;
      }

      content = content
        .replace(/^[-*+]\s+/, "• ")
        .replace(/^>\s?/, "│ ");
    }

    paragraphs.push(
      `<w:p>${paragraphProperties}${markdownRunsToDocx(content, inCodeBlock)}</w:p>`,
    );
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
};

const createStoredZip = (files) => {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < crcTable.length; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crcTable[i] = crc >>> 0;
  }

  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  };
  const makeHeader = (size, signature) => {
    const bytes = new Uint8Array(size);
    new DataView(bytes.buffer).setUint32(0, signature, true);
    return bytes;
  };
  const write16 = (bytes, offset, value) =>
    new DataView(bytes.buffer).setUint16(offset, value, true);
  const write32 = (bytes, offset, value) =>
    new DataView(bytes.buffer).setUint32(offset, value, true);
  const joinBytes = (chunks) => {
    const result = new Uint8Array(
      chunks.reduce((length, chunk) => length + chunk.length, 0),
    );
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  };

  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const filename = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const localHeader = makeHeader(30, 0x04034b50);
    write16(localHeader, 4, 20);
    write16(localHeader, 6, 0x0800);
    write32(localHeader, 14, checksum);
    write32(localHeader, 18, data.length);
    write32(localHeader, 22, data.length);
    write16(localHeader, 26, filename.length);
    localChunks.push(localHeader, filename, data);

    const centralHeader = makeHeader(46, 0x02014b50);
    write16(centralHeader, 4, 20);
    write16(centralHeader, 6, 20);
    write16(centralHeader, 8, 0x0800);
    write32(centralHeader, 16, checksum);
    write32(centralHeader, 20, data.length);
    write32(centralHeader, 24, data.length);
    write16(centralHeader, 28, filename.length);
    write32(centralHeader, 42, localOffset);
    centralChunks.push(centralHeader, filename);
    localOffset += localHeader.length + filename.length + data.length;
  });

  const centralDirectory = joinBytes(centralChunks);
  const endRecord = makeHeader(22, 0x06054b50);
  write16(endRecord, 8, Object.keys(files).length);
  write16(endRecord, 10, Object.keys(files).length);
  write32(endRecord, 12, centralDirectory.length);
  write32(endRecord, 16, localOffset);

  return joinBytes([
    ...localChunks,
    centralDirectory,
    endRecord,
  ]);
};

const createDocxBlob = (markdown) => {
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": markdownToDocxDocumentXml(markdown),
  };

  return new Blob([createStoredZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
};

const downloadFile = (content, filename, mimeType) => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const initializePage = () => {
  const profileMenu = document.querySelector("[data-profile-menu]");
  const profileToggle = document.querySelector("[data-profile-toggle]");
  const profileDropdown = document.getElementById("profile-dropdown");

  if (profileMenu && profileToggle && profileDropdown) {
    const closeProfileMenu = () => {
      profileDropdown.hidden = true;
      profileToggle.setAttribute("aria-expanded", "false");
    };

    const loadSavedDocuments = async () => {
      const savedDocumentsList = document.getElementById(
        "saved-documents-list",
      );
      const savedDocumentsStatus = document.getElementById(
        "saved-documents-status",
      );
      if (!savedDocumentsList || !savedDocumentsStatus) return;

      savedDocumentsList.replaceChildren();
      savedDocumentsStatus.textContent = "Loading saved files...";

      try {
        const response = await fetch("/documents");
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            result.message || `Could not load saved files (HTTP ${response.status}).`,
          );
        }
        if (!Array.isArray(result.documents)) {
          throw new Error("The server returned an invalid saved-files list.");
        }

        if (result.documents.length === 0) {
          savedDocumentsStatus.textContent = "No saved files yet.";
          return;
        }

        savedDocumentsStatus.textContent = "";
        result.documents.forEach((savedDocument) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          const updated = document.createElement("small");
          const updatedAt = new Date(savedDocument.updated_at);

          button.type = "button";
          button.className = "saved-document-button";
          button.setAttribute(
            "aria-current",
            String(
              document.getElementById("markdown-input").dataset.documentId ===
                String(savedDocument.id),
            ),
          );

          const title = document.createElement("span");
          title.className = "saved-document-title";
          title.textContent = savedDocument.title;
          updated.textContent = Number.isNaN(updatedAt.getTime())
            ? ""
            : `Updated ${updatedAt.toLocaleString()}`;
          button.append(title, updated);

          button.addEventListener("click", async () => {
            button.disabled = true;
            savedDocumentsStatus.textContent = "Opening file...";
            try {
              const documentResponse = await fetch(
                `/documents/${encodeURIComponent(savedDocument.id)}`,
              );
              const openedDocument = await documentResponse.json();
              if (!documentResponse.ok) {
                throw new Error(
                  openedDocument.message ||
                    `Could not open file (HTTP ${documentResponse.status}).`,
                );
              }

              const markdownInput = document.getElementById("markdown-input");
              const titleInput = document.getElementById("doc-title");
              const readingInterface = document.querySelector(
                ".reading-interface",
              );
              if (!markdownInput || !titleInput || !readingInterface) {
                throw new Error("The editor is not available.");
              }

              markdownInput.value = openedDocument.content;
              markdownInput.dataset.documentId = String(openedDocument.id);
              titleInput.value = openedDocument.title;
              readingInterface.innerHTML = convMd(openedDocument.content);
              const saveStatus = document.getElementById("save-status");
              if (saveStatus) saveStatus.textContent = "Opened";
              closeProfileMenu();
              profileToggle.focus();
            } catch (error) {
              console.error("Could not open saved document:", error);
              savedDocumentsStatus.textContent =
                error.message || "Could not open saved file.";
            } finally {
              button.disabled = false;
            }
          });

          item.appendChild(button);
          savedDocumentsList.appendChild(item);
        });
      } catch (error) {
        console.error("Could not load saved documents:", error);
        savedDocumentsStatus.textContent =
          error.message || "Could not load saved files.";
      }
    };

    profileToggle.addEventListener("click", () => {
      const isExpanded = profileToggle.getAttribute("aria-expanded") === "true";
      profileDropdown.hidden = isExpanded;
      profileToggle.setAttribute("aria-expanded", String(!isExpanded));
      if (!isExpanded) loadSavedDocuments();
    });

    document.addEventListener("click", (event) => {
      if (!profileMenu.contains(event.target)) closeProfileMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeProfileMenu();
        profileToggle.focus();
      }
    });
  }

  const accountDeleteForm = document.querySelector(
    "[data-account-delete-form]",
  );
  if (accountDeleteForm) {
    accountDeleteForm.addEventListener("submit", (event) => {
      if (
        !window.confirm(
          "Permanently delete your account? This cannot be undone.",
        )
      ) {
        event.preventDefault();
      }
    });
  }

  const mdWriting = document.getElementById("markdown-input");
  const mdReading = document.querySelector(".reading-interface");

  if (mdWriting && mdReading) {
    const updatePreview = () => {
      mdReading.innerHTML = convMd(mdWriting.value);
    };

    mdWriting.addEventListener("input", updatePreview);
    updatePreview();

    const titleInput = document.getElementById("doc-title");
    const saveButton = document.getElementById("save-doc-btn");
    const saveStatus = document.getElementById("save-status");
    const downloadFormat = document.getElementById("download-format");
    const downloadButton = document.getElementById("download-doc-btn");

    if (titleInput && saveButton && saveStatus) {
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveStatus.textContent = "Saving...";

        try {
          const response = await fetch("/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: mdWriting.dataset.documentId || null,
              title: titleInput.value.trim() || "Untitled",
              content: mdWriting.value,
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(
              result.message || `Save failed (HTTP ${response.status}).`,
            );
          }

          mdWriting.dataset.documentId = String(result.id);
          titleInput.value = result.title;
          saveStatus.textContent = "Saved";
        } catch (error) {
          console.error("Could not save document:", error);
          saveStatus.textContent = error.message || "Could not save document.";
        } finally {
          saveButton.disabled = false;
        }
      });
    }

    if (titleInput && downloadFormat && downloadButton) {
      downloadButton.addEventListener("click", () => {
        const format = downloadFormat.value;
        const extension = format === "docx" ? "docx" : format;
        const title = (titleInput.value.trim() || "untitled")
          .replace(/[\\/:*?"<>|]/g, "-")
          .replace(/\.(md|txt|docx)$/i, "")
          .replace(/[. ]+$/g, "");
        const filename = `${title || "untitled"}.${extension}`;

        if (format === "docx") {
          downloadFile(
            createDocxBlob(mdWriting.value),
            filename,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
        } else {
          downloadFile(
            mdWriting.value,
            filename,
            format === "txt"
              ? "text/plain;charset=utf-8"
              : "text/markdown;charset=utf-8",
          );
        }
      });
    }
  }

  const loginForm = document.querySelector(".logIn form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(loginForm);
      const data = Object.fromEntries(formData.entries());

      const submitButton = loginForm.querySelector('button[type="submit"]');
      const originalButtonText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "Logging in...";

      try {
        const response = await fetch(loginForm.action || "/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (response.ok) {
          window.location.href = result.redirectTo || "/dashboard";
        } else {
          alert(
            result.message || "Login failed. Please check your credentials.",
          );
        }
      } catch (error) {
        console.error("Error during login:", error);
        alert("A network error occurred. Please try again later.");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
  }

  const signupForm = document.querySelector(".signUp form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(signupForm);
      const data = Object.fromEntries(formData.entries());

      const submitButton = signupForm.querySelector('button[type="submit"]');
      const originalButtonText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "Registering...";

      try {
        const response = await fetch(signupForm.action || "/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        let result;
        try {
          result = await response.json();
        } catch (error) {
          console.error("Signup returned an invalid response:", error);
          alert(
            `Sign up failed (HTTP ${response.status}). The server returned an unexpected response.`,
          );
          return;
        }

        if (response.ok) {
          alert("Registration successful! Redirecting to login...");
          window.location.href = result.redirectTo || "/login";
        } else {
          alert(result.message || "Signup failed. Please try again.");
        }
      } catch (error) {
        console.error("Error during signup:", error);
        alert("A network error occurred. Please try again later.");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
  }
};

document.addEventListener("DOMContentLoaded", initializePage);
