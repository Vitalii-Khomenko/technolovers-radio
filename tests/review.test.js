// Regression tests for the full review (fix/full-review). Not part of the repo.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const html = fs.readFileSync(process.env.HTML || "index.html", "utf8");
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function sharedStorage() { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
function boot(opts = {}) {
  const idb = opts.idb || new IDBFactory();
  const dom = new JSDOM(html, {
    url: "https://example.test/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.__audios = [];
      w.Audio = class {
        constructor() { this._l = {}; this._src = ""; this.volume = 1; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = NaN; this.playbackRate = 1; w.__audios.push(this); }
        set src(v) { this._src = v; this.ended = false; this.currentTime = 0; } get src() { return this._src; }
        getAttribute(a) { return a === "src" ? this._src || null : null; }
        get currentSrc() { return this._src; }
        addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
        emit(t) { (this._l[t] || []).forEach((f) => f()); }
        removeAttribute(a) { if (a === "src") this._src = ""; }
        load() {} play() { this.paused = false; return Promise.resolve(); }
        pause() { if (!this.paused) { this.paused = true; setTimeout(() => this.emit("pause"), 0); } }
      };
      w.indexedDB = idb; w.__errors = []; w.addEventListener("error", (e) => w.__errors.push(String(e.message)));
      if (opts.storage) { const P = w.Storage.prototype; P.getItem = (k) => opts.storage.getItem(k); P.setItem = (k, v) => opts.storage.setItem(k, v); P.removeItem = (k) => opts.storage.removeItem(k); }
      w.__revoked = []; w.URL.createObjectURL = (b) => "blob:" + b.size; w.URL.revokeObjectURL = (u) => w.__revoked.push(u);
      w.__y = 0; w.scrollTo = (x, y) => { w.__y = y; }; Object.defineProperty(w, "scrollY", { get: () => w.__y, configurable: true });
      w.Element.prototype.scrollIntoView = function () {};
      w.confirm = () => true; w.prompt = () => "Neu";
      if (opts.fetch) w.fetch = opts.fetch;
      if (opts.ms) { w.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
        Object.defineProperty(w.navigator, "mediaSession", { value: { playbackState: "none", metadata: null, handlers: {}, setActionHandler(n, f) { this.handlers[n] = f; } }, configurable: true }); }
      Object.entries(opts.ls || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, idb, radio: w.__audios[0], pod: w.__audios[1], $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
    ls: (k) => JSON.parse(w.localStorage.getItem("tl_" + k)) };
}
function mk(rel, content, type) {
  const f = new File([content], rel.split("/").pop(), { type: type || (/\.md$/.test(rel) ? "text/markdown" : "audio/mpeg"), lastModified: 1000 });
  if (rel.includes("/")) Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
}
async function pick(a, sel, files) { const inp = a.$(sel); Object.defineProperty(inp, "files", { value: files, configurable: true }); inp.dispatchEvent(new a.w.Event("change")); await tick(250); }
// tell window a that another tab wrote key k (real browsers fire "storage" only in the other tabs)
function storageEvent(a, k) { a.w.dispatchEvent(new a.w.StorageEvent("storage", { key: "tl_" + k })); }
async function vaultWith(a, notes, name = "V") { a.$('[data-mode="note"]').click(); await pick(a, "#pickMd", Object.entries(notes).map(([n, c]) => mk(name + "/" + n + ".md", c))); }
async function openVault(a, vaultName) {
  const row = a.$$("#noteBody .pod-row").find((r) => r.querySelector(".pod-ti").textContent === vaultName);
  row.querySelector('[data-act="vopen"]').click(); await tick(30);
}
async function openNote(a, vaultName, title) {
  await openVault(a, vaultName);
  a.$$(".tf").find((b) => b.textContent === title).click(); await tick(80);
}
async function render(md, extra = {}) {
  const a = boot(); await vaultWith(a, Object.assign({ N: md }, extra)); await openNote(a, "V", "N");
  return a.$("#mdBody").innerHTML;
}

/* ---------- multi-tab ---------- */
test("opening a note in a stale tab keeps a folder imported in another tab", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); await vaultWith(a, { One: "# 1" }, "A");
  const b = boot({ storage, idb }); await vaultWith(b, { Two: "# 2" }, "B");
  assert.deepEqual(b.ls("vaults").map((v) => v.name), ["A", "B"]);
  await openNote(a, "A", "One");                                                     // a has not seen B yet (no storage event)
  assert.deepEqual(a.ls("vaults").map((v) => v.name).sort(), ["A", "B"], "B must survive");
});
test("reordering a book in a stale tab keeps a book imported in another tab", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x"), mk("A/2.mp3", "xx")]);
  const b = boot({ storage, idb }); b.$('[data-mode="book"]').click(); await pick(b, "#pickDir", [mk("B/1.mp3", "xxx")]);
  a.$$('[data-act="tdown"]')[0].click();
  assert.deepEqual(a.ls("books").map((x) => x.name).sort(), ["A", "B"]);
  assert.deepEqual(a.ls("books").find((x) => x.name === "A").tracks.map((t) => t.name), ["2", "1"]);
});
test("another tab's new book shows up after a storage event", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); a.$('[data-mode="book"]').click();
  const b = boot({ storage, idb }); b.$('[data-mode="book"]').click(); await pick(b, "#pickDir", [mk("B/1.mp3", "xxx")]);
  storageEvent(a, "books");
  assert.match(a.$("#bookBody").textContent, /1 book\b/);
  assert.ok(a.$$("#bookBody .pod-ti").some((e) => e.textContent === "B"));
});

