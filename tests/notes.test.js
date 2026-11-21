const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const html = fs.readFileSync(process.env.HTML || "index.html", "utf8");
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function sharedStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
function newLocks() { return { held: new Set(), requests: [] }; }
function locksFor(shared, w, hooks) {
  return { request(name, a, b) {
    const opts = typeof a === "function" ? {} : a, cb = typeof a === "function" ? a : b;
    shared.requests.push(name);
    return Promise.resolve().then(async () => {
      if (hooks && hooks.beforeGrant) await hooks.beforeGrant(name, w);
      while (shared.held.has(name)) { if (opts.ifAvailable) return cb(null); await tick(5); }
      shared.held.add(name);
      try { return await cb({ name }); } finally { shared.held.delete(name); }
    });
  } };
}
function boot(opts = {}) {
  const idb = opts.idb || new IDBFactory();
  const dom = new JSDOM(html, {
    url: "https://example.test/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.__audios = [];
      w.Audio = class { constructor() { this._l = {}; this._src = ""; this.paused = true; this.volume = 1; w.__audios.push(this); } set src(v) { this._src = v; } get src() { return this._src; }
        getAttribute() { return null; } addEventListener() {} removeAttribute() {} load() {} play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
      w.indexedDB = idb; w.__errors = []; w.addEventListener("error", (e) => w.__errors.push(String(e.message)));
      if (opts.locks) Object.defineProperty(w.navigator, "locks", { value: locksFor(opts.locks, w, opts.lockHooks), configurable: true });
      if (opts.storage) { const P = w.Storage.prototype; P.getItem = (k) => opts.storage.getItem(k); P.setItem = (k, v) => opts.storage.setItem(k, v); P.removeItem = (k) => opts.storage.removeItem(k); }
      w.URL.createObjectURL = (b) => "blob:" + b.size; w.URL.revokeObjectURL = () => {};
      w.__y = 0; w.scrollTo = (x, y) => { w.__y = y; }; Object.defineProperty(w, "scrollY", { get: () => w.__y, configurable: true });
      w.__scrolled = []; w.Element.prototype.scrollIntoView = function () { w.__scrolled.push(this.id || this.textContent.slice(0, 20)); };
      w.confirm = () => opts.confirm !== false; w.prompt = () => opts.promptValue === undefined ? "My notes" : opts.promptValue;
      Object.entries(opts.ls || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, idb, $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)], ls: (k) => JSON.parse(w.localStorage.getItem("tl_" + k)),
    dump: () => Object.fromEntries(Object.keys(w.localStorage).map((k) => [k, w.localStorage.getItem(k)])) };
}
const idbOp = (idb, fn) => new Promise((res, rej) => {
  const r = idb.open("tl_pod", 1); r.onupgradeneeded = () => r.result.createObjectStore("files");
  r.onsuccess = () => { const db = r.result, tx = db.transaction("files", "readwrite"), rq = fn(tx.objectStore("files")); tx.oncomplete = () => { db.close(); res(rq && rq.result); }; tx.onerror = () => rej(tx.error); };
  r.onerror = () => rej(r.error);
});
const keysOf = (idb) => idbOp(idb, (os) => os.getAllKeys());

function mk(rel, content, mod) {
  const f = new File([content], rel.split("/").pop(), { type: /\.(png|jpe?g)$/.test(rel) ? "image/png" : "text/markdown", lastModified: mod || 1000 });
  if (rel.includes("/")) Object.defineProperty(f, "webkitRelativePath", { value: rel });     // like browsers: only set for folder picks
  return f;
}
async function addVault(a, files, input = "#pickMd") {
  const inp = a.$(input); Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(250);
}
const openTab = (a) => a.$('[data-mode="note"]').click();
// open a note of the (already open) vault by its title; returns the rendered HTML of the note
async function note(a, title) {
  if (a.$(".rbar")) a.$('[data-act="nback"]').click();
  while (a.$(".rbar")) a.$('[data-act="nback"]').click();
  a.$$(".tf").find((b) => b.textContent === title).click(); await tick(80);
  return a.$("#mdBody").innerHTML;
}
// a vault with one note per markdown snippet
async function withNotes(notes, extra = []) {
  const a = boot(); openTab(a);
  await addVault(a, Object.entries(notes).map(([n, c]) => mk("V/" + n + ".md", c)).concat(extra));
  a.$('[data-act="vopen"]').click(); await tick(30);
  return a;
}

test("tab exists, empty state, vault import skips hidden folders and non-markdown", async () => {
  const a = boot(); openTab(a);
  assert.equal(a.$("#noteView").hidden, false); assert.equal(a.ls("view"), "note"); assert.match(a.$("#noteBody").textContent, /No notes yet/);
  await addVault(a, [mk("Mod/a.md", "# A"), mk("Mod/.obsidian/x.md", "x"), mk("Mod/sub/b.markdown", "# B"), mk("Mod/readme.txt", "t"), mk("Mod/img/p.png", "PNG"), mk("Mod/.git/c.md", "c")]);
  const v = a.ls("vaults")[0];
  assert.equal(v.name, "Mod"); assert.deepEqual(v.files.map((f) => f.path).sort(), ["a.md", "img/p.png", "sub/b.markdown"]);
  assert.match(a.$("#noteBody").textContent, /2 notes · 1 image\b/);
  await addVault(a, [mk("X/n.txt", "no")]); assert.match(a.$("#toast").textContent, /No Markdown files/);
});

test("headings, setext, ids, #tag is not a heading, C# keeps its hash", async () => {
  const a = await withNotes({ h: "# Title\n\nText\n\nSecond\n======\n\nThird\n------\n\n## C#\n\n#tag no title\n\n## Title\n\n###### six" });
  const h = await note(a, "h");
  assert.match(h, /<h1 id="h-title">Title<\/h1>/); assert.match(h, /<h1 id="h-second">Second<\/h1>/); assert.match(h, /<h2 id="h-third">Third<\/h2>/);
  assert.match(h, /<h2 id="h-c">C#<\/h2>/); assert.match(h, /<p>#tag no title<\/p>/); assert.match(h, /<h2 id="h-title-1">Title<\/h2>/); assert.match(h, /<h6 /);
  assert.ok(a.$$("#toc a").length >= 5, "table of contents built");
});

test("inline formatting, escapes, snake_case, soft line breaks", async () => {
  const a = await withNotes({ f: "**bold** *italic* ***both*** ~~gone~~ ==marked== `code <b>` and snake_case_name 2 * 3 * 4 \\*no\\*\nsecond line  \nthird <kbd>Ctrl</kbd> H<sub>2</sub>O" });
  const h = await note(a, "f");
  assert.match(h, /<strong>bold<\/strong> <em>italic<\/em> <strong><em>both<\/em><\/strong> <del>gone<\/del> <mark>marked<\/mark>/);
  assert.match(h, /<code>code &lt;b&gt;<\/code>/); assert.match(h, /snake_case_name/); assert.doesNotMatch(h, /snake<em>/);
  assert.match(h, /2 \* 3 \* 4 \*no\*<br>second line<br>third <kbd>Ctrl<\/kbd> H<sub>2<\/sub>O/);
});

test("raw HTML is never executed; dangerous links are dropped", async () => {
  const a = await withNotes({ x: '<script>window.__xss=1</script>\n\n<img src=x onerror="window.__xss=2">\n\n[click](javascript:window.__xss=3) [d](data:text/html,<b>x</b>) [ok](https://example.org/a?b=1&c=2 "T") <https://auto.link/x>\n\n![image](javascript:alert(1))\n\n<iframe src="https://evil"></iframe> <a href="javascript:1">h</a>' });
  const h = await note(a, "x");
  assert.equal(a.$$("#mdBody script, #mdBody iframe, #mdBody img[onerror]").length, 0); assert.equal(a.w.__xss, undefined);
  assert.match(h, /&lt;script&gt;/); assert.match(h, /&lt;iframe/);
  assert.equal(a.$$('#mdBody a[href^="javascript" i], #mdBody a[href^="data:" i]').length, 0, "no dangerous links");
  assert.deepEqual(a.$$("#mdBody a").map((x) => x.getAttribute("href")), ["https://example.org/a?b=1&c=2", "https://auto.link/x", "https://evil"], "the bare URL in the iframe text is linked cleanly, without quotes or tags");
  assert.match(h, /<a href="https:\/\/example.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" title="T">ok<\/a>/);
  assert.match(h, /<a href="https:\/\/auto.link\/x" target="_blank"/);
});

test("lists: nesting with spaces and tabs, ordered start, tasks, tight vs loose", async () => {
  const a = await withNotes({ l: "- a\n\t- a1\n\t- a2\n\t\t- deep\n- b\n\n3. three\n4. four\n\nTasks:\n\n- [ ] open\n- [x] done\n\nand loose:\n\n- loose\n\n- List\n\n  second paragraph\n\nSpaces:\n\n- x\n  - y\n    - z" });
  const h = await note(a, "l");
  assert.match(h, /<ul><li>a<ul><li>a1<\/li><li>a2<ul><li>deep<\/li><\/ul><\/li><\/ul><\/li><li>b<\/li><\/ul>/, "tab nesting");
  assert.match(h, /<ul><li>x<ul><li>y<ul><li>z<\/li><\/ul><\/li><\/ul><\/li><\/ul>/, "space nesting");
  assert.match(h, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);
  assert.match(h, /<li class="task"><input type="checkbox" disabled=""> open<\/li><li class="task"><input type="checkbox" disabled="" checked=""> done<\/li>/);
  assert.match(h, /<li><p>loose<\/p><\/li><li><p>List<\/p><p>second paragraph<\/p><\/li>/, "loose list gets paragraphs");
  assert.doesNotMatch(h, /<br><ul>/, "no stray line break before a nested list");
});

test("code blocks: language, highlighting, escaping, unclosed fence, indented code", async () => {
  const a = await withNotes({ c: "```js\nconst x = \"hi\"; // <b>c</b>\nif (x) { return 42; }\n```\n\n```python\ndef f():\n    # comment\n    return None\n```\n\n```json\n{\"k\": [1, true]}\n```\n\n```html\n<div class=\"a\">x</div>\n```\n\n    indented\n    code\n\n```unknown\n<tag> & \"q\"\n```\n\n```\nnever closed\n# no title" });
  const h = await note(a, "c");
  assert.match(h, /<span class="tk-k">const<\/span> x = <span class="tk-s">"hi"<\/span>; <span class="tk-c">\/\/ &lt;b&gt;c&lt;\/b&gt;<\/span>/);
  assert.match(h, /<span class="tk-k">if<\/span>/); assert.match(h, /<span class="tk-n">42<\/span>/);
  assert.match(h, /<span class="tk-k">def<\/span> f\(\)/); assert.match(h, /<span class="tk-c"># comment<\/span>/); assert.match(h, /<span class="tk-k">None<\/span>/);
  assert.match(h, /<span class="tk-p">"k"<\/span>/); assert.match(h, /<span class="tk-k">true<\/span>/);
  assert.match(h, /<span class="tk-k">div<\/span> class=<span class="tk-s">"a"<\/span>/);
  assert.match(h, /<code>indented\ncode<\/code>/); assert.match(h, /&lt;tag&gt; &amp; "q"/);
  assert.match(h, /never closed\n# no title<\/code>/);
  assert.ok(a.$$("#mdBody button[data-copy]").length >= 6, "copy buttons");
});

test("tables with alignment, escaped pipes and inline markup", async () => {
  const a = await withNotes({ t: "| Name | Value | Rest |\n|:--|:-:|--:|\n| **a** | `x\\|y` | 3 |\n| b | | |\n\nno | table\n---" });
  const h = await note(a, "t");
  assert.match(h, /<th style="text-align:left">Name<\/th><th style="text-align:center">Value<\/th><th style="text-align:right">Rest<\/th>/);
  assert.match(h, /<td style="text-align:left"><strong>a<\/strong><\/td><td style="text-align:center"><code>x\|y<\/code><\/td>/);
  assert.equal(a.$$("#mdBody table").length, 1); assert.match(h, /<h2 id="h-no-table">/, "line with pipe + --- is a setext heading, not a table");
});

test("blockquotes and Obsidian callouts (plain, foldable open/closed, custom title, nested)", async () => {
  const a = await withNotes({ q: "> Quote\n> second line\n\n> [!note]\n> Content **bold**\n\n> [!warning] Careful!\n> - a\n> - b\n\n> [!tip]- Folded\n> hidden\n\n> [!question]+ Open\n> visible\n\n> outer\n> > inner" });
  const h = await note(a, "q");
  assert.match(h, /<blockquote><p>Quote<br>second line<\/p><\/blockquote>/);
  assert.match(h, /<div class="callout" style="--c:hsl\(210 80% 62%\)" data-type="note"><div class="callout-title"><span class="ct">Note<\/span><\/div><div class="callout-body"><p>Content <strong>bold<\/strong><\/p>/);
  assert.match(h, /data-type="warning"[^>]*><div class="callout-title"><span class="ct">Careful!<\/span><\/div><div class="callout-body"><ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(h, /<details class="callout"[^>]*data-type="tip"><summary class="callout-title"><span class="ct">Folded<\/span>/); assert.match(h, /<details class="callout"[^>]*data-type="question" open(="")?>/);
  assert.match(h, /<blockquote><p>outer<\/p><blockquote><p>inner<\/p><\/blockquote><\/blockquote>/);
});

test("frontmatter, comments, math, footnotes, hr", async () => {
  const a = await withNotes({ m: "---\ntitle: Module 1\ntags:\n  - learning\n  - info\naliases: [a, b]\n---\n# Content\n\nText %%Comment%% stays.\n\n%%\nwhole\nBlock\n%%\n\nInline $a^2+b^2$ and price $5 and $6 ok.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nFootnote[^1] and[^two].\n\n---\n\n[^1]: First note.\n[^two]: Second\n    with continuation." });
  const h = await note(a, "m");
  assert.match(h, /<details class="props"><summary>Properties<\/summary><table><tbody><tr><th>title<\/th><td>Module 1<\/td><\/tr><tr><th>tags<\/th><td>learning, info<\/td><\/tr><tr><th>aliases<\/th><td>a, b<\/td>/);
  assert.doesNotMatch(h, /Comment|whole|Block<\/p>/); assert.match(h, /Text  stays\./);
  assert.match(h, /<span class="math">a\^2\+b\^2<\/span>/); assert.match(h, /price \$5 and \$6 ok/); assert.match(h, /<div class="math">\\int_0\^1 x\\,dx<\/div>/);
  assert.match(h, /<sup class="fnref"><a href="#" id="fnref-1" data-goto="fn-1">1<\/a><\/sup> and<sup class="fnref"><a href="#" id="fnref-two" data-goto="fn-two">2<\/a>/);
  assert.match(h, /<section class="footnotes"><ol><li id="fn-1">First note\./); assert.match(h, /Second<br>with continuation\./); assert.match(h, /<hr>/);
});

test("links between notes: relative, wiki, alias, heading, unresolved; back keeps the place", async () => {
  const a = await withNotes({
    "A": "# Start\n\n[rel](B.md) [sub](sub/C.md#Section%20Two) [spaces](<sub/C.md#Section Two>) [[B]] [[B|Alias]] [[sub/C#Section Two]] [[Does not exist]] [x](missing.md) [anchor](#bottom) [`code` **bold**](B.md)\n\n## Bottom\ntext",
    "B": "# B\n\n[back](A.md)",
    "sub/C": "# C\n\n## Section One\n\n## Section Two\n\nend",
  });
  let h = await note(a, "A");
  assert.match(h, /<a href="#" class="wl" data-nl="B.md">rel<\/a>/);
  assert.match(h, /data-nl="sub\/C.md" data-nh="Section Two">sub<\/a>/);
  assert.match(h, /<a href="#" class="wl" data-nl="B.md">B<\/a>/, "plain wikilink"); assert.match(h, /data-nl="sub\/C.md" data-nh="Section Two">spaces<\/a>/);
  assert.match(h, /<a href="#" class="wl" data-nl="B.md"><code>code<\/code> <strong>bold<\/strong><\/a>/, "markup inside link text");
  assert.match(h, /<a href="#" class="wl" data-nl="B.md">Alias<\/a>/); assert.match(h, /data-nl="sub\/C.md" data-nh="Section Two">sub\/C &gt; Section Two<\/a>/);
  assert.match(h, /<span class="unres" title="Note not found">Does not exist<\/span>/); assert.match(h, /<span class="unres" title="File not found">x<\/span>/);
  a.w.__y = 321;                                                           // reading position in A
  a.$('a[data-nl="B.md"]').click(); await tick(80);
  assert.match(a.$(".rbar .t").textContent, /^B$/);
  a.$('a[data-nl="A.md"]').click(); await tick(80); assert.match(a.$(".rbar .t").textContent, /^A$/);
  a.$('[data-act="nback"]').click(); await tick(80); assert.match(a.$(".rbar .t").textContent, /^B$/, "back goes to the previous note");
  a.$('[data-act="nback"]').click(); await tick(80); assert.match(a.$(".rbar .t").textContent, /^A$/);
  assert.equal(a.w.__y, 321, "scroll position of the previous note restored");
  a.$('a[data-nh="Section Two"]').click(); await tick(80);                // heading anchor in another note
  assert.match(a.$(".rbar .t").textContent, /^C$/); assert.ok(a.w.__scrolled.includes("h-section-two"), "scrolled to the heading");
  a.$('[data-act="nback"]').click(); await tick(60); a.$('a[data-goto="h-bottom"]').click();
  assert.ok(a.w.__scrolled.includes("h-bottom"), "in-note anchor");
});

test("images from the vault (relative, embed with size) and external images", async () => {
  const a = await withNotes({ "i": "![alt](img/p.png) ![[p.png|120]] ![ext](https://example.org/x.png) ![missing](nix.png)" }, [mk("V/img/p.png", "PNGDATA")]);
  const h = await note(a, "i");
  assert.equal(a.$$("#mdBody img.vimg").length, 2); assert.match(h, /data-vimg="img\/p.png"/); assert.match(h, /width="120"/);
  assert.match(h, /<img src="https:\/\/example.org\/x.png"[^>]*loading="lazy" referrerpolicy="no-referrer">/); assert.match(h, /<span class="unres">missing<\/span>/);
  await tick(60); assert.equal(a.$("#mdBody img.vimg").src, "blob:7", "image loaded from the stored copy");
});

test("search finds by name and content with snippets; tree lists folders", async () => {
  const a = await withNotes({ "Network": "# TCP\nThe three-way handshake starts with SYN.", "sub/Database": "# SQL\nSELECT and JOIN", "Empty": "nothing" });
  assert.ok(a.$("details[data-dir='sub']")); assert.equal(a.$$(".tf").length, 3);
  const q = a.$("#mdq"); q.value = "syn"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80);
  assert.equal(a.$$("#mdRes .hit").length, 1); assert.match(a.$("#mdRes .sn").innerHTML, /<mark>SYN<\/mark>/); assert.match(a.$("#mdRes").textContent, /Network/);
  q.value = "sql join"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80);
  assert.equal(a.$$("#mdRes .hit").length, 1); assert.match(a.$("#mdRes").textContent, /Database/);
  q.value = "zzz"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80); assert.match(a.$("#mdRes").textContent, /Nothing found/);
  q.value = "<img src=x onerror=window.__xss=1>"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80); assert.equal(a.w.__xss, undefined);
  q.value = ""; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(40); assert.equal(a.$$(".tf").length, 3);
  q.value = "handshake"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80);
  a.$("#mdRes .hit").click(); await tick(80); assert.match(a.$("#mdBody").innerHTML, /three-way handshake/);
});

