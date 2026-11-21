const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const html = fs.readFileSync(process.env.HTML || "index.html", "utf8");
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// localStorage shared between several windows ("tabs" of one browser profile)
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
      w.Audio = class {
        constructor() { this._l = {}; this._src = ""; this.volume = 1; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = NaN; this.playbackRate = 1; w.__audios.push(this); }
        set src(v) { this._src = v; this.ended = false; this.currentTime = 0; } get src() { return this._src; }
        getAttribute(a) { return a === "src" ? this._src : null; }
        get currentSrc() { return this._src; }
        addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
        emit(t) { (this._l[t] || []).forEach((f) => f()); }
        removeAttribute(a) { if (a === "src") this._src = ""; }
        load() {} play() { this.paused = false; return Promise.resolve(); }
        pause() { if (!this.paused) { this.paused = true; setTimeout(() => this.emit("pause"), 0); } }
      };
      w.indexedDB = idb;
      if (opts.storage) { const P = w.Storage.prototype; P.getItem = (k) => opts.storage.getItem(k); P.setItem = (k, v) => opts.storage.setItem(k, v); P.removeItem = (k) => opts.storage.removeItem(k); }
      if (opts.locks) Object.defineProperty(w.navigator, "locks", { value: locksFor(opts.locks, w, opts.lockHooks), configurable: true });
      w.URL.createObjectURL = (b) => "blob:" + b.size; w.URL.revokeObjectURL = () => {};
      w.confirm = () => opts.confirm !== false; w.prompt = () => opts.promptValue === undefined ? "My Single Book" : opts.promptValue;
      Object.entries(opts.ls || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
      Object.entries(opts.ss || {}).forEach(([k, v]) => w.sessionStorage.setItem(k, v));
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, idb, radio: w.__audios[0], pod: w.__audios[1], $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
    ls: (k) => JSON.parse(w.localStorage.getItem("tl_" + k)), dump: () => Object.fromEntries(Object.keys(w.localStorage).map((k) => [k, w.localStorage.getItem(k)])) };
}
// files with distinct sizes so the fake object URL identifies the track ("blob:<size>")
function mk(rel, size, mod) {
  const f = new File(["x".repeat(size)], rel.split("/").pop(), { type: rel.endsWith(".jpg") ? "image/jpeg" : "audio/mpeg", lastModified: mod || 1000 + size });
  if (rel.includes("/")) Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
}
async function addFolder(a, files) {
  const inp = a.$("#pickDir"); Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(200);
}
const openBooks = (a) => a.$('[data-mode="book"]').click();
const names = (a) => a.$$(".trk .pod-ti").map((e) => e.textContent);
const FOUR = () => [mk("My Book/Chapter 10.mp3", 40), mk("My Book/Chapter 2.mp3", 20), mk("My Book/Chapter 1.mp3", 10), mk("My Book/cover.jpg", 5), mk("My Book/Chapter 3.mp3", 30)];
async function withBook(opts) { const a = boot(opts); openBooks(a); await addFolder(a, FOUR()); return a; }
const trk = (a, n) => a.$$(".trk").find((r) => r.querySelector(".pod-ti").textContent === n);

test("third tab shows an empty library", () => {
  const a = boot(); openBooks(a);
  assert.equal(a.$("#bookView").hidden, false); assert.equal(a.$("#radioView").hidden, true);
  assert.match(a.$("#bookBody").textContent, /No books yet/); assert.equal(a.ls("view"), "book");
});