/* ---------- radio ---------- */
test("previous with no station of the current filter selected goes to the last one", () => {
  const a = boot();
  a.$('[data-cat="bass"]').click();
  a.$("#prev").click();
  assert.match(a.$("#dockT").textContent, /Dub Step Beyond/);
});
test("Space on a focused select does not toggle playback", () => {
  const a = boot();
  const sel = a.d.createElement("select"); a.d.body.appendChild(sel);
  sel.dispatchEvent(new a.w.KeyboardEvent("keydown", { code: "Space", bubbles: true }));
  assert.equal(a.radio.src, "");
});
test("Alt+Arrow (browser back) does not switch station", () => {
  const a = boot();
  a.d.body.dispatchEvent(new a.w.KeyboardEvent("keydown", { code: "ArrowLeft", altKey: true, bubbles: true }));
  assert.equal(a.radio.src, "");
});

/* ---------- podcast / book player ---------- */
test("pause while a chapter is still loading cancels the start", async () => {
  const a = boot();
  a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x"), mk("A/2.mp3", "xx")]);
  a.$('[data-act="tplay"]').click();
  a.$("#play").click();                        // pause right away, before the file is read from IndexedDB
  await tick(80);
  assert.equal(a.pod.paused, true, "must not start after pause");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Play");
  a.$("#play").click(); await tick(80);         // play again: starts the same chapter
  assert.equal(a.pod.paused, false); assert.equal(a.pod.src, "blob:1");
});
test("deleting the playing book releases its object URL", async () => {
  const a = boot();
  a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "xyz")]);
  a.$('[data-act="tplay"]').click(); await tick(60);
  assert.equal(a.pod.src, "blob:3");
  a.$('.kinds [data-act="bdel"]').click(); await tick(60);
  assert.ok(a.w.__revoked.includes("blob:3"));
});

/* ---------- notes ---------- */
test("search snippet does not break HTML entities", async () => {
  const a = boot(); await vaultWith(a, { N: "Tom & Jerry and amp" });
  await openVault(a, "V");
  const q = a.$("#mdq"); q.value = "amp"; q.dispatchEvent(new a.w.Event("input", { bubbles: true })); await tick(80);
  assert.equal(a.$(".sn").textContent, "Tom & Jerry and amp");
  assert.equal(a.$$(".sn mark").length, 1);
});
test("wikilink with a folder only matches whole folder names", async () => {
  const a = boot(); a.$('[data-mode="note"]').click();
  await pick(a, "#pickMd", [mk("V/N.md", "[[b/X]] [[ab/X]]"), mk("V/ab/X.md", "x")]);
  await openNote(a, "V", "N");
  const h = a.$("#mdBody").innerHTML;
  assert.equal((h.match(/data-nl=/g) || []).length, 1, h);
});
test("empty front matter is not rendered as rules", async () => {
  const h = await render("---\n---\nText");
  assert.doesNotMatch(h, /<hr>/); assert.match(h, /Text/);
});
test("bare URL followed by inline code does not swallow the code", async () => {
  const h = await render("see https://example.com`x`");
  assert.match(h, /href="https:\/\/example\.com"/);
});
test("a failed link does not leave a stale back entry", async () => {
  const a = boot(); a.$('[data-mode="note"]').click();
  await pick(a, "#pickMd", [mk("V/N.md", "[[M]]"), mk("V/M.md", "m")]);
  await openNote(a, "V", "N");
  // make the target unreadable: remove its file from IndexedDB
  const v = a.ls("vaults")[0], m = v.files.find((f) => f.path === "M.md");
  await new Promise((res) => { const r = a.idb.open("tl_pod", 1); r.onsuccess = () => { const tx = r.result.transaction("files", "readwrite"); tx.objectStore("files").delete(v.id + "/" + m.id); tx.oncomplete = () => { r.result.close(); res(); }; }; });
  a.$("a[data-nl]").click(); await tick(80);
  assert.equal(a.$('[data-act="nback"]').getAttribute("aria-label"), "To the folder overview");
  a.$('[data-act="nback"]').click(); await tick(60);
  assert.ok(a.$("#mdq"), "back goes to the folder, not to N again");
});
test("scroll timer after leaving the reader does not store a null key", async () => {
  const a = boot(); await vaultWith(a, { N: "x" }); await openNote(a, "V", "N");
  a.w.__y = 300; a.w.dispatchEvent(new a.w.Event("scroll"));
  a.$('[data-act="nback"]').click(); await tick(450);
  assert.ok(!Object.keys(a.ls("mdpos") || {}).some((k) => /\/null$/.test(k)), JSON.stringify(a.ls("mdpos")));
});

