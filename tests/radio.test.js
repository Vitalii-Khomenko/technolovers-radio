// Radio playback: starting, switching, reconnecting, watchdog and idle behaviour.
const { test } = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers");

const SOMA1 = "https://ice1.somafm.com/groovesalad-128-mp3";
const SOMA2 = "https://ice2.somafm.com/groovesalad-128-mp3";
const NTS1 = "https://stream-relay-geo.ntslive.net/stream";

/* ---------- starting ---------- */
test("the first click starts the stream at once (inside the click, for autoplay rules)", () => {
  const a = boot();
  a.play("soma-groovesalad");
  assert.equal(a.radio.src, SOMA1);
  assert.equal(a.radio.plays, 1);
  assert.equal(a.status(), "Connecting …");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Pause");
  assert.equal(a.isPlaying(), false, "the playing display waits for the audio element");
  assert.equal(a.clock.pending, 1, "only the watchdog runs while something should play");
});

test("hero, dock, page title and lock screen show the chosen station", () => {
  const a = boot();
  a.live("soma-groovesalad");
  assert.equal(a.$("#nowName").textContent, "Groove Salad");
  assert.equal(a.title(), "SomaFM Groove Salad");
  assert.equal(a.$("#nowLabel").textContent, "SomaFM");
  assert.equal(a.d.title, "SomaFM Groove Salad · Technolovers Radio");
  assert.equal(a.status(), "Live");
  assert.equal(a.isPlaying(), true);
  assert.equal(a.ls("last"), "soma-groovesalad");
});

test("cards show only the operator; the hero label adds the country", () => {
  const a = boot();
  assert.equal(a.$('.card[data-id="fip"] .tag').textContent, "FIP");
  assert.equal(a.$('.card[data-id="ig-dream"] .tag').textContent, "Intergalactic FM");
  a.play("ig-dream");
  assert.equal(a.$("#nowLabel").textContent, "Intergalactic FM · Netherlands");
  assert.equal(a.title(), "Intergalactic Dream Machine");
});

/* ---------- switching ---------- */
test("clicking the station that already plays does nothing", () => {
  const a = boot();
  a.live("soma-groovesalad");
  const srcs = a.radio.srcLog.length, plays = a.radio.plays;
  a.play("soma-groovesalad"); a.play("soma-groovesalad");
  a.clock.advance(5000);
  assert.equal(a.radio.srcLog.length, srcs);
  assert.equal(a.radio.plays, plays);
  assert.equal(a.isPlaying(), true);
});

test("switching drops the old stream and the playing display immediately", () => {
  const a = boot();
  a.live("soma-groovesalad");
  a.play("nts-1");
  assert.equal(a.radio.src, "", "old stream released at once");
  assert.equal(a.isPlaying(), false, "no playing animation while the new station connects");
  assert.equal(a.status(), "Connecting …");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Pause", "play button still says pause: playback was asked for");
  assert.ok(a.card("nts-1").classList.contains("active"));
  assert.ok(!a.card("soma-groovesalad").classList.contains("active"));
  a.clock.advance(250);
  assert.equal(a.radio.src, NTS1, "connects once the short delay is over");
  a.radio.emit("playing");
  assert.equal(a.isPlaying(), true);
});

test("switching does not rebuild the station grid", () => {
  const a = boot();
  const before = a.card("fip");
  a.live("soma-groovesalad"); a.play("fip");
  assert.equal(a.card("fip"), before, "same DOM node: only the active class moved");
  assert.equal(a.$$(".card.active").length, 1);
});

test("flipping quickly through stations connects only to the last one", () => {
  const a = boot();
  a.live("soma-groovesalad");
  const start = a.radio.srcLog.length;
  a.play("nts-1"); a.clock.advance(60); a.play("fip"); a.clock.advance(60); a.play("kexp");
  a.clock.advance(1000);
  const connected = a.radio.srcLog.slice(start).filter(Boolean);
  assert.deepEqual(connected, ["https://kexp-mp3-128.streamguys1.com/kexp128.mp3"]);
  assert.equal(a.title(), "KEXP");
});

test("pause while a switch is still connecting cancels the connection", () => {
  const a = boot();
  a.live("soma-groovesalad");
  a.play("nts-1");
  a.click("#play");
  assert.equal(a.status(), "Paused");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Play");
  a.clock.advance(5000);
  assert.equal(a.radio.src, "", "nothing connects afterwards");
  assert.equal(a.clock.pending, 0, "no timers are left behind");
});

