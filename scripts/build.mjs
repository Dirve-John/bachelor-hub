// Builds dist/ from src/ + content/site.json. No dependencies.
// - Each page in content.pages is src/pages/<file> wrapped in src/layout.html.
// - {{site.title}}, {{site.tagline}}, {{site.description}}, {{page.title}} are filled in.
// - {{poll:<id>}} becomes a poll widget (rendered in the browser by poll.js).
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describePoll, findPoll } from "../lib/polls.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
const layout = readFileSync(join(root, "src/layout.html"), "utf8");
const out = join(root, "dist");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// JSON inside <script> must not contain "</script" or "<!--".
const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

function pollWidget(id) {
  const poll = findPoll(content, id);
  if (!poll) throw new Error(`{{poll:${id}}} used in a page, but no poll with id "${id}" in content/site.json`);
  return `<section class="poll" data-poll-id="${esc(id)}">
  <script type="application/json" class="poll-def">${safeJson(describePoll(poll))}</script>
  <noscript><p class="card">This page needs JavaScript to vote.</p></noscript>
</section>`;
}

function nav(current) {
  if (content.pages.length < 2) return "";
  const links = content.pages
    .map((p) => {
      const href = p.file === "index.html" ? "/" : `/${p.file.replace(/\.html$/, "")}`;
      const cur = p.file === current ? ' aria-current="page"' : "";
      return `<a href="${href}"${cur}>${esc(p.nav ?? p.title)}</a>`;
    })
    .join("");
  return `<nav class="nav">${links}</nav>`;
}

// Home page: just the site title. Other pages: "Page · Site".
const fullTitle = (page) => (page.file === "index.html" ? content.site.title : `${page.title} · ${content.site.title}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "src/static"), out, { recursive: true });

const pageFiles = new Set(readdirSync(join(root, "src/pages")));
for (const page of content.pages) {
  if (!pageFiles.has(page.file)) throw new Error(`content/site.json lists page "${page.file}" but src/pages/${page.file} is missing`);
  const body = readFileSync(join(root, "src/pages", page.file), "utf8").replace(/\{\{poll:([\w-]+)\}\}/g, (_, id) =>
    pollWidget(id),
  );
  const html = layout
    .replace("{{content}}", () => body)
    .replace("{{nav}}", () => nav(page.file))
    .replace(/\{\{site\.(\w+)\}\}/g, (_, k) => esc(content.site[k]))
    .replace(/\{\{page\.(\w+)\}\}/g, (_, k) => esc(k === "fullTitle" ? fullTitle(page) : page[k]));
  writeFileSync(join(out, page.file), html);
}
console.log(`Built ${content.pages.length} page(s) into dist/`);