/* ---------- more multi-tab ---------- */
test("folder deleted in another tab while reading: storage event closes the reader", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); await vaultWith(a, { One: "# 1" }, "A"); await openNote(a, "A", "One");
  const b = boot({ storage, idb }); b.$('[data-mode="note"]').click();
  b.$('[data-act="vdel"]').click(); await tick(120);
  assert.deepEqual(b.ls("vaults"), []);
  storageEvent(a, "vaults");
  assert.equal(a.$(".rbar"), null); assert.match(a.$("#noteBody").textContent, /No notes yet/);
});
test("opening a note does not bring back a folder deleted in another tab", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); await vaultWith(a, { One: "# 1", Two: "# 2" }, "A"); await openVault(a, "A");
  storage.setItem("tl_vaults", "[]");                    // another tab removed the entry; its files are still being dropped
  a.$$(".tf").find((x) => x.textContent === "Two").click(); await tick(80);       // a never got the event
  assert.deepEqual(a.ls("vaults"), []);
});
test("folder refreshed in another tab: the reader follows the successor", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); await vaultWith(a, { One: "old" }, "A"); await openNote(a, "A", "One");
  const b = boot({ storage, idb }); b.$('[data-mode="note"]').click(); b.$('[data-act="vopen"]').click(); await tick(30);
  b.w.HTMLInputElement.prototype.click = function () {};
  b.$('[data-act="vrefresh"]').click();
  await pick(b, "#pickMd", [mk("A/One.md", "new text")]);
  const nv = b.ls("vaults")[0]; assert.ok(nv.replaces && nv.replaces.length === 1);
  storageEvent(a, "mdpos"); storageEvent(a, "vaults"); await tick(80);
  assert.match(a.$("#mdBody").textContent, /new text/);
  a.$('[data-act="nback"]').click(); await tick(30);
  assert.ok(a.$("#mdq"), "back still works (folder view of the successor)");
});
test("adding chapters to a book deleted meanwhile says so instead of creating a new book", async () => {
  const a = boot(); a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x")]);
  a.w.HTMLInputElement.prototype.click = function () {};
  a.$('[data-act="badddir"]').click();
  a.w.localStorage.setItem("tl_books", "[]"); storageEvent(a, "books");
  await pick(a, "#pickDir", [mk("A/2.mp3", "xx")]);
  assert.deepEqual(a.ls("books"), []); assert.match(a.$("#toast").textContent, /no longer exists/);
});

/* ---------- podcasts ---------- */
test("downloaded episode whose file is missing streams via https", async () => {
  const ep = { id: "9", title: "E", show: "S", showId: "1", art: "", url: "http://x.test/9.mp3", ms: 0, date: "", size: 3, ts: 1 };
  const a = boot({ ls: { tl_dl: JSON.stringify({ 9: ep }), tl_view: '"pod"' } });
  a.$('[data-ptab="dl"]').click();
  a.$('[data-act="play"]').click(); await tick(60);
  assert.equal(a.pod.src, "https://x.test/9.mp3");
  a.pod.emit("error");                                           // https variant missing: original is tried once
  assert.equal(a.pod.src, "http://x.test/9.mp3");
});