test("reading position and last note survive a reload; Continue opens where you stopped", async () => {
  const a = await withNotes({ "One": "# One", "Two": "# Two\n" + "Line\n\n".repeat(50) });
  await note(a, "Two"); a.w.__y = 777; a.w.dispatchEvent(new a.w.Event("scroll")); await tick(500);
  assert.equal(a.ls("vaults")[0].last, "Two.md"); assert.ok(Object.values(a.ls("mdpos")).includes(777));
  const b = boot({ idb: a.idb, ls: a.dump() }); openTab(b);
  assert.match(b.$("#noteBody").textContent, /Last: Two/);
  b.$('[data-act="vresume"]').click(); await tick(100);
  assert.match(b.$(".rbar .t").textContent, /^Two$/); assert.equal(b.w.__y, 777);
});

test("Refresh re-reads the folder: changed/new/removed notes, state kept, old copy dropped", async () => {
  const a = await withNotes({ "Alt": "# Alt v1", "Weg": "# Weg" });
  await note(a, "Alt"); a.$('[data-act="nback"]').click(); await tick(30);
  const keys1 = (await keysOf(a.idb)).length; assert.equal(keys1, 2);
  a.$('[data-act="vrefresh"]').click();
  await addVault(a, [mk("V/Alt.md", "# Alt v2 NEU"), mk("V/Neu.md", "# Neu")]);
  const vs = a.ls("vaults"); assert.equal(vs.length, 1); assert.deepEqual(vs[0].files.map((f) => f.path).sort(), ["Alt.md", "Neu.md"]);
  assert.equal(vs[0].last, "Alt.md", "last note carried over");
  assert.equal((await keysOf(a.idb)).length, 2, "old copy removed, no leftovers");
  assert.match(await note(a, "Alt"), /Alt v2 NEU/); assert.equal(a.ls("pending"), null);
});

