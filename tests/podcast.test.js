const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const html = fs.readFileSync(process.env.HTML || "index.html", "utf8");
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const SHOW = { collectionId: 111, collectionName: "Techno <img src=x onerror=window.__xss=1> Show", artistName: "DJ Test", artworkUrl100: "https://img/100.jpg" };
const SHOW2 = { collectionId: 222, collectionName: "Second Show", artistName: "DJ Two", artworkUrl100: "https://img/2.jpg" };
const EP = (n, extra) => Object.assign({ kind: "podcast-episode", trackId: 1000 + n, trackName: "Episode " + n, collectionName: "Techno Show", collectionId: 111,
  releaseDate: "2026-10-" + (10 + n) + "T10:00:00Z", trackTimeMillis: 3600000, episodeUrl: "https://cdn.test/ep" + n + ".mp3", description: "Desc <b>" + n + "</b> unique" + n, artworkUrl160: "https://img/160.jpg" }, extra);

function boot(opts = {}) {
  const calls = [];
  let release; const gate = opts.gate ? new Promise((r) => (release = r)) : Promise.resolve();
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
        pause() { if (!this.paused) { this.paused = true; setTimeout(() => this.emit("pause"), 0); } }   // like browsers: event is queued
      };
      w.indexedDB = new IDBFactory();
      w.URL.createObjectURL = () => "blob:test"; w.URL.revokeObjectURL = () => {};
      w.fetch = (url) => {
        calls.push(url);
        const u = new URL(url);
        if (u.hostname === "itunes.apple.com" && u.pathname === "/search") {
          const ep = u.searchParams.get("entity") === "podcastEpisode";
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: ep ? [EP(1), EP(2)] : [SHOW, SHOW2] }) });
        }
        if (u.hostname === "itunes.apple.com" && u.pathname === "/lookup") {
          const e3 = opts.httpEnclosure ? EP(3, { episodeUrl: "http://cdn.test/ep3.mp3" }) : EP(3);
          return gate.then(() => ({ ok: true, json: () => Promise.resolve({ results: [{ kind: "podcast", collectionId: 111 }, e3, EP(2), EP(1), { kind: "podcast-episode", trackId: 9, trackName: "no url" }] }) }));
        }
        if (opts.dlFail) return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve({ ok: true, headers: { get: () => null }, body: null, blob: () => Promise.resolve(new Blob(["abc"], { type: "audio/mpeg" })) });
      };
      (opts.seed || []).forEach(([k, v]) => w.localStorage.setItem("tl_" + k, JSON.stringify(v)));
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, calls, release: () => release(), radio: w.__audios[0], pod: w.__audios[1], $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)], ls: (k) => JSON.parse(w.localStorage.getItem("tl_" + k)) };
}
async function search(a, q) { a.$("#pq").value = q; a.$("#pq").dispatchEvent(new a.w.Event("input")); a.$("#pq").dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "Enter" })); await tick(); }
const openPod = (a) => a.$('[data-mode="pod"]').click();

test("tab switch shows podcast view and remembers it", () => {
  const a = boot();
  assert.equal(a.$("#podView").hidden, true);
  openPod(a);
  assert.equal(a.$("#podView").hidden, false); assert.equal(a.$("#radioView").hidden, true);
  assert.equal(a.ls("view"), "pod");
  a.$('[data-mode="radio"]').click();
  assert.equal(a.$("#radioView").hidden, false);
});

test("search renders results and escapes untrusted text", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  assert.ok(a.calls.some((u) => /search\?media=podcast&limit=25&entity=podcast&term=techno/.test(u)));
  assert.match(a.$("#podBody").textContent, /DJ Test/);
  assert.equal(a.$$("#podBody img[onerror]").length, 0, "no injected element");
  assert.match(a.$("#podBody").textContent, /<img src=x onerror/, "shown as text");
  assert.equal(a.w.__xss, undefined);
});

