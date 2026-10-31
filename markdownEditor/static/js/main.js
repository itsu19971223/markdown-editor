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
        `<tr>${row.map((cell) => `<td>\${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`,
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
      `<${tag}>${listItems.map((item) => `<li>\${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`,
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

const initializePage = () => {
  const profileMenu = document.querySelector("[data-profile-menu]");
  const profileToggle = document.querySelector("[data-profile-toggle]");
  const profileDropdown = document.getElementById("profile-dropdown");

  if (profileMenu && profileToggle && profileDropdown) {
    const closeProfileMenu = () => {
      profileDropdown.hidden = true;
      profileToggle.setAttribute("aria-expanded", "false");
    };

    profileToggle.addEventListener("click", () => {
      const isExpanded = profileToggle.getAttribute("aria-expanded") === "true";
      profileDropdown.hidden = isExpanded;
      profileToggle.setAttribute("aria-expanded", String(!isExpanded));
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

  const mdWriting = document.getElementById("markdown-input");
  const mdReading = document.querySelector(".reading-interface");

  if (mdWriting && mdReading) {
    const updatePreview = () => {
      mdReading.innerHTML = convMd(mdWriting.value);
    };

    mdWriting.addEventListener("input", updatePreview);
    updatePreview();
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
          window.location.href = result.redirectTo || "/editor";
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
