// Sleep timer: panel, presets, adjusting, cancelling, countdown, fade-out and expiry.
const { test } = require("node:test");
const assert = require("node:assert");
const { boot, tick } = require("./helpers");

const MIN = 60000;
const open = (a) => a.click("#sleep");
const preset = (a, m) => a.click('[data-min="' + m + '"]');
const adj = (a, m) => a.click('[data-adj="' + m + '"]');
const label = (a) => a.$("#sleep").textContent;
const big = (a) => a.$("#spLeft").textContent;

test("the panel opens and closes; the button reflects it", () => {
  const a = boot();
  assert.equal(a.$("#sleepPanel").hidden, true);
  assert.equal(a.$("#sleep").getAttribute("aria-expanded"), "false");
  open(a);
  assert.equal(a.$("#sleepPanel").hidden, false);
  assert.equal(a.$("#sleep").getAttribute("aria-expanded"), "true");
  open(a);
  assert.equal(a.$("#sleepPanel").hidden, true);
  assert.equal(a.$("#sleep").getAttribute("aria-expanded"), "false");
});

test("idle: timer off, cancel and adjust buttons are disabled", () => {
  const a = boot();
  open(a);
  assert.equal(label(a), "Timer off"); assert.equal(big(a), "Off");
  assert.equal(a.$("#spOff").disabled, true);
  assert.ok(a.$$("[data-adj]").every((b) => b.disabled));
  assert.ok(a.$$("[data-min]").every((b) => !b.disabled), "presets always work");
});

test("every preset starts the timer", () => {
  for (const m of [5, 15, 30, 45, 60, 90]) {
    const a = boot(); open(a); preset(a, m);
    assert.equal(label(a), m + " min left", "preset " + m);
    assert.equal(a.$("#spOff").disabled, false);
  }
});

test("a preset replaces the running time", () => {
  const a = boot(); open(a);
  preset(a, 90); preset(a, 15);
  assert.equal(label(a), "15 min left"); assert.equal(big(a), "15:00");
});

test("adding and removing time", () => {
  const a = boot(); open(a);
  preset(a, 30);
  adj(a, 15); assert.equal(label(a), "45 min left");
  adj(a, -5); assert.equal(label(a), "40 min left");
  adj(a, -15); assert.equal(label(a), "25 min left");
  adj(a, 5); assert.equal(label(a), "30 min left");
  assert.equal(big(a), "30:00");
});

test("time can be reduced but never below one minute (cancel is a separate button)", () => {
  const a = boot(); open(a);
  preset(a, 15);
  adj(a, -15); adj(a, -15);
  assert.equal(label(a), "1 min left"); assert.equal(big(a), "1:00");
  assert.equal(a.$("#spOff").disabled, false, "still running");
});

test("time is capped at 240 minutes and shows hours", () => {
  const a = boot(); open(a);
  preset(a, 90);
  for (let i = 0; i < 12; i++) adj(a, 15);
  assert.equal(label(a), "240 min left"); assert.equal(big(a), "4:00:00");
  preset(a, 60); adj(a, 15); adj(a, 5);
  assert.equal(big(a), "1:20:00");
});

test("adjusting does nothing while no timer runs", () => {
  const a = boot(); open(a);
  adj(a, -5); adj(a, 15);
  assert.equal(label(a), "Timer off");
  assert.equal(a.clock.pending, 0);
});

test("cancel stops the timer completely and leaves no timers behind", () => {
  const a = boot(); open(a);
  preset(a, 30);
  a.click("#spOff");
  assert.equal(label(a), "Timer off"); assert.equal(big(a), "Off");
  assert.equal(a.$("#spOff").disabled, true);
  assert.equal(a.clock.pending, 0);
  a.run(60 * MIN);                         // nothing fires
  assert.equal(label(a), "Timer off");
});

test("the countdown follows the clock", () => {
  const a = boot(); open(a);
  preset(a, 15);
  a.run(1 * MIN); assert.equal(label(a), "14 min left");
  a.run(30 * 1000); assert.equal(big(a), "13:30");
  a.run(13 * MIN); assert.equal(big(a), "0:30");
  assert.equal(label(a), "30 s left", "the last minute counts seconds");
});

test("expiry pauses the radio, tells the user and resets the timer", () => {
  const a = boot();
  a.live("nts-1"); open(a); preset(a, 15);
  a.run(15 * MIN);
  assert.equal(a.status(), "Sleep timer finished");
  assert.equal(a.radio.src, "", "stream released");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Play");
  assert.equal(a.isPlaying(), false);
  assert.equal(label(a), "Timer off");
  assert.equal(a.$("#spOff").disabled, true);
  a.run(MIN);
  assert.equal(a.clock.pending, 0, "no timers left");
});

test("expiry also works when nothing was playing", () => {
  const a = boot(); open(a); preset(a, 5);
  a.run(5 * MIN);
  assert.equal(a.status(), "Sleep timer finished");
  assert.equal(label(a), "Timer off");
});

test("volume fades out over the last 20 seconds and is restored afterwards", () => {
  const a = boot();
  a.live("nts-1"); open(a); preset(a, 5);
  a.run(5 * MIN - 25 * 1000);
  assert.equal(a.radio.volume, 0.8, "no fade before the last 20 s");
  a.run(15 * 1000);                        // 10 s left
  assert.ok(Math.abs(a.radio.volume - 0.4) < 0.02, "half volume at 10 s, got " + a.radio.volume);
  assert.equal(a.pod.volume, a.radio.volume, "the file player fades together with the radio");
  a.run(9 * 1000);                         // 1 s left
  assert.ok(a.radio.volume < 0.06, "almost silent, got " + a.radio.volume);
  a.run(1000);
  assert.equal(a.radio.volume, 0.8, "volume is back for the next playback");
  assert.equal(a.pod.volume, 0.8);
});