test("starting from pause after a switch works", () => {
  const a = boot();
  a.live("soma-groovesalad");
  a.click("#play");                                  // pause
  a.play("nts-1");                                   // choose another station while paused: starts at once
  assert.equal(a.radio.src, NTS1);
  assert.equal(a.status(), "Connecting …");
});

test("keyboard: arrows switch station, Space pauses and resumes", () => {
  const a = boot();
  a.live("soma-groovesalad");
  a.key("ArrowRight"); a.clock.advance(300);
  assert.equal(a.title(), "SomaFM Deep Space One");
  a.key("ArrowLeft"); a.clock.advance(300);
  assert.equal(a.title(), "SomaFM Groove Salad");
  a.key("Space");
  assert.equal(a.status(), "Paused");
  a.key("Space");
  assert.equal(a.status(), "Connecting …");
});

/* ---------- failures and reconnecting ---------- */
test("after all addresses failed, Play tries the first address again", () => {
  const a = boot();
  a.play("soma-groovesalad");
  const first = a.radio.src;
  for (let i = 0; i < 40 && a.$("#play").getAttribute("aria-label") === "Pause"; i++) { a.radio.emit("error"); a.clock.advance(5000); }
  assert.equal(a.radio.src, "", "player gave up");
  a.click("#play");
  assert.equal(a.radio.src, first, "second Play starts from the first address");
});

test("the backup address is tried when the first one fails", () => {
  const a = boot();
  a.play("soma-groovesalad");
  a.radio.emit("error");
  assert.equal(a.radio.src, SOMA2);
});

test("a failing first connection is retried twice with backoff before giving up", () => {
  const a = boot();
  a.play("soma-groovesalad");
  a.radio.emit("error"); a.radio.emit("error");      // both addresses fail
  assert.equal(a.status(), "Reconnecting …");
  a.clock.advance(999); assert.equal(a.radio.src, SOMA2, "waits 1 s");
  a.clock.advance(1); assert.equal(a.radio.src, SOMA1, "retry 1 starts from the first address again");
  a.radio.emit("error"); a.radio.emit("error");
  assert.equal(a.status(), "Reconnecting …");
  a.clock.advance(1999); assert.notEqual(a.radio.src, SOMA1, "second wait is 2 s");
  a.clock.advance(1); assert.equal(a.radio.src, SOMA1, "retry 2");
  a.radio.emit("error"); a.radio.emit("error");
  assert.equal(a.status(), "Stream unreachable. Pick another station.");
  assert.ok(a.$("#dockS").classList.contains("err"));
  assert.equal(a.$("#play").getAttribute("aria-label"), "Play");
  assert.equal(a.isPlaying(), false);
});

test("a stream that played before is reconnected forever on the same address (never falls back, never gives up)", () => {
  const a = boot();
  a.live("soma-groovesalad");
  const url = a.radio.src;
  for (let i = 0; i < 12; i++) {
    a.radio.emit("error");
    assert.equal(a.status(), "Reconnecting …");
    assert.equal(a.isPlaying(), false);
    a.clock.advance(5000);
    assert.equal(a.radio.src, url, "same address, attempt " + (i + 1));
  }
  assert.equal(a.$("#play").getAttribute("aria-label"), "Pause");
  a.radio.emit("playing");
  assert.equal(a.status(), "Live");
});

test("the working address is remembered and tried first on the next start", () => {
  const a = boot();
  a.play("soma-groovesalad");
  a.radio.emit("error");                             // first address fails, second is used
  assert.equal(a.radio.src, SOMA2);
  a.radio.emit("playing");                           // second works: remembered
  assert.deepEqual(a.ls("good"), { "soma-groovesalad": SOMA2 });
  a.click("#play"); a.click("#play");                // pause, play
  assert.equal(a.radio.src, SOMA2);
});

test("a stream that ends is reconnected", () => {
  const a = boot();
  a.live("nts-1");
  a.radio.emit("ended");
  assert.equal(a.status(), "Reconnecting …");
  a.clock.advance(1000);
  assert.equal(a.radio.src, NTS1);
  assert.equal(a.radio.srcLog.length, 2);
});

test("buffering and stalls only change the status text", () => {
  const a = boot();
  a.live("nts-1");
  a.radio.emit("waiting"); assert.equal(a.status(), "Buffering …");
  a.radio.emit("stalled"); assert.equal(a.status(), "Connection unstable …");
  assert.equal(a.radio.srcLog.length, 1, "no reconnect for short stalls");
});