test("deleting a vault removes its files and positions; rename works", async () => {
  const a = await withNotes({ "X": "# X" }); await note(a, "X"); a.w.__y = 50; a.w.dispatchEvent(new a.w.Event("scroll")); await tick(500);
  a.$('[data-act="nback"]').click(); await tick(30);
  a.$('[data-act="vrename"]').click(); assert.equal(a.ls("vaults")[0].name, "My notes");
  a.$('[data-act="vdel"]').click(); await tick(60);
  assert.deepEqual(a.ls("vaults"), []); assert.deepEqual(await keysOf(a.idb), []); assert.deepEqual(a.ls("mdpos"), {}); assert.match(a.$("#noteBody").textContent, /No notes yet/);
});

test("font size buttons persist; Space scrolls instead of toggling playback in the reader", async () => {
  const a = await withNotes({ "N": "# N" }); await note(a, "N");
  a.$('[data-act="nfs+"]').click(); a.$('[data-act="nfs+"]').click(); assert.equal(a.ls("mdfs"), 1.2); assert.equal(a.$("#mdBody").style.fontSize, "120%");
  for (let i = 0; i < 9; i++) a.$('[data-act="nfs-"]').click(); assert.equal(a.ls("mdfs"), 0.8);
  const ev = new a.w.KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }); a.d.dispatchEvent(ev); assert.equal(ev.defaultPrevented, false);
  a.$('[data-mode="radio"]').click(); const ev2 = new a.w.KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }); a.d.dispatchEvent(ev2); assert.equal(ev2.defaultPrevented, true, "radio keeps its shortcut");
});