test("episode search lists episodes", async () => {
  const a = boot(); openPod(a); a.$("#pq").value = "x"; a.$("#pq").dispatchEvent(new a.w.Event("input"));
  a.$('[data-act="kind"][data-id="ep"]').click(); await tick();
  assert.equal(a.$$("#podBody .pod-row").length, 2);
  assert.match(a.$("#podBody").textContent, /Episode 1/);
});

test("subscribe persists, shows in Subscriptions, new-episode badge", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  a.$$('[data-act="sub"]')[0].click();
  assert.deepEqual(Object.keys(a.ls("subs")), ["111"]);
  a.$('[data-ptab="subs"]').click(); await tick();
  assert.equal(a.$$(".show-card").length, 1);
  assert.equal(a.$$("#podBody .pod-row").length, 3, "feed episodes (no-url one dropped)");
  // subscribed long ago -> episodes are new
  const s = a.ls("subs"); s["111"].seen = "2026-01-01T00:00:00Z";
  const b = boot({ seed: [["subs", s], ["view", "pod"]] }); await tick(80);
  assert.match(b.$(".show-card").textContent, /3 new/);
  // unsubscribe
  b.$(".show-card").click(); await tick(); b.$('[data-act="sub"]').click();
  assert.deepEqual(b.ls("subs"), {});
});

test("show page: episodes load and can be filtered", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  assert.equal(a.$$("#epList .pod-row").length, 3);
  const eq = a.$("#eq"); eq.value = "unique2"; eq.dispatchEvent(new a.w.Event("input"));
  assert.equal(a.$$("#epList .pod-row").length, 1);
  assert.match(a.$("#epList").textContent, /Episode 2/);
  eq.value = "zzz"; eq.dispatchEvent(new a.w.Event("input"));
  assert.match(a.$("#epList").textContent, /No episode found/);
});

test("playing an episode stops radio; starting radio stops the podcast", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  // radio running first
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click();
  assert.ok(a.radio.src.includes("ice1.somafm.com"));
  openPod(a); a.$('#epList [data-act="play"]').click(); await tick();
  assert.equal(a.radio.src, "", "radio stopped");
  assert.equal(a.pod.src, "https://cdn.test/ep3.mp3");
  assert.ok(a.d.body.classList.contains("pod"));
  assert.equal(a.$("#dockT").textContent, "Episode 3");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Pause");
  a.$("#play").click(); assert.equal(a.pod.paused, true, "dock play button pauses podcast");
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click();
  assert.equal(a.pod.paused, true); assert.ok(!a.d.body.classList.contains("pod"));
  assert.ok(a.radio.src.includes("ice1.somafm.com"));
});

test("queue: add, reorder, autoplay next, persists", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  const rows = () => a.$$('#epList [data-act="qadd"]');
  rows()[0].click(); rows()[1].click();                    // ep3, ep2
  assert.deepEqual(a.ls("queue").map((e) => e.id), ["1003", "1002"]);
  a.$('[data-ptab="queue"]').click();
  a.$$('[data-act="qdown"]')[0].click();                   // -> ep2, ep3
  assert.deepEqual(a.ls("queue").map((e) => e.id), ["1002", "1003"]);
  a.$('[data-act="qplay"]').click(); await tick();
  assert.equal(a.pod.src, "https://cdn.test/ep2.mp3");
  a.pod.currentTime = 3599; a.pod.ended = true; a.pod.emit("ended"); await tick();
  assert.equal(a.pod.src, "https://cdn.test/ep3.mp3", "next in queue");
  assert.equal(a.ls("pos")["1002"], undefined, "finished episode keeps no resume position");
  assert.equal(a.ls("done")["1002"], 1);
  a.$("#next").click();                                    // end of list: stays
  assert.equal(a.pod.src, "https://cdn.test/ep3.mp3");
  a.$("#prev").click(); await tick();                      // currentTime 0 -> previous in queue
  assert.equal(a.pod.src, "https://cdn.test/ep2.mp3");
  a.$('[data-ptab="queue"]').click(); a.$('[data-act="qrm"]').click();
  assert.deepEqual(a.ls("queue").map((e) => e.id), ["1003"]);
});