test("folder import: audio only, natural order, book named after the folder", async () => {
  const a = await withBook();
  assert.deepEqual(names(a), ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 10"]);
  const b = a.ls("books");
  assert.equal(b.length, 1); assert.equal(b[0].name, "My Book"); assert.equal(b[0].tracks.length, 4);
  assert.match(a.$("#bookBody").textContent, /0 of 4 chapters/);
});

test("subfolders are read and sorted naturally", async () => {
  const a = boot(); openBooks(a);
  await addFolder(a, [mk("Book/CD2/02.mp3", 50), mk("Book/CD1/01.mp3", 10), mk("Book/CD1/10.mp3", 30), mk("Book/CD1/2.mp3", 20)]);
  assert.deepEqual(names(a), ["CD1 / 01", "CD1 / 2", "CD1 / 10", "CD2 / 02"]);
});

test("playback remembers progress, marks played tracks and continues with the next", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();
  assert.equal(a.pod.src, "blob:10", "starts with Chapter 1");
  assert.equal(a.$("#dockT").textContent, "Chapter 1"); assert.equal(a.$("#dockS").textContent, "My Book");
  a.pod.currentTime = 3599; a.pod.ended = true; a.pod.emit("ended"); await tick();
  assert.equal(a.pod.src, "blob:20", "continues with Chapter 2");
  assert.ok(trk(a, "Chapter 1").classList.contains("done"), "played track gets the done colour");
  assert.ok(!trk(a, "Chapter 2").classList.contains("done"));
  assert.ok(trk(a, "Chapter 2").classList.contains("cur"));
  assert.equal(a.ls("pos")["1"], undefined);
  assert.match(a.$("#bookBody").textContent, /1 of 4 chapters/);
  assert.equal(a.ls("books")[0].cur, "k1");
  // finish everything
  for (const src of ["blob:20", "blob:30", "blob:40"]) { a.pod.ended = true; a.pod.emit("ended"); await tick(); }
  assert.equal(a.$("#toast").hidden, false); assert.match(a.$("#toast").textContent, /End of the book/);
  assert.match(a.$("#bookBody").textContent, /4 of 4 chapters · .*done/);
  a.$('[data-act="bback"]').click();
  assert.ok(a.$(".pod-row.finished"), "finished book is coloured in the library");
});

test("position and played state survive a reload; Continue resumes there", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();
  a.pod.ended = true; a.pod.emit("ended"); await tick();                  // Chapter 1 done, Chapter 2 playing
  a.pod.currentTime = 77; a.$("#play").click(); await tick();             // pause at 77 s
  const b = boot({ idb: a.idb, ls: a.dump() }); openBooks(b);
  assert.match(b.$("#bookBody").textContent, /My Book/); assert.match(b.$("#bookBody").textContent, /1 of 4 chapters/);
  b.$('[data-act="bresume"]').click(); await tick();
  assert.equal(b.pod.src, "blob:20", "resumes the track that was playing");
  b.pod.duration = 600; b.pod.emit("loadedmetadata");
  assert.equal(b.pod.currentTime, 77, "resumes at the remembered position");
  b.$('[data-act="bopen"]').click();
  assert.ok(trk(b, "Chapter 1").classList.contains("done"), "done colour is restored");
  assert.match(trk(b, "Chapter 2").textContent, /at 1:17/);
});