test("a vault import clears its marker, shares the import lock with books and survives corrupt storage", async () => {
  const a = boot({ ls: { tl_vaults: "[1,{\"id\":\"v1\"}]", tl_mdpos: "[]", tl_mdfs: "\"x\"" } }); openTab(a);
  assert.match(a.$("#noteBody").textContent, /No notes yet/);
  await addVault(a, [mk("T/a.md", "# a")]); assert.equal(a.ls("pending"), null); assert.equal(a.ls("vaults").length, 1);
  // a pending marker of a saved vault is only dropped, files stay
  const idb = a.idb, id = a.ls("vaults")[0].id, keys = await keysOf(idb);
  const b = boot({ idb, ls: Object.assign(a.dump(), { tl_pending: JSON.stringify({ id, n: 1, ts: 1 }) }) }); await tick(100);
  assert.equal(b.ls("pending"), null); assert.deepEqual(await keysOf(idb), keys);
});

/* ---- Code header and adding to an existing folder ---- */
test("code block: language label and copy button share a header row above the code", async () => {
  const a = await withNotes({ c: "```python\nprint(1)\n```\n\n```\nwithout language\n```" });
  await note(a, "c");
  const boxes = a.$$("#mdBody .codebox"); assert.equal(boxes.length, 2);
  const [b1, b2] = boxes;
  assert.deepEqual([...b1.children].map((e) => e.className), ["chead", "code"], "header row, then the code");
  assert.deepEqual([...b1.querySelector(".chead").children].map((e) => e.tagName + "." + e.className), ["SPAN.lang", "BUTTON.copy"], "label and button side by side in the header");
  assert.equal(b1.querySelector(".chead .lang").textContent, "python"); assert.equal(b1.querySelector("pre code").textContent, "print(1)");
  assert.equal(b1.querySelector("pre button"), null, "nothing but the code inside <pre>");
  assert.deepEqual([...b2.querySelector(".chead").children].map((e) => e.tagName), ["SPAN", "BUTTON"], "header row also without a language (copy button stays right)");
  a.w.navigator.clipboard = { writeText: (t) => { a.w.__copied = t; return Promise.resolve(); } };
  b1.querySelector("[data-copy]").click(); await tick(20); assert.equal(a.w.__copied, "print(1)");
});