test("the fade respects the volume slider and mute", () => {
  const a = boot();
  a.$("#vol").value = 50; a.$("#vol").dispatchEvent(new a.w.Event("input"));
  a.live("nts-1"); open(a); preset(a, 5);
  a.run(5 * MIN - 10 * 1000);
  assert.ok(Math.abs(a.radio.volume - 0.25) < 0.02, "0.5 x 0.5, got " + a.radio.volume);
  a.click("#mute");
  assert.equal(a.radio.volume, 0);
  a.click("#mute");
  assert.ok(a.radio.volume > 0);
});

test("adding time during the fade brings the volume back", () => {
  const a = boot();
  a.live("nts-1"); open(a); preset(a, 5);
  a.run(5 * MIN - 8 * 1000);
  assert.ok(a.radio.volume < 0.4);
  adj(a, 5);
  assert.equal(a.radio.volume, 0.8);
  assert.equal(label(a), "6 min left");
});

test("cancelling during the fade brings the volume back", () => {
  const a = boot();
  a.live("nts-1"); open(a); preset(a, 5);
  a.run(5 * MIN - 8 * 1000);
  a.click("#spOff");
  assert.equal(a.radio.volume, 0.8);
  a.run(1000);
  assert.equal(a.status(), "Live", "playback continues");
  assert.equal(a.clock.pending, 1, "only the stream watchdog is left");
});

test("with the panel closed the timer wakes up about once a minute, not every second", () => {
  const a = boot(); open(a); preset(a, 5); open(a);
  assert.equal(a.clock.pending, 1);
  assert.ok(a.clock.nextIn > 59000, "next wake-up in " + a.clock.nextIn + " ms");
  a.run(a.clock.nextIn);
  assert.equal(label(a), "4 min left", "label still correct after the long sleep");
  a.run(3 * MIN);                          // 1 min left
  a.run(1000);
  assert.ok(a.clock.nextIn <= 1000, "last minute ticks every second");
  assert.equal(label(a), "59 s left");
});

test("with the panel open the countdown ticks every second", () => {
  const a = boot(); open(a); preset(a, 5);
  assert.ok(a.clock.nextIn <= 1000);
  a.run(1000);
  assert.equal(big(a), "4:59");
});

test("the timer keeps running when the station changes", () => {
  const a = boot();
  a.live("nts-1"); open(a); preset(a, 15);
  a.play("fip"); a.run(10 * MIN + 100);   // choosing a station closes the panel: the label refreshes 50 ms after each full minute
  assert.equal(label(a), "5 min left");
  a.run(5 * MIN);
  assert.equal(a.status(), "Sleep timer finished");
});

test("Escape and a click outside close the panel; clicks inside do not", () => {
  const a = boot();
  open(a); a.key("Escape");
  assert.equal(a.$("#sleepPanel").hidden, true);
  open(a); a.$("#sleepPanel").click();
  assert.equal(a.$("#sleepPanel").hidden, false, "inside click");
  preset(a, 15);
  assert.equal(a.$("#sleepPanel").hidden, false, "panel stays open after a preset");
  a.d.body.click();
  assert.equal(a.$("#sleepPanel").hidden, true, "outside click");
  assert.equal(label(a), "15 min left", "closing does not cancel the timer");
});

test("Space on a panel button does not toggle playback", () => {
  const a = boot();
  a.live("nts-1"); open(a);
  a.key("Space", a.$('[data-min="15"]'));
  assert.equal(a.status(), "Live");
  assert.equal(a.$("#play").getAttribute("aria-label"), "Pause");
});

test("all panel texts are in English", () => {
  const a = boot(); open(a);
  const texts = a.$$("#sleepPanel *").map((e) => (e.children.length ? "" : e.textContent) + " " + (e.getAttribute("aria-label") || "")).join(" ");
  for (const w of ["Sleep timer", "Start in minutes", "Change time", "15 minutes less", "5 minutes more", "Timer off", "fades out"]) assert.ok(texts.includes(w) || a.$("#sleepPanel").textContent.includes(w), "missing: " + w);
});

test("expiry pauses a playing podcast, not only the radio, and fades it too", async () => {
  const ep = { id: "7", title: "Night talk", show: "Late Show", showId: "1", art: "", url: "https://cdn.test/ep7.mp3", ms: 3600000, date: "2026-10-10T10:00:00Z" };
  const a = boot({ seed: [["queue", [ep]], ["view", "pod"]] });
  a.click('[data-ptab="queue"]');
  a.click('[data-act="play"]');
  await tick(20);
  assert.equal(a.pod.src, "https://cdn.test/ep7.mp3", "the podcast is loaded in the file player");
  assert.equal(a.title(), "Night talk");
  open(a); preset(a, 5);
  a.run(5 * MIN - 10 * 1000);
  assert.ok(Math.abs(a.pod.volume - 0.4) < 0.02, "podcast volume fades too, got " + a.pod.volume);
  a.run(10 * 1000);
  assert.equal(a.pod.paused, true, "the podcast is paused");
  assert.equal(a.pod.volume, 0.8, "volume restored");
  assert.equal(a.status(), "Sleep timer finished");
  assert.equal(a.radio.plays || 0, 0, "the radio was never touched");
});