test("sorting: presets, arrows and drag & drop persist", async () => {
  const a = await withBook();
  const sort = (v) => { const s = a.$("#bookSort"); s.value = v; s.dispatchEvent(new a.w.Event("change", { bubbles: true })); };
  sort("name-desc"); assert.deepEqual(names(a), ["Chapter 10", "Chapter 3", "Chapter 2", "Chapter 1"]);
  sort("size-desc"); assert.deepEqual(names(a), ["Chapter 10", "Chapter 3", "Chapter 2", "Chapter 1"]);
  sort("date"); assert.deepEqual(names(a), ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 10"]);
  sort("reverse"); assert.deepEqual(names(a), ["Chapter 10", "Chapter 3", "Chapter 2", "Chapter 1"]);
  sort("orig"); assert.deepEqual(names(a), ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 10"]);
  trk(a, "Chapter 1").querySelector('[data-act="tdown"]').click();          // arrows
  assert.deepEqual(names(a), ["Chapter 2", "Chapter 1", "Chapter 3", "Chapter 10"]);
  trk(a, "Chapter 10").querySelector('[data-act="tup"]').click();
  assert.deepEqual(names(a), ["Chapter 2", "Chapter 1", "Chapter 10", "Chapter 3"]);
  const ev = (t, el) => { const e = new a.w.Event(t, { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
  ev("dragstart", trk(a, "Chapter 3")); ev("dragover", trk(a, "Chapter 2")); ev("drop", trk(a, "Chapter 2"));   // drag last to first
  assert.deepEqual(names(a), ["Chapter 3", "Chapter 2", "Chapter 1", "Chapter 10"]);
  assert.deepEqual(a.ls("books")[0].tracks.map((t) => t.name), ["Chapter 3", "Chapter 2", "Chapter 1", "Chapter 10"], "order persisted");
  // playback follows the new order
  a.$('[data-act="bresume"]').click(); await tick();
  assert.equal(a.pod.src, "blob:30", "first track in the new order plays first");
});

test("mark played / reset / all played", async () => {
  const a = await withBook();
  trk(a, "Chapter 2").querySelector('[data-act="tdone"]').click();
  assert.ok(trk(a, "Chapter 2").classList.contains("done"));
  trk(a, "Chapter 2").querySelector('[data-act="tdone"]').click();
  assert.ok(!trk(a, "Chapter 2").classList.contains("done"));
  a.$('[data-act="bdone"]').click(); assert.equal(a.$$(".trk.done").length, 4);
  a.$('[data-act="breset"]').click(); assert.equal(a.$$(".trk.done").length, 0);
});

test("several books are kept apart; duplicates are ignored; deleting cleans up", async () => {
  const a = await withBook();
  await addFolder(a, [mk("Second Book/a.mp3", 60), mk("Second Book/b.mp3", 70)]);
  a.$('[data-act="bback"]').click();
  assert.equal(a.$$(".pod-row.bk").length, 2);
  await addFolder(a, FOUR()); assert.match(a.$("#toast").textContent, /already exists/); assert.equal(a.ls("books").length, 2);
  // play the second, then delete it while playing
  a.$$('[data-act="bresume"]')[1].click(); await tick();
  assert.equal(a.pod.src, "blob:60");
  a.$('[data-act="bopen"]').click(); a.$('[data-act="tdone"]').click(); a.$('[data-act="bback"]').click();   // some state to clean up
  assert.ok(Object.keys(a.ls("done")).length === 1);
  a.$$('[data-act="bdel"]')[1].click(); await tick();
  assert.equal(a.ls("books").length, 1); assert.equal(a.pod.src, "", "player cleared"); assert.equal(a.$("#dockT").textContent, "No station selected");
  assert.deepEqual(Object.keys(a.ls("done") || {}).filter((k) => !k.startsWith(a.ls("books")[0].id + "/")), [], "no leftovers of the deleted book");
});

test("individual files can be added as a book", async () => {
  const a = boot({ promptValue: "My Selection" }); openBooks(a);
  const inp = a.$("#pickFiles"); Object.defineProperty(inp, "files", { value: [mk("two.mp3", 22), mk("one.mp3", 11)], configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(200);
  assert.equal(a.ls("books")[0].name, "My Selection"); assert.deepEqual(names(a), ["one", "two"]);
});

test("missing file shows an error instead of playing", async () => {
  const a = boot({ ls: { tl_books: JSON.stringify([{ id: "bx", name: "Leer", cur: null, tracks: [{ id: "k0", name: "Weg", path: "Leer/weg.mp3", size: 1, mod: 1 }] }]) } });
  openBooks(a); a.$('[data-act="bopen"]').click(); a.$('[data-act="tplay"]').click(); await tick(60);
  assert.equal(a.pod.src, ""); assert.match(a.$("#dockS").textContent, /File not found/);
  assert.ok(a.$("#dockS").classList.contains("err"));
});

test("untrusted file and folder names are escaped", async () => {
  const a = boot(); openBooks(a);
  await addFolder(a, [mk("<img src=x onerror=window.__xss=1>/<u onmouseover=window.__xss=1>x.mp3", 12)]);
  assert.equal(a.ls("books").length, 1);
  assert.equal(a.$$("#bookBody img").length, 0); assert.equal(a.$$("#bookBody u").length, 0);
  assert.equal(a.w.__xss, undefined); assert.match(a.$("#bookBody").textContent, /<u onmouseover=window.__xss=1>x/);
});

test("book playback and radio exclude each other; next/prev move between chapters", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();
  a.$("#next").click(); await tick(); assert.equal(a.pod.src, "blob:20");
  a.$("#prev").click(); await tick(); assert.equal(a.pod.src, "blob:10", "prev at 0 s goes to previous chapter");
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click();
  assert.equal(a.pod.paused, true); assert.ok(a.radio.src.includes("ice1.somafm.com"));
});

/* ---- Regressions from the code review (books) ---- */
// direct access to the same fake IndexedDB the page uses
const idbOp = (idb, fn) => new Promise((res, rej) => {
  const r = idb.open("tl_pod", 1); r.onupgradeneeded = () => r.result.createObjectStore("files");
  r.onsuccess = () => { const db = r.result, tx = db.transaction("files", "readwrite"), rq = fn(tx.objectStore("files")); tx.oncomplete = () => { db.close(); res(rq && rq.result); }; tx.onerror = () => rej(tx.error); };
  r.onerror = () => rej(r.error);
});
const keysOf = (idb) => idbOp(idb, (os) => os.getAllKeys());

test("Reset on the loaded book resets the player, so nothing old is resumed or written back", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();                      // Chapter 1 loaded
  a.pod.currentTime = 100; a.$("#play").click(); await tick();            // paused at 100 s -> saved
  assert.ok(Object.keys(a.ls("pos")).length === 1);
  a.$('[data-act="breset"]').click(); await tick();
  assert.equal(a.pod.src, "", "loaded source is dropped");
  a.w.dispatchEvent(new a.w.Event("pagehide"));                           // must not write the old offset back
  assert.deepEqual(a.ls("pos"), {}, "reset progress stays reset");
  a.$('[data-act="bresume"]').click(); await tick();                      // "Play" starts fresh
  assert.equal(a.pod.src, "blob:10"); assert.equal(a.pod.currentTime, 0);
  assert.equal(a.pod.playbackRate, 1);
});

test("All heard on the loaded book also detaches the player", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();
  a.pod.currentTime = 50;
  a.$('[data-act="bdone"]').click(); await tick();
  a.w.dispatchEvent(new a.w.Event("pagehide"));
  assert.equal(a.pod.src, ""); assert.deepEqual(a.ls("pos"), {});
});

const pend = (o) => JSON.stringify(Object.assign({ n: 1, ts: Date.now(), lk: 1 }, o));       // lk: written by an import that holds a Web Lock
const put = (idb, ...ks) => Promise.all(ks.map((k) => idbOp(idb, (os) => os.put(new Blob(["x"]), k))));

test("an interrupted import is cleaned up at the next start (no live importer)", async () => {
  const idb = new IDBFactory(), locks = newLocks();
  await put(idb, "bold/k0", "bold/k1", "bkeep/k0");
  const a = boot({ idb, locks, ls: { tl_pending: pend({ id: "bold", n: 3, ts: Date.now() }) } }); await tick(100);   // fresh marker, but nobody holds the lock
  assert.deepEqual((await keysOf(idb)).sort(), ["bkeep/k0"], "orphaned copies removed, others untouched");
  assert.equal(a.ls("pending"), null);
});

test("a live import is never reclaimed: duplicated tab (same session) or long suspension", async () => {
  const idb = new IDBFactory(), locks = newLocks();
  await put(idb, "blive/k0");
  locks.held.add("tl-import-blive");                                       // the importing tab is alive and holds the lock
  // a duplicated tab inherits sessionStorage (same tab id) and the marker is old (suspended > 2 min)
  const dup = boot({ idb, locks, ss: { tl_sid: "S1" }, ls: { tl_pending: pend({ id: "blive", ts: 1, sid: "S1" }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["blive/k0"], "files of the running import survive");
  assert.ok(dup.ls("pending"), "marker kept");
  locks.held.delete("tl-import-blive");                                    // importing tab died
  boot({ idb, locks, ls: { tl_pending: pend({ id: "blive", ts: 1 }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), [], "now it is reclaimed");
});

test("reclaiming re-checks under the lock: an import that finished meanwhile is not destroyed", async () => {
  const idb = new IDBFactory(), locks = newLocks();
  await put(idb, "bfin/k0");
  const book = [{ id: "bfin", name: "Finished", cur: null, tracks: [{ id: "k0", name: "a", path: "a", size: 1, mod: 1 }] }];
  const hooks = { beforeGrant: (name, w) => { w.localStorage.removeItem("tl_pending"); w.localStorage.setItem("tl_books", JSON.stringify(book)); } };   // import completes between read and grant
  boot({ idb, locks, lockHooks: hooks, ls: { tl_pending: pend({ id: "bfin", ts: 1 }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["bfin/k0"], "saved book keeps its files");
  // marker left behind although the book was saved: only the marker is dropped
  const b = boot({ idb, locks, ls: { tl_pending: pend({ id: "bfin", ts: 1 }), tl_books: JSON.stringify(book) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["bfin/k0"]); assert.equal(b.ls("pending"), null);
});

test("without Web Locks only an old marker is reclaimed", async () => {
  const idb = new IDBFactory();
  await put(idb, "bold/k0", "bnew/k0");
  boot({ idb, ls: { tl_pending: pend({ id: "bold", ts: 1 }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["bnew/k0"]);
  const f = boot({ idb, ls: { tl_pending: pend({ id: "bnew", ts: Date.now() }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["bnew/k0"], "fresh marker might belong to a running import");
  assert.ok(f.ls("pending"));
});

test("an import holds an exclusive lock while it runs and keeps the marker only inside it", async () => {
  const locks = newLocks(), a = boot({ locks }); openBooks(a);
  const many = Array.from({ length: 40 }, (_, i) => mk("Lang/k" + String(i).padStart(2, "0") + ".mp3", 10 + i));
  const inp = a.$("#pickDir"); Object.defineProperty(inp, "files", { value: many, configurable: true });
  inp.dispatchEvent(new a.w.Event("change"));
  let seen = null, heldSeen = false;
  for (let i = 0; i < 200 && !seen; i++) { await tick(1); if (a.ls("pending")) { seen = a.ls("pending"); heldSeen = [...locks.held].some((n) => n.startsWith("tl-import-")); } }
  assert.ok(seen && seen.n === 40, "marker written while importing"); assert.ok(heldSeen, "lock held while the marker exists");
  await tick(500);
  assert.equal(a.ls("pending"), null); assert.equal(a.ls("books").length, 1); assert.equal(locks.held.size, 0, "lock released afterwards");
});

test("an import records a pending marker while running and clears it when done", async () => {
  const a = boot(); openBooks(a);
  const inp = a.$("#pickDir"); Object.defineProperty(inp, "files", { value: FOUR(), configurable: true });
  inp.dispatchEvent(new a.w.Event("change"));
  assert.ok(a.ls("pending") && a.ls("pending").n === 4, "marker exists before the first file is written");
  await tick(250);
  assert.equal(a.ls("pending"), null); assert.equal(a.ls("books").length, 1);
});

test("a failing import removes what it already copied", async () => {
  const a = boot(); openBooks(a);
  const bad = { name: "b.mp3", size: 1, type: "audio/mpeg", lastModified: 1, webkitRelativePath: "Broken/b.mp3", nope() {} };   // not clonable -> put fails
  await addFolder(a, [mk("Broken/a.mp3", 10), bad]);
  assert.deepEqual(a.ls("books") || [], [], "no half-finished book in the library");
  assert.equal(a.ls("pending"), null);
  assert.deepEqual(await keysOf(a.idb), [], "no orphaned copies");
  assert.match(a.$("#toast").textContent, /failed/);
});

test("a chapter that cannot be loaded does not leave the previous audio playable", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();                      // Chapter 1 playing
  assert.equal(a.pod.src, "blob:10");
  const book = a.ls("books")[0];
  await idbOp(a.idb, (os) => os.delete(book.id + "/k1"));                 // Chapter 2's file is gone
  trk(a, "Chapter 2").querySelector('[data-act="tplay"]').click(); await tick(60);
  assert.match(a.$("#dockS").textContent, /File not found/);
  assert.equal(a.pod.src, "", "previous recording is dropped");
  a.$("#play").click(); await tick(60);                                   // retry via the dock
  assert.equal(a.pod.paused, true, "must not play Chapter 1 under Chapter 2's title");
  assert.equal(a.pod.src, "");
  a.$('[data-act="bresume"]').click(); await tick(60);                    // retry via Continue
  assert.equal(a.pod.paused, true); assert.equal(a.pod.src, "");
});

test("resetting a book that was played earlier does not touch the radio dock", async () => {
  const a = await withBook();
  a.$('[data-act="bresume"]').click(); await tick();                      // book playing
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click();  // user switches to a radio station
  assert.match(a.$("#dockT").textContent, /Groove Salad/); assert.ok(a.radio.src.includes("ice1.somafm.com"));
  a.$('[data-mode="book"]').click();
  for (const act of ["breset", "bdone"]) {
    a.$(`[data-act="${act}"]`).click(); await tick();
    assert.match(a.$("#dockT").textContent, /SomaFM Groove Salad/, act + ": radio title kept");
    assert.notEqual(a.$("#dockT").textContent, "No station selected");
    assert.ok(a.radio.src.includes("ice1.somafm.com"), "radio keeps playing");
    assert.ok(!a.d.body.classList.contains("pod"));
  }
  assert.equal(a.pod.src, "", "stale book source is detached");
  a.w.dispatchEvent(new a.w.Event("pagehide")); assert.deepEqual(a.ls("pos"), {});
});

test("a marker without a lock (older version, or no Web Locks) is never swept just because the lock is free", async () => {
  const idb = new IDBFactory(), locks = newLocks();
  await put(idb, "bleg/k0", "bold/k0");
  const legacy = (o) => JSON.stringify(Object.assign({ n: 1, ts: Date.now(), sid: "S1" }, o));        // format of the previous version: no lk
  // an import running in a tab with the previous index.html: fresh marker, holds no Web Lock
  const a = boot({ idb, locks, ls: { tl_pending: legacy({ id: "bleg" }) } }); await tick(100);
  assert.deepEqual((await keysOf(idb)).sort(), ["bleg/k0", "bold/k0"], "files of the running legacy import survive");
  assert.ok(a.ls("pending"), "marker kept");
  // an abandoned legacy marker (heartbeat long gone) is still cleaned up
  const b = boot({ idb, locks, ls: { tl_pending: legacy({ id: "bold", ts: 1 }) } }); await tick(100);
  assert.deepEqual(await keysOf(idb), ["bleg/k0"], "stale legacy marker is swept by age");
  assert.equal(b.ls("pending"), null);
});

test("new imports mark themselves as lock-protected", async () => {
  const locks = newLocks(), a = boot({ locks }); openBooks(a);
  const many = Array.from({ length: 40 }, (_, i) => mk("Lang/k" + String(i).padStart(2, "0") + ".mp3", 10 + i));
  const inp = a.$("#pickDir"); Object.defineProperty(inp, "files", { value: many, configurable: true });
  inp.dispatchEvent(new a.w.Event("change"));
  let seen = null; for (let i = 0; i < 200 && !seen; i++) { await tick(1); seen = a.ls("pending"); }
  assert.ok(seen && seen.lk === 1, "marker says: protected by a lock");
  await tick(500);
  const b = boot({}); openBooks(b);                                      // no Web Locks available at all
  const inp2 = b.$("#pickDir"); Object.defineProperty(inp2, "files", { value: many, configurable: true });
  inp2.dispatchEvent(new b.w.Event("change"));
  assert.ok(b.ls("pending") && !b.ls("pending").lk, "without Web Locks the marker is not lock-protected");
  await tick(500);
});

/* ---- Adding chapters to an existing book ---- */
async function addToBookUi(a, act, files) {
  a.$(`[data-act="${act}"]`).click();
  const id = act === "badddir" ? "#pickDir" : "#pickFiles";
  const inp = a.$(id); Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(300);
}

test("chapters can be added to an existing book; existing order and played state stay", async () => {
  const a = await withBook(), before = (await keysOf(a.idb)).length;
  trk(a, "Chapter 2").querySelector('[data-act="tdone"]').click();                 // some state that must survive
  a.$('[data-act="bresume"]').click(); await tick(); a.$("#play").click(); await tick();
  await addToBookUi(a, "baddfiles", [mk("Chapter 12.mp3", 60), mk("Chapter 11.mp3", 50), mk("cover.jpg", 5)]);
  assert.equal(a.ls("books").length, 1, "same book");
  assert.deepEqual(names(a), ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 10", "Chapter 11", "Chapter 12"], "new chapters appended in natural order");
  assert.equal((await keysOf(a.idb)).length, before + 2); assert.equal(a.ls("pending"), null);
  assert.match(a.$("#toast").textContent, /2 new in/); assert.match(a.$("#bookBody").textContent, /1 of 6 chapters/);
  assert.ok(trk(a, "Chapter 2").classList.contains("done"), "played state kept");
  // a new chapter plays; auto-advance continues into it
  trk(a, "Chapter 11").querySelector('[data-act="tplay"]').click(); await tick(); assert.equal(a.pod.src, "blob:50");
  a.pod.ended = true; a.pod.emit("ended"); await tick(); assert.equal(a.pod.src, "blob:60", "continues with the next added chapter");
});

test("re-picking the same folder adds only the new files", async () => {
  const a = await withBook();
  await addToBookUi(a, "badddir", FOUR().concat([mk("My Book/Chapter 4.mp3", 45)]));
  assert.deepEqual(names(a), ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 10", "Chapter 4"]);
  assert.match(a.$("#toast").textContent, /1 new in "My Book", 4 already there/);
  await addToBookUi(a, "badddir", FOUR());                                          // nothing new at all
  assert.match(a.$("#toast").textContent, /already in the book/); assert.equal(a.ls("books")[0].tracks.length, 5);
  await addToBookUi(a, "badddir", [mk("My Book/CD2/01.mp3", 70)]);                // subfolder keeps its path in the chapter name
  assert.equal(names(a).pop(), "CD2 / 01");
});

test("an interrupted chapter add is cleaned up at the next start (books)", async () => {
  const idb = new IDBFactory();
  const put = (...ks) => Promise.all(ks.map((k) => idbOp(idb, (os) => os.put(new Blob(["x"]), k))));
  await put("bQ/k0", "bQ/k1", "bQ/k2", "bQ/k3");
  const book = { id: "bQ", name: "Q", cur: null, tracks: ["k0", "k1", "k2"].map((id) => ({ id, name: id, path: id + ".mp3", size: 1, mod: 1 })) };
  const a = boot({ idb, ls: { tl_books: JSON.stringify([book]), tl_pending: JSON.stringify({ id: "bQ", n: 2, from: 2, ts: 1 }) } }); await tick(150);
  assert.deepEqual((await keysOf(idb)).sort(), ["bQ/k0", "bQ/k1", "bQ/k2"], "registered chapters stay, the orphan goes"); assert.equal(a.ls("pending"), null);
});

test("a failing chapter add removes only its new files; add buttons do not leak into new books", async () => {
  const a = await withBook(), keys = await keysOf(a.idb);
  const bad = { name: "kaputt.mp3", size: 1, type: "audio/mpeg", lastModified: 1, nope() {} };
  await addToBookUi(a, "baddfiles", [mk("Chapter 20.mp3", 80), bad]);
  assert.equal(a.ls("books")[0].tracks.length, 4); assert.deepEqual(await keysOf(a.idb), keys); assert.equal(a.ls("pending"), null); assert.match(a.$("#toast").textContent, /failed/);
  a.$('[data-act="baddfiles"]').click();                                            // dialog cancelled: no change event
  a.$('[data-act="bback"]').click(); a.$('[data-act="bookfiles"]').click();
  const inp = a.$("#pickFiles"); Object.defineProperty(inp, "files", { value: [mk("x.mp3", 11), mk("y.mp3", 12)], configurable: true });
  inp.dispatchEvent(new a.w.Event("change")); await tick(300);
  assert.equal(a.ls("books").length, 2, "created a new book instead of adding to the old one"); assert.equal(a.ls("books")[0].tracks.length, 4);
});

/* ---- Two tabs, same data ---- */
test("two tabs: an append from a stale tab reloads the saved book and never reuses keys", async () => {
  const storage = sharedStorage(), idb = new IDBFactory(), locks = newLocks();
  const A = boot({ idb, locks, storage }); openBooks(A); await addFolder(A, FOUR());
  const B = boot({ idb, locks, storage }); openBooks(B); B.$('[data-act="bopen"]').click();      // B now holds the 4 chapters in memory
  await addToBookUi(A, "baddfiles", [mk("A1.mp3", 101), mk("A2.mp3", 102)]);                      // A appends first
  await addToBookUi(B, "baddfiles", [mk("B1.mp3", 201), mk("B2.mp3", 202)]);                      // B is stale and appends second
  const saved = JSON.parse(storage.getItem("tl_books"));
  assert.equal(saved.length, 1); const tracks = saved[0].tracks;
  assert.equal(tracks.length, 8, "both additions are in the book"); assert.equal(new Set(tracks.map((t) => t.id)).size, 8, "unique chapter keys");
  for (const t of tracks) { const blob = await idbOp(idb, (os) => os.get(saved[0].id + "/" + t.id)); assert.equal(blob.size, t.size, t.name + " still has its own audio"); }
});

test("two tabs: a new book from a stale tab does not drop a book saved meanwhile", async () => {
  const storage = sharedStorage(), idb = new IDBFactory(), locks = newLocks();
  const A = boot({ idb, locks, storage }); openBooks(A);
  const B = boot({ idb, locks, storage }); openBooks(B);
  await addFolder(A, FOUR());                                                                      // A saves book 1 after B loaded
  await addFolder(B, [mk("Second Book/a.mp3", 61), mk("Second Book/b.mp3", 62)]);                // B's list is stale
  assert.deepEqual(JSON.parse(storage.getItem("tl_books")).map((b) => b.name).sort(), ["My Book", "Second Book"]);
});

/* ---- Code review: two deletions at the same time ---- */
for (const withLocks of [false, true]) {
  test("deleting two books at once removes exactly those two (" + (withLocks ? "with" : "without") + " Web Locks)", async () => {
    const a = boot(withLocks ? { locks: newLocks() } : {}); openBooks(a);
    for (const n of ["Book A", "Book B", "Book C"]) await addFolder(a, [mk(n + "/a.mp3", 11), mk(n + "/b.mp3", 12)]);
    if (a.$('[data-act="bback"]')) a.$('[data-act="bback"]').click();
    assert.equal(a.$$('[data-act="bdel"]').length, 3);
    const [delA, delB] = a.$$('[data-act="bdel"]'); delA.click(); delB.click(); await tick(400);        // second delete starts while the first is still cleaning up
    assert.deepEqual(a.ls("books").map((b) => b.name), ["Book C"], "only C is left; C was not removed instead of A");
    const keys = await keysOf(a.idb), cid = a.ls("books")[0].id;
    assert.ok(keys.length === 2 && keys.every((k) => k.startsWith(cid + "/")), "no files of A or B left, C intact");
  });
}