/* ---------- watchdog ---------- */
test("watchdog: a stream without progress for about 12 s is reconnected", () => {
  const a = boot();
  a.live("nts-1");
  a.clock.advance(12000);
  assert.equal(a.status(), "Live", "not yet");
  a.clock.advance(3000);
  assert.equal(a.status(), "Reconnecting …");
  a.clock.advance(1000);
  assert.equal(a.radio.srcLog.length, 2);
});

test("watchdog: a stream that keeps progressing is left alone", () => {
  const a = boot();
  a.live("nts-1");
  for (let i = 0; i < 60; i++) { a.radio.currentTime += 3; a.clock.advance(3000); }
  assert.equal(a.status(), "Live");
  assert.equal(a.radio.srcLog.length, 1);
});

test("watchdog: coming back online speeds up detecting a dead stream, but leaves a healthy one alone", () => {
  const a = boot();
  a.live("nts-1");
  a.clock.advance(3000);
  a.w.dispatchEvent(new a.w.Event("online"));
  a.clock.advance(3000);
  assert.equal(a.status(), "Reconnecting …", "dead stream: reconnect on the next tick");
  const b = boot();
  b.live("nts-1");
  b.clock.advance(3000);
  b.w.dispatchEvent(new b.w.Event("online"));
  b.radio.currentTime = 7; b.clock.advance(3000);
  assert.equal(b.status(), "Live", "healthy stream: nothing happens");
});

/* ---------- battery: no timers while idle ---------- */
test("no timers run while nothing plays", () => {
  const a = boot();
  assert.equal(a.clock.pending, 0, "idle after start-up");
  a.live("nts-1");
  assert.equal(a.clock.pending, 1, "one watchdog while playing");
  a.click("#play");                                  // pause
  a.clock.advance(3000);
  assert.equal(a.clock.pending, 0, "the watchdog switches itself off");
});

test("a hidden tab pauses all animations", () => {
  const a = boot();
  a.live("nts-1");
  const cls = (c) => a.d.body.classList.contains(c);
  assert.equal(cls("bg"), false);
  Object.defineProperty(a.d, "hidden", { value: true, configurable: true });
  a.d.dispatchEvent(new a.w.Event("visibilitychange"));
  assert.equal(cls("bg"), true);
  Object.defineProperty(a.d, "hidden", { value: false, configurable: true });
  a.d.dispatchEvent(new a.w.Event("visibilitychange"));
  assert.equal(cls("bg"), false);
});

test("a header scrolled out of view pauses only the header animations, not the card equaliser", () => {
  const a = boot();
  a.live("nts-1");
  a.w.__io([{ isIntersecting: false }]);
  assert.equal(a.d.body.classList.contains("still"), true);
  assert.equal(a.d.body.classList.contains("bg"), false, "the page itself is still visible");
  a.w.__io([{ isIntersecting: true }]);
  assert.equal(a.d.body.classList.contains("still"), false);
});

test("a page that starts in a background tab starts with its animations paused", () => {
  const a = boot({ hidden: true });
  assert.equal(a.d.body.classList.contains("bg"), true);
});

/* ---------- lock screen / media keys ---------- */
test("the lock screen state follows the stream, also while switching stations", () => {
  const a = boot({ mediaSession: true });
  const ms = () => a.w.navigator.mediaSession;
  a.live("soma-groovesalad");
  assert.equal(ms().playbackState, "playing");
  assert.equal(ms().metadata.title, "SomaFM Groove Salad");
  a.play("nts-1");
  assert.equal(ms().playbackState, "paused", "the old stream is gone: do not offer pause while the new one connects");
  a.clock.advance(250); a.radio.emit("playing");
  assert.equal(ms().playbackState, "playing");
  a.click("#play");
  assert.equal(ms().playbackState, "paused");
});

/* ---------- mute and volume ---------- */
test("volume and mute reach the audio element and are remembered", () => {
  const a = boot();
  a.$("#vol").value = 40; a.$("#vol").dispatchEvent(new a.w.Event("input"));
  assert.equal(a.radio.volume, 0.4); assert.equal(a.ls("vol"), 40);
  a.click("#mute"); assert.equal(a.radio.volume, 0);
  a.click("#mute"); assert.equal(a.radio.volume, 0.4);
  assert.equal(a.pod.volume, 0.4, "the file player follows the same volume");
});