/* ---------- service worker ---------- */
function loadSw(fetchImpl) {
  const listeners = {}, cache = new Map();
  const self = { location: { origin: "https://app.test" }, addEventListener: (t, f) => (listeners[t] = f), skipWaiting() {}, clients: { claim() {} } };
  const caches = { open: async () => ({ put: async (r, res) => cache.set(r.url, res), addAll: async () => {} }),
    match: async (r) => cache.get(typeof r === "string" ? "https://app.test/" + r.replace("./", "") : r.url), keys: async () => [] };
  new Function("self", "caches", "fetch", "Response", fs.readFileSync(process.env.SW || "sw.js", "utf8"))(self, caches, fetchImpl, Response);
  return { listeners, cache };
}
async function swFetch(sw, url, mode = "no-cors") {
  let p; const waits = [];
  sw.listeners.fetch({ request: { url, method: "GET", mode }, respondWith: (x) => (p = x), waitUntil: (x) => waits.push(x) });
  const res = await p; await Promise.all(waits); return res;
}
// test responses have type "default"; real same-origin fetches are "basic"
const basic = (body, status) => { const r = new Response(body, { status }); Object.defineProperty(r, "type", { value: "basic" }); r.clone = () => basic(body, status); return r; };
test("service worker: no error pages in the cache, app page only as offline fallback for navigations", async () => {
  let online = true;
  const sw = loadSw(async (req) => { if (!online) throw new TypeError("offline"); return /missing/.test(req.url) ? basic("nf", 404) : basic("ok", 200); });
  await swFetch(sw, "https://app.test/index.html"); await swFetch(sw, "https://app.test/missing.png");
  assert.ok(sw.cache.has("https://app.test/index.html"));
  assert.ok(!sw.cache.has("https://app.test/missing.png"), "404 must not be cached");
  online = false;
  assert.equal((await swFetch(sw, "https://app.test/other.png")).type, "error", "no index.html for an image");
  assert.equal(await (await swFetch(sw, "https://app.test/some/page", "navigate")).text(), "ok", "navigation falls back to the app page");
});

/* ---------- PR #11 review follow-ups ---------- */
test("chapter marked heard in another tab: rows refresh and the button does what it shows", async () => {
  const storage = sharedStorage(), idb = new IDBFactory();
  const a = boot({ storage, idb }); a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x"), mk("A/2.mp3", "xx")]);
  const k = a.ls("books")[0].id + "/k0";
  const btn0 = () => a.$('[data-trk="k0"] [data-act="tdone"]');
  assert.equal(btn0().getAttribute("aria-label"), "Mark as heard");
  storage.setItem("tl_done", JSON.stringify({ [k]: 1 }));          // other tab marks chapter 1 heard
  // even before the event arrives, clicking the stale "mark heard" button must keep it heard
  btn0().click();
  assert.equal(a.ls("done")[k], 1, "stale click must not undo the other tab's completion");
  // after an event the row shows the new state
  storage.setItem("tl_done", "{}"); storageEvent(a, "done");
  assert.equal(btn0().getAttribute("aria-label"), "Mark as heard");
  storage.setItem("tl_done", JSON.stringify({ [k]: 1 })); storageEvent(a, "done");
  assert.equal(btn0().getAttribute("aria-label"), "Mark as unheard");
  assert.ok(a.$('[data-trk="k0"]').classList.contains("done"));
});
test("canceling a pending start sets the Media Session to paused", async () => {
  const a = boot({ ms: true });
  a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x"), mk("A/2.mp3", "xx")]);
  const ms = a.w.navigator.mediaSession;
  a.$('[data-act="tplay"]').click(); await tick(80); a.pod.emit("playing");
  assert.equal(ms.playbackState, "playing");
  a.$$('[data-act="tplay"]')[1].click();                           // switch chapter: IndexedDB read pending
  ms.handlers.pause();                                             // lock-screen pause during the read
  assert.equal(ms.playbackState, "paused");
  await tick(80); assert.equal(a.pod.paused, true);
});
test("Media Session leaves 'playing' when the last chapter ends and when the playing book is deleted", async () => {
  const a = boot({ ms: true });
  a.$('[data-mode="book"]').click(); await pick(a, "#pickDir", [mk("A/1.mp3", "x")]);
  const ms = a.w.navigator.mediaSession;
  a.$('[data-act="tplay"]').click(); await tick(80); a.pod.emit("playing");
  a.pod.ended = true; a.pod.paused = true; a.pod.emit("ended");
  assert.equal(ms.playbackState, "paused");
  a.$('[data-act="tplay"]').click(); await tick(80); a.pod.emit("playing");
  a.$('.kinds [data-act="bdel"]').click(); await tick(80);
  assert.equal(ms.playbackState, "none");
});