test("resume position and speed", async () => {
  const a = boot({ seed: [["pos", { 1003: 600 }]] }); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  a.$('#epList [data-act="play"]').click(); await tick();
  a.pod.duration = 3600; a.pod.emit("loadedmetadata");
  assert.equal(a.pod.currentTime, 600);
  a.$("#rate").click(); assert.equal(a.pod.playbackRate, 1.25); assert.equal(a.ls("rate"), 1.25);
  a.pod.currentTime = 100; a.$("#fwd30").click(); assert.equal(a.pod.currentTime, 130);
  a.pod.pause(); await tick(); assert.equal(a.ls("pos")["1003"], 130, "position saved on pause");
});

test("download stores file offline, plays from it, can be deleted", async () => {
  const a = boot(); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  a.$('#epList [data-act="dl"]').click(); await tick(100);
  assert.deepEqual(Object.keys(a.ls("dl")), ["1003"]);
  assert.equal(a.ls("dl")["1003"].size, 3);
  a.$('[data-ptab="dl"]').click();
  assert.match(a.$("#podBody").textContent, /1 episode\b/);
  a.$('[data-act="play"]').click(); await tick(60);
  assert.equal(a.pod.src, "blob:test", "plays the offline copy");
  a.$('[data-act="dlrm"]').click(); await tick(60);
  assert.deepEqual(a.ls("dl"), {});
});

test("download falls back to a link when host blocks CORS", async () => {
  const a = boot({ dlFail: true }); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  a.$('#epList [data-act="dl"]').click(); await tick(60);
  assert.equal(a.$("#toast").hidden, false);
  assert.match(a.$("#toast a").getAttribute("href"), /^https:\/\/cdn\.test\/ep3\.mp3$/);
  assert.equal(a.ls("dl"), null);
  assert.ok(a.$('#epList [data-act="dl"]'), "button available again");
});

test("corrupt stored data does not break the app", () => {
  const a = boot({ seed: [["subs", [1, 2]], ["queue", "oops"], ["dl", null]] });
  openPod(a);
  assert.match(a.$("#podBody").textContent, /No subscriptions yet/);
});

/* ---- Regressions from the code review ---- */
async function withDownloaded(opts) {
  const a = boot(opts); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  const row = (n) => a.$$("#epList .pod-row").find((r) => r.textContent.includes("Episode " + n));
  row(3).querySelector('[data-act="dl"]').click(); await tick(100);       // ep3 available offline
  assert.ok(a.ls("dl")["1003"]);
  a.row = row; return a;
}

test("switching from a playing episode to a downloaded one never writes A's position into B", async () => {
  const a = await withDownloaded();
  a.row(2).querySelector('[data-act="play"]').click(); await tick();      // A = ep2 (streamed)
  a.pod.currentTime = 1234;
  a.row(3).querySelector('[data-act="play"]').click();                    // B = ep3 (IndexedDB read still pending)
  const real = a.w.Date.now; a.w.Date.now = () => real() + 10000;         // 5s save throttle has elapsed
  a.pod.currentTime = 1234; a.pod.emit("timeupdate");                     // A's audio is still the loaded source
  await tick(80);
  assert.equal(a.ls("pos")["1003"], undefined, "B must not inherit A's position");
  assert.equal(a.ls("pos")["1002"], 1234, "A keeps its own position");
});

test("selecting a radio station cancels a pending podcast start", async () => {
  const a = await withDownloaded();
  a.$('[data-ptab="dl"]').click();
  a.$('[data-act="play"]').click();                                       // pending IndexedDB read
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click();  // radio takes over immediately
  await tick(80);
  assert.equal(a.pod.paused, true, "podcast must not start after radio");
  assert.equal(a.pod.src, "", "podcast source must not be applied");
  assert.ok(a.radio.src.includes("ice1.somafm.com"));
  assert.ok(!a.d.body.classList.contains("pod"));
});