async function twoFiles() {                                         // a folder that was created from single files
  const a = boot({ promptValue: "My Folder" }); openTab(a);
  await addVault(a, [mk("one.md", "# One\n[[Two]] [[Three]]")], "#pickMdFiles");
  a.$('[data-act="vopen"]').click(); await tick(30);
  return a;
}
async function addTo(a, act, files) {
  a.$(`[data-act="${act}"]`).click();
  const id = act === "vadddir" ? "#pickMd" : "#pickMdFiles";
  const inp = a.$(id); Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(300);
}

test("new files can be added to an existing folder (files, replacement, images)", async () => {
  const a = await twoFiles();
  assert.deepEqual(a.ls("vaults")[0].files.map((f) => f.path), ["one.md"]);
  const before = (await keysOf(a.idb)).length;
  await addTo(a, "vaddfiles", [mk("two.md", "# Two new"), mk("p.png", "PNG123"), mk("note.txt", "ignored")]);
  let v = a.ls("vaults")[0];
  assert.equal(a.ls("vaults").length, 1, "same folder, not a new one"); assert.equal(v.name, "My Folder");
  assert.deepEqual(v.files.map((f) => f.path).sort(), ["one.md", "p.png", "two.md"]); assert.equal((await keysOf(a.idb)).length, before + 2);
  assert.equal(a.ls("pending"), null); assert.match(a.$("#toast").textContent, /2 new/);
  assert.ok(a.$$(".tf").some((b) => b.textContent === "two"), "new note appears in the tree");
  // wikilink to the new note now resolves
  a.$$(".tf").find((b) => b.textContent === "one").click(); await tick(80);
  assert.match(a.$("#mdBody").innerHTML, /data-nl="two.md">Two<\/a>/); assert.match(a.$("#mdBody").innerHTML, /unres[^>]*>Three</);
  // adding a file with an existing path replaces it in place (same key, no new file)
  a.$('[data-act="nback"]').click(); await tick(30);
  const keys = (await keysOf(a.idb)).length, ids = v.files.map((f) => f.id).sort();
  await addTo(a, "vaddfiles", [mk("TWO.md", "# Two REPLACED content longer"), mk("three.md", "# Three")]);
  v = a.ls("vaults")[0];
  assert.equal(v.files.length, 4); assert.equal((await keysOf(a.idb)).length, keys + 1, "only three.md is a new key");
  assert.deepEqual(v.files.filter((f) => ids.includes(f.id)).map((f) => f.id).sort(), ids, "existing keys unchanged");
  assert.match(a.$("#toast").textContent, /1 new, 1 replaced/);
  assert.match(await note(a, "two"), /REPLACED/);
});

test("a folder can be added as a subfolder of an existing folder", async () => {
  const a = await twoFiles();
  await addTo(a, "vadddir", [mk("Chapter 3/a.md", "# A"), mk("Chapter 3/img/x.png", "X"), mk("Chapter 3/.obsidian/c.md", "hidden")]);
  const v = a.ls("vaults")[0];
  assert.deepEqual(v.files.map((f) => f.path).sort(), ["Chapter 3/a.md", "Chapter 3/img/x.png", "one.md"]);
  assert.ok(a.$("details[data-dir='Chapter 3']"), "folder shows up in the tree");
});

test("an interrupted add is cleaned up at the next start: only new unreferenced files go", async () => {
  const idb = new IDBFactory();
  const put = (...ks) => Promise.all(ks.map((k) => idbOp(idb, (os) => os.put(new Blob(["x"]), k))));
  await put("vA/k0", "vA/k1", "vA/k2", "vA/k3");
  const vault = { id: "vA", name: "A", created: 1, last: null, files: [{ id: "k0", path: "a.md", kind: "md", size: 1, mod: 1 }, { id: "k1", path: "b.md", kind: "md", size: 1, mod: 1 }, { id: "k2", path: "c.md", kind: "md", size: 1, mod: 1 }] };
  // add of k2..k3 was interrupted: k2 already registered in the saved vault, k3 is an orphan
  const a = boot({ idb, ls: { tl_vaults: JSON.stringify([vault]), tl_pending: JSON.stringify({ id: "vA", n: 2, from: 2, ts: 1 }) } }); await tick(150);
  assert.deepEqual((await keysOf(idb)).sort(), ["vA/k0", "vA/k1", "vA/k2"], "existing and registered files stay, orphan removed");
  assert.equal(a.ls("pending"), null);
});

