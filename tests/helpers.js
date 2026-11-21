// Shared test helpers: boots index.html in jsdom with a fake Audio element and a fake clock.
// The fake clock replaces setTimeout/setInterval/Date inside the page only, so tests never wait for real time.
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(process.env.HTML || path.join(ROOT, "index.html"), "utf8");

class FakeClock {
  constructor() { this.now = 1_000_000_000_000; this.seq = 0; this.timers = new Map(); }
  install(w) {
    const c = this;
    w.setTimeout = (fn, ms) => { const id = ++c.seq; c.timers.set(id, { fn, due: c.now + (+ms || 0), every: 0 }); return id; };
    w.setInterval = (fn, ms) => { const id = ++c.seq; c.timers.set(id, { fn, due: c.now + (+ms || 0), every: Math.max(1, +ms || 0) }); return id; };
    w.clearTimeout = w.clearInterval = (id) => { c.timers.delete(id); };
    const Real = w.Date;
    w.Date = class extends Real {
      constructor(...a) { if (a.length) super(...a); else super(c.now); }
      static now() { return c.now; }
    };
  }
  // run every timer that becomes due within the next ms milliseconds, in order
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of this.timers) if (t.due <= end && (!next || t.due < next.t.due || (t.due === next.t.due && id < next.id))) next = { id, t };
      if (!next) break;
      this.now = Math.max(this.now, next.t.due);
      if (next.t.every) next.t.due += next.t.every; else this.timers.delete(next.id);
      next.t.fn();
    }
    this.now = end;
  }
  get pending() { return this.timers.size; }
  // milliseconds until the earliest pending timer (Infinity when none)
  get nextIn() { let m = Infinity; for (const t of this.timers.values()) m = Math.min(m, t.due - this.now); return m; }
}

function boot(opts = {}) {
  const clock = new FakeClock();
  const audios = [];
  const dom = new JSDOM(opts.html || HTML, {
    url: opts.url || "https://example.test/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (opts.fakeTimers !== false) clock.install(w);
      w.Audio = class {
        constructor() {
          this._l = {}; this._src = ""; this.srcLog = []; this.volume = 1; this.paused = true; this.ended = false;
          this.currentTime = 0; this.duration = NaN; this.playbackRate = 1; this.defaultPlaybackRate = 1; this.preload = ""; this.crossOrigin = null;
          audios.push(this);
        }
        set src(v) { this._src = v; this.srcLog.push(v); this.ended = false; this.currentTime = 0; }
        get src() { return this._src; }
        get currentSrc() { return this._src; }
        getAttribute(a) { return a === "src" ? this._src : null; }
        removeAttribute(a) { if (a === "src") this._src = ""; }
        addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
        emit(t) { (this._l[t] || []).slice().forEach((f) => f()); }
        load() { this.loads = (this.loads || 0) + 1; }
        play() { this.paused = false; this.plays = (this.plays || 0) + 1; return Promise.resolve(); }
        pause() { this.paused = true; }
      };
      // IntersectionObserver: tests call w.__io([{ isIntersecting }]) to say whether the header is on screen
      w.IntersectionObserver = class { constructor(cb) { w.__io = cb; } observe() {} disconnect() {} };
      if (opts.hidden) Object.defineProperty(w.document, "hidden", { value: true, configurable: true });
      if (opts.mediaSession) {                       // lock-screen controls: records the state the app asks for
        const ms = { playbackState: "none", metadata: null, handlers: {}, setActionHandler(n, f) { ms.handlers[n] = f; } };
        Object.defineProperty(w.navigator, "mediaSession", { value: ms, configurable: true });
        w.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
      }
      w.indexedDB = new IDBFactory();
      w.URL.createObjectURL = () => "blob:test"; w.URL.revokeObjectURL = () => {};
      w.scrollTo = () => {};
      w.fetch = () => Promise.reject(new TypeError("network is not available in tests"));
      (opts.seed || []).forEach(([k, v]) => w.localStorage.setItem("tl_" + k, JSON.stringify(v)));
    },
  });
  const w = dom.window, d = w.document;
  const api = {
    w, d, clock, audios, radio: audios[0], pod: audios[1],
    $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
    ls: (k) => JSON.parse(w.localStorage.getItem("tl_" + k)),
    click: (s) => api.$(s).click(),
    card: (id) => api.$('.card[data-id="' + id + '"]'),
    play: (id) => api.card(id).click(),
    status: () => api.$("#dockS").textContent,
    title: () => api.$("#dockT").textContent,
    isPlaying: () => d.body.classList.contains("playing"),
    // a station is really playing once the audio element reports "playing"
    live: (id) => { api.play(id); api.radio.emit("playing"); },
    // let time pass like in real life: a playing stream makes progress, so the watchdog stays quiet
    run: (ms) => {
      for (let left = ms; left > 0;) {
        const step = Math.min(1000, left);
        if (api.radio && !api.radio.paused && api.radio.src) api.radio.currentTime += step / 1000;
        clock.advance(step); left -= step;
      }
    },
    key: (code, target) => (target || d).dispatchEvent(new w.KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true })),
  };
  return api;
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
module.exports = { boot, tick, ROOT, HTML, FakeClock };