test("leaving the podcast for radio saves the podcast position", async () => {
  const a = await withDownloaded();
  a.row(2).querySelector('[data-act="play"]').click(); await tick();
  a.pod.currentTime = 321;
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click(); await tick();
  assert.equal(a.ls("pos")["1002"], 321);
});

test("http enclosures are downloaded via https", async () => {
  const a = boot({ httpEnclosure: true }); openPod(a); await search(a, "techno");
  a.$$('[data-act="show"]')[0].click(); await tick();
  a.$$("#epList .pod-row").find((r) => r.textContent.includes("Episode 3")).querySelector('[data-act="dl"]').click(); await tick(100);
  assert.ok(a.calls.includes("https://cdn.test/ep3.mp3"), "https URL requested");
  assert.ok(!a.calls.includes("http://cdn.test/ep3.mp3"), "no mixed-content request");
  assert.ok(a.ls("dl")["1003"], "download succeeded");
});

test("feed result for an outdated subscription set is discarded and reloaded", async () => {
  const a = boot({ gate: true, seed: [["subs", { 111: { id: "111", name: "S1", artist: "a", art: "", seen: "2026-01-01T00:00:00Z" } }], ["view", "pod"]] });
  await tick();                                                           // feed request for show 111 is in flight
  a.$('[data-ptab="search"]').click(); await search(a, "techno");
  a.$$('[data-act="sub"]')[1].click();                                    // subscribe to show 222 meanwhile
  assert.deepEqual(Object.keys(a.ls("subs")).sort(), ["111", "222"]);
  a.release(); await tick(100);
  a.$('[data-ptab="subs"]').click(); await tick(100);
  assert.ok(a.calls.some((u) => /lookup\?id=222&entity=podcastEpisode&limit=8/.test(u)), "feed reloaded for the new subscription set");
  assert.equal(a.$$(".show-card").length, 2);
});

test("resume offset survives leaving before the initial seek is applied", async () => {
  const mk = async () => {
    const a = boot({ seed: [["pos", { 1003: 600 }]] }); openPod(a); await search(a, "techno");
    a.$$('[data-act="show"]')[0].click(); await tick();
    a.row = (n) => a.$$("#epList .pod-row").find((r) => r.textContent.includes("Episode " + n));
    return a;
  };
  // B has a saved offset; user starts B, then switches to radio before loadedmetadata
  let a = await mk();
  a.row(3).querySelector('[data-act="play"]').click(); await tick();
  assert.equal(a.pod.src, "https://cdn.test/ep3.mp3");                      // B loaded, currentTime still 0
  a.$('[data-mode="radio"]').click(); a.$('[data-id="soma-groovesalad"]').click(); await tick();
  assert.equal(a.ls("pos")["1003"], 600, "radio switch must not overwrite B's progress with 0");
  // ... or picks another episode in that window
  a = await mk();
  a.row(3).querySelector('[data-act="play"]').click(); await tick();
  a.row(2).querySelector('[data-act="play"]').click(); await tick();
  assert.equal(a.ls("pos")["1003"], 600, "switching episodes must not overwrite B's progress with 0");
  // ... or pauses
  a = await mk();
  a.row(3).querySelector('[data-act="play"]').click(); await tick();
  a.$("#play").click(); await tick();
  assert.equal(a.ls("pos")["1003"], 600, "pausing before metadata must not overwrite B's progress");
  // once the seek has been applied, progress is tracked normally again
  a.$("#play").click(); a.pod.duration = 3600; a.pod.emit("loadedmetadata");
  assert.equal(a.pod.currentTime, 600);
  a.pod.currentTime = 650; a.pod.pause(); await tick();
  assert.equal(a.ls("pos")["1003"], 650);
});