test("a failing add removes only the new files and keeps the folder intact", async () => {
  const a = await twoFiles(), keys = await keysOf(a.idb);
  const bad = { name: "kaputt.md", size: 1, type: "text/markdown", lastModified: 1, nope() {} };      // not clonable -> put fails
  await addTo(a, "vaddfiles", [mk("gut.md", "# gut"), bad]);
  assert.deepEqual(a.ls("vaults")[0].files.map((f) => f.path), ["one.md"]); assert.deepEqual(await keysOf(a.idb), keys, "no orphaned copies");
  assert.equal(a.ls("pending"), null); assert.match(a.$("#toast").textContent, /failed/);
});

test("the add buttons never leak into creating a new folder", async () => {
  const a = await twoFiles();
  a.$('[data-act="vaddfiles"]').click();                                 // user opens the dialog and cancels: no change event
  a.$('[data-act="vback"]').click(); a.$('[data-act="vfiles"]').click();   // later: create a new folder from single files
  const inp = a.$("#pickMdFiles"); Object.defineProperty(inp, "files", { value: [mk("new.md", "# New"), mk("new2.md", "# New 2")], configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(300);
  assert.equal(a.ls("vaults").length, 2, "a second folder was created instead of adding to the first");
});

/* ---- Code review: several tabs, file names like object properties, deleting during refresh/add ---- */
const blobText = async (idb, key) => { const b = await idbOp(idb, (os) => os.get(key)); return b && (await b.text()); };

test("two tabs: an add from a stale tab reloads the saved folder and never reuses keys", async () => {
  const storage = sharedStorage(), idb = new IDBFactory(), locks = newLocks();
  const A = boot({ idb, locks, storage, promptValue: "Shared" }); openTab(A); await addVault(A, [mk("start.md", "# Start")], "#pickMdFiles"); A.$('[data-act="vopen"]').click(); await tick(30);
  const B = boot({ idb, locks, storage }); openTab(B); B.$('[data-act="vopen"]').click(); await tick(30);        // B holds the folder in memory
  await addTo(A, "vaddfiles", [mk("a1.md", "# A one"), mk("a2.md", "# A two")]);
  await addTo(B, "vaddfiles", [mk("b1.md", "# B one"), mk("b2.md", "# B two")]);                                  // stale tab adds second
  const saved = JSON.parse(storage.getItem("tl_vaults"))[0];
  assert.equal(saved.files.length, 5, "both additions saved"); assert.equal(new Set(saved.files.map((f) => f.id)).size, 5, "unique keys");
  for (const f of saved.files) assert.equal(await blobText(idb, saved.id + "/" + f.id), f.path === "start.md" ? "# Start" : "# " + f.path.replace(".md", "").replace(/^(.)(\d)/, (m, l, d) => l.toUpperCase() + " " + ({ 1: "one", 2: "two" })[d]), f.path + " has its own content");
});

test("note, folder and heading names that match Object.prototype members do not break anything", async () => {
  const names = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
  const files = names.map((n) => mk("V/" + n + ".md", "# " + n + "\n\nSee [[constructor]] and [[__proto__]]. Footnote[^constructor].\n\n> [!constructor] Own type\n> Text\n\n```constructor\nx\n```\n\n```__proto__\ny\n```\n\n[^constructor]: Note."))
    .concat(names.map((n) => mk("V/" + n + "/inner.md", "# Inside " + n)), [mk("V/img/constructor.png", "PNG"), mk("V/image.md", "![[constructor.png]] ![x](img/constructor.png)")]);
  const a = boot(); openTab(a); await addVault(a, files);
  assert.equal(a.ls("vaults").length, 1, "imported");
  a.$('[data-act="vopen"]').click(); await tick(50);
  assert.deepEqual(a.w.__errors, [], "opening the vault throws nothing");
  for (const n of names) { assert.ok(a.$(`details[data-dir="${n}"]`), "folder " + n + " in the tree"); assert.ok(a.$$(".tf").some((b) => b.textContent === n), "note " + n); }
  const h = await note(a, "constructor");
  assert.match(h, /<h1 id="h-constructor">constructor<\/h1>/);
  assert.match(h, /data-nl="constructor.md">constructor<\/a>/); assert.match(h, /data-nl="__proto__.md">__proto__<\/a>/, "wikilinks resolve");
  assert.match(h, /<sup class="fnref"><a href="#" id="fnref-constructor" data-goto="fn-constructor">1<\/a>/); assert.match(h, /<li id="fn-constructor">Note\./);
  assert.match(h, /data-type="constructor"/); assert.doesNotMatch(h, /function Object|native code/, "unknown callout type falls back to the default colour");
  assert.equal(a.$$("#mdBody .codebox").length, 2);
  assert.match(await note(a, "__proto__"), /<h1 id="h-proto"><strong>proto<\/strong><\/h1>/, "__x__ is bold in Markdown, the note still opens");
  assert.match(await note(a, "image"), /data-vimg="img\/constructor.png"/);
  // search and reload keep working
  const q = a.$("#mdq") || (a.$('[data-act="nback"]').click(), a.$("#mdq")); q.value = "proto"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80);
  assert.ok(a.$$("#mdRes .hit").length >= 1); assert.deepEqual(a.w.__errors, []);
  const b = boot({ idb: a.idb, ls: a.dump() }); openTab(b); b.$('[data-act="vopen"]').click(); await tick(50); assert.deepEqual(b.w.__errors, []); assert.ok(b.$$(".tf").length >= 7);
});

// two vaults, the second one with linked notes; returns the tab in the library view
async function twoVaults(opts) {
  const a = boot(Object.assign({ confirm: true }, opts)); openTab(a);
  await addVault(a, [mk("Alpha/a.md", "# A")]);
  await addVault(a, [mk("Beta/b1.md", "# B1\n[[b2]]"), mk("Beta/b2.md", "# B2")]);
  return a;
}
const vaultBtn = (a, name, act) => a.$$(".pod-row.bk").find((r) => r.querySelector(".pod-ti").textContent === name).querySelector(`[data-act="${act}"]`);

test("refreshing vault A while reading in vault B leaves B's reader fully working", async () => {
  const locks = newLocks(); let release, gate = new Promise((r) => (release = r)), gateOn = false;
  const a = await twoVaults({ locks, lockHooks: { beforeGrant: async (name) => { if (gateOn && name.startsWith("tl-import-")) await gate; } } });
  vaultBtn(a, "Alpha", "vopen").click(); await tick(30);
  gateOn = true; a.$('[data-act="vrefresh"]').click();
  const inp = a.$("#pickMd"); Object.defineProperty(inp, "files", { value: [mk("Alpha/a.md", "# A new"), mk("Alpha/a2.md", "# A2")], configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(30);                                       // refresh of A is under way (waiting for its lock)
  a.$('[data-act="vback"]').click(); vaultBtn(a, "Beta", "vopen").click(); await tick(30); a.$$(".tf").find((b) => b.textContent === "b1").click(); await tick(80);
  assert.match(a.$(".rbar .t").textContent, /^b1$/);
  release(); gateOn = false; await tick(400);                                                       // refresh of A completes
  assert.equal(a.ls("vaults").find((v) => v.name === "Alpha").files.length, 2, "A was refreshed");
  a.$('a[data-nl="b2.md"]').click(); await tick(80);                                                // link inside B's reader
  assert.match(a.$(".rbar .t").textContent, /^b2$/, "navigation in B still works"); assert.deepEqual(a.w.__errors, []);
});

test("deleting a vault while its Refresh is copying leaves no orphaned replacement", async () => {
  const locks = newLocks(); let release, gate = new Promise((r) => (release = r)), gateOn = false;
  const a = await twoVaults({ locks, lockHooks: { beforeGrant: async (name) => { if (gateOn && name.startsWith("tl-import-")) await gate; } } });
  const betaIdBefore = a.ls("vaults").find((v) => v.name === "Beta").id;
  vaultBtn(a, "Alpha", "vopen").click(); await tick(30);
  gateOn = true;
  a.$('[data-act="vdel"]').click();                                                                // delete is requested first ...
  a.$('[data-act="vrefresh"]').click(); const inp = a.$("#pickMd");
  Object.defineProperty(inp, "files", { value: [mk("Alpha/a.md", "# A new"), mk("Alpha/a2.md", "# A2")], configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(30);                                       // ... the refresh right after
  release(); gateOn = false; await tick(500);
  assert.deepEqual(a.ls("vaults").map((v) => v.name), ["Beta"], "Alpha is gone and was not resurrected");
  const keys = await keysOf(a.idb); assert.deepEqual(keys.filter((k) => !k.startsWith(betaIdBefore + "/")), [], "no orphaned blobs of the replacement or of Alpha");
  assert.equal(a.ls("pending"), null);
});

for (const [label, deleteFirst] of [["delete requested before the add", true], ["add requested before the delete", false]]) {
  test("deleting a vault during a replace-only add leaves nothing behind (" + label + ")", async () => {
    const locks = newLocks(); let release, gate = new Promise((r) => (release = r)), gateOn = false;
    const a = boot({ locks, lockHooks: { beforeGrant: async (name) => { if (gateOn && name.startsWith("tl-import-")) await gate; } } }); openTab(a);
    await addVault(a, [mk("Solo/x.md", "# X"), mk("Solo/y.md", "# Y")]); a.$('[data-act="vopen"]').click(); await tick(30);
    gateOn = true;
    const doAdd = async () => { a.$('[data-act="vaddfiles"]').click(); const inp = a.$("#pickMdFiles"); Object.defineProperty(inp, "files", { value: [mk("x.md", "# X replaced"), mk("y.md", "# Y replaced")], configurable: true }); inp.dispatchEvent(new a.w.Event("change")); await tick(30); };
    if (deleteFirst) { a.$('[data-act="vdel"]').click(); await doAdd(); } else { await doAdd(); a.$('[data-act="vdel"]').click(); }
    await tick(30); release(); gateOn = false; await tick(600);
    assert.deepEqual(a.ls("vaults"), [], "vault deleted"); assert.deepEqual(await keysOf(a.idb), [], "no orphaned blobs, also none from the replacement batch"); assert.equal(a.ls("pending"), null);
  });
}

/* ---- Code review: simultaneous deleting, deleting/adding behind a refresh ---- */
for (const withLocks of [false, true]) {
  test("deleting two folders at once removes exactly those two (" + (withLocks ? "with" : "without") + " Web Locks)", async () => {
    const a = boot(Object.assign({ confirm: true }, withLocks ? { locks: newLocks() } : {})); openTab(a);
    await addVault(a, [mk("Folder A/a.md", "# A")]);
    await addVault(a, [mk("Folder B/b.md", "# B"), mk("Folder B/b2.md", "# B2")]);
    await addVault(a, [mk("Folder C/c.md", "# C"), mk("Folder C/c2.md", "# C2"), mk("Folder C/c3.md", "# C3")]);
    assert.equal(a.$$('[data-act="vdel"]').length, 3);
    const [delA, delB] = a.$$('[data-act="vdel"]'); delA.click(); delB.click(); await tick(400);
    assert.deepEqual(a.ls("vaults").map((v) => v.name), ["Folder C"], "only C is left");
    const keys = await keysOf(a.idb), cid = a.ls("vaults")[0].id;
    assert.ok(keys.length === 3 && keys.every((k) => k.startsWith(cid + "/")), "no files of A or B left, C intact");
  });
}

function gatedBoot() {
  const locks = newLocks(); let release, gate = new Promise((r) => (release = r)), on = false;
  const hooks = { beforeGrant: async (name) => { if (on && name.startsWith("tl-import-")) await gate; } };
  return { locks, hooks, open: () => { on = true; }, release: () => { on = false; release(); } };
}
async function startRefresh(a, files) {
  a.$('[data-act="vrefresh"]').click();
  const inp = a.$("#pickMd"); Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(30);
}

test("a delete queued behind a refresh of the same folder deletes the refreshed folder, not nothing", async () => {
  const g = gatedBoot(), a = boot({ locks: g.locks, lockHooks: g.hooks, confirm: true }); openTab(a);
  await addVault(a, [mk("Alpha/a.md", "# A")]); a.$('[data-act="vopen"]').click(); await tick(30);
  g.open();
  await startRefresh(a, [mk("Alpha/a.md", "# A new"), mk("Alpha/a2.md", "# A2")]);              // refresh first ...
  a.$('[data-act="vdel"]').click(); await tick(30);                                              // ... delete queued behind it
  g.release(); await tick(600);
  assert.deepEqual(a.ls("vaults"), [], "the confirmed deletion was carried to the refreshed folder");
  assert.deepEqual(await keysOf(a.idb), [], "no files left"); assert.equal(a.ls("pending"), null);
});

test("an add from another tab queued behind a refresh lands in the refreshed folder", async () => {
  const g = gatedBoot(), storage = sharedStorage(), idb = new IDBFactory();
  const A = boot({ idb, storage, locks: g.locks, lockHooks: g.hooks }); openTab(A);
  await addVault(A, [mk("Alpha/a.md", "# A")]); A.$('[data-act="vopen"]').click(); await tick(30);
  const B = boot({ idb, storage, locks: g.locks, lockHooks: g.hooks }); openTab(B); B.$('[data-act="vopen"]').click(); await tick(30);      // B still knows the old folder id
  g.open();
  await startRefresh(A, [mk("Alpha/a.md", "# A new"), mk("Alpha/a2.md", "# A2")]);                       // tab A refreshes (new folder id) ...
  B.$('[data-act="vaddfiles"]').click(); const inp = B.$("#pickMdFiles");
  Object.defineProperty(inp, "files", { value: [mk("extra.md", "# Extra")], configurable: true }); inp.dispatchEvent(new B.w.Event("change")); await tick(30);   // ... tab B adds meanwhile
  g.release(); await tick(900);
  const vs = JSON.parse(storage.getItem("tl_vaults")); assert.equal(vs.length, 1, "still one folder");
  assert.deepEqual(vs[0].files.map((f) => f.path).sort(), ["a.md", "a2.md", "extra.md"], "B's add was not lost");
  assert.equal((await keysOf(idb)).length, 3, "no orphaned files"); assert.equal(storage.getItem("tl_pending"), "null");
});

/* ---- Code review: marker after refresh, reader after deleting in another tab ---- */
test("the pending marker of an add that followed a refresh always names the folder that is written to", async () => {
  const g = gatedBoot(), storage = sharedStorage(), idb = new IDBFactory();
  const A = boot({ idb, storage, locks: g.locks, lockHooks: g.hooks }); openTab(A);
  await addVault(A, [mk("Alpha/a.md", "# A")]); A.$('[data-act="vopen"]').click(); await tick(30);
  const oldId = JSON.parse(storage.getItem("tl_vaults"))[0].id;
  const B = boot({ idb, storage, locks: g.locks, lockHooks: g.hooks }); openTab(B); B.$('[data-act="vopen"]').click(); await tick(30);      // B still knows the old id
  g.open();
  await startRefresh(A, [mk("Alpha/a.md", "# A new")]);                                                  // tab A refreshes (new id) ...
  const many = Array.from({ length: 40 }, (_, i) => mk("n" + String(i).padStart(2, "0") + ".md", "# n" + i));
  B.$('[data-act="vaddfiles"]').click(); const inp = B.$("#pickMdFiles");
  Object.defineProperty(inp, "files", { value: many, configurable: true }); inp.dispatchEvent(new B.w.Event("change")); await tick(30);        // ... tab B adds new files behind it
  g.release();
  const ids = new Set(); let saved = null;
  for (let i = 0; i < 600 && !(saved && saved.files.length === 41); i++) {
    await tick(2);
    const p = JSON.parse(storage.getItem("tl_pending") || "null"); if (p && p.from != null) ids.add(p.id);
    saved = (JSON.parse(storage.getItem("tl_vaults") || "[]")[0]) || null;
  }
  assert.equal(saved.files.length, 41, "add completed in the refreshed folder");
  assert.ok(ids.size >= 1, "the add wrote markers"); assert.deepEqual([...ids], [saved.id], "every marker names the folder that is written to");
  assert.ok(!ids.has(oldId), "never the removed folder's id");
});

test("a folder removed by another tab while a note is still loading does not bring back a dead reader", async () => {
  const storage = sharedStorage(), idb = new IDBFactory(), locks = newLocks();
  const A = boot({ idb, storage, locks, confirm: true }); openTab(A);
  await addVault(A, [mk("Weg/n.md", "# N")]); A.$('[data-act="vopen"]').click(); await tick(30);
  const orig = Blob.prototype.text; let open; const gate = new Promise((r) => (open = r));
  Blob.prototype.text = function () { return gate.then(() => orig.call(this)); };                           // makes reading a note slow
  try {
    A.$(".tf").click(); await tick(60);                                                                    // A starts loading the note
    const B = boot({ idb, storage, locks, confirm: true }); openTab(B); B.$('[data-act="vdel"]').click(); await tick(300);   // another tab deletes the folder
    assert.deepEqual(JSON.parse(storage.getItem("tl_vaults")), []);
    A.$('[data-act="vdel"]').click(); await tick(100);                                                      // A confirms deleting what is already gone
    open(); await tick(200);                                                                               // the pending read finally completes
    assert.equal(A.$(".rbar"), null, "no reader for a deleted note");
    assert.match(A.$("#noteBody").textContent, /No notes yet/, "the library is shown");
    assert.deepEqual(A.w.__errors, []);
  } finally { Blob.prototype.text = orig; open(); }
});
