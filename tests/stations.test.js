// Station list, categories, favourites, start-up state and the (absent) radio search.
const { test } = require("node:test");
const assert = require("node:assert");
const { boot, HTML } = require("./helpers");

// Streams may only come from these providers, and only over https.
const HOSTS = ["somafm.com", "ntslive.net", "radiofrance.fr", "dlf.de", "streamguys1.com", "radioparadise.com", "airtime.pro", "rrr.org.au", "intergalactic.fm", "nrk.no", "listen.moe"];
const ids = (a) => a.$$(".card").map((c) => c.getAttribute("data-id"));
const chip = (a, cat) => a.$('.chip[data-cat="' + cat + '"]');

test("the grid shows all 32 stations with unique ids", () => {
  const a = boot();
  assert.equal(a.$$(".card").length, 32);
  assert.equal(new Set(ids(a)).size, 32);
  assert.equal(a.$("#count").textContent, "32 of 32 stations");
});

test("every station has an English label and a genre line", () => {
  const a = boot();
  for (const c of a.$$(".card")) {
    assert.match(c.getAttribute("aria-label"), /^Play .+/);
    assert.ok(c.querySelector(".nm").textContent.trim(), "name");
    assert.ok(c.querySelector(".bpm").textContent.trim(), "genre line");
    assert.ok(c.querySelector(".tag").textContent.trim(), "operator");
  }
});

test("worldwide stations name their country in the genre line and in the hero label", () => {
  const a = boot();
  chip(a, "world").click();
  assert.equal(a.$$(".card").length, 20);
  for (const c of a.$$(".card")) assert.match(c.querySelector(".bpm").textContent, / · /, c.getAttribute("data-id"));
  for (const id of ["fip", "kexp", "raheem", "triple-r", "nrk-p3", "listenmoe-jpop"]) {
    a.play(id);
    assert.match(a.$("#nowLabel").textContent, / · [A-Z]/, id + " hero label has a country");
  }
});

test("every station streams over https from a known provider", () => {
  const all = ids(boot());
  assert.equal(all.length, 32);
  for (const id of all) {
    const a = boot();
    a.play(id);
    const url = new URL(a.radio.src);
    assert.equal(url.protocol, "https:", id + " must use https");
    assert.ok(HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h)), id + " host " + url.hostname + " is not in the allow-list");
    assert.ok(!/technolovers/.test(a.radio.src), id + " must not use technolovers.fm");
  }
});

test("SomaFM stations have a backup server", () => {
  const a = boot();
  a.play("soma-thetrip");
  assert.match(a.radio.src, /^https:\/\/ice1\.somafm\.com\/thetrip-128-mp3$/);
  a.radio.emit("error");
  assert.match(a.radio.src, /^https:\/\/ice2\.somafm\.com\/thetrip-128-mp3$/);
});

test("category chips list every category with the right count", () => {
  const a = boot();
  const txt = (cat) => chip(a, cat).textContent.replace(/\s+/g, " ").trim();
  assert.equal(txt("all"), "All 32");
  assert.equal(txt("fav"), "Favourites 0");
  assert.equal(txt("chill"), "Chill & Ambient 6");
  assert.equal(txt("house"), "House & Trance 2");
  assert.equal(txt("bass"), "Bass & Glitch 2");
  assert.equal(txt("mix"), "Eclectic 2");
  assert.equal(txt("world"), "Worldwide 20");
  const sum = ["chill", "house", "bass", "mix", "world"].reduce((n, c) => n + +chip(a, c).querySelector("span").textContent, 0);
  assert.equal(sum, 32, "every station is in exactly one category");
});

test("a category chip filters the grid and updates the counter", () => {
  const a = boot();
  chip(a, "bass").click();
  assert.deepEqual(ids(a), ["soma-cliqhop", "soma-dubstep"]);
  assert.equal(a.$("#count").textContent, "2 of 32 stations");
  assert.equal(chip(a, "bass").getAttribute("aria-pressed"), "true");
  assert.equal(chip(a, "all").getAttribute("aria-pressed"), "false");
  chip(a, "all").click();
  assert.equal(a.$$(".card").length, 32);
});

test("the radio view has no search box (podcasts keep theirs)", () => {
  const a = boot();
  assert.equal(a.$("#q"), null);
  assert.equal(a.$$("#radioView input").length, 0);
  assert.ok(a.$("#pq"), "podcast search");
  assert.match(HTML, /\.chips\s*\{[^}]*flex-wrap:\s*wrap/, "category chips wrap onto several lines");
  assert.doesNotMatch(HTML.match(/\.chips\s*\{[^}]*\}/)[0], /overflow-x/, "no sideways scrolling");
});

test("the hue follows the category of the chosen station", () => {
  const a = boot();
  a.play("soma-cliqhop");
  assert.equal(a.d.documentElement.style.getPropertyValue("--h"), "12");
  a.clock.advance(300); a.play("fip");
  assert.equal(a.d.documentElement.style.getPropertyValue("--h"), "150");
});

/* ---------- favourites ---------- */
test("a heart adds and removes a favourite and remembers it", () => {
  const a = boot();
  const heart = () => a.$('[data-fav="fip"]');
  assert.equal(heart().getAttribute("aria-label"), "Add to favourites");
  heart().click();
  assert.deepEqual(a.ls("favs"), ["fip"]);
  assert.equal(heart().getAttribute("aria-pressed"), "true");
  assert.equal(heart().getAttribute("aria-label"), "Remove favourite");
  assert.equal(chip(a, "fav").querySelector("span").textContent, "1");
  heart().click();
  assert.deepEqual(a.ls("favs"), []);
});

test("the favourites filter shows only favourites, with a hint when empty", () => {
  const a = boot();
  chip(a, "fav").click();
  assert.match(a.$("#grid").textContent, /No favourites yet\. Tap the heart on a card\./);
  chip(a, "all").click(); a.$('[data-fav="kexp"]').click(); a.$('[data-fav="nts-1"]').click();
  chip(a, "fav").click();
  assert.deepEqual(ids(a).sort(), ["kexp", "nts-1"]);
  assert.equal(a.$("#count").textContent, "2 of 32 stations");
});

test("favourites of stations that no longer exist are dropped, not counted", () => {
  const a = boot({ seed: [["favs", ["lounge", "techno", "fip"]]] });
  assert.equal(chip(a, "fav").querySelector("span").textContent, "1");
  chip(a, "fav").click();
  assert.deepEqual(ids(a), ["fip"]);
});

test("corrupt favourites data does not break the app", () => {
  const a = boot({ seed: [["favs", { not: "a list" }]] });
  assert.equal(a.$$(".card").length, 32);
  assert.equal(chip(a, "fav").querySelector("span").textContent, "0");
});

test("a change made in another tab shows up after a storage event", () => {
  const a = boot();
  a.w.localStorage.setItem("tl_favs", JSON.stringify(["dublab"]));
  a.w.dispatchEvent(new a.w.StorageEvent("storage", { key: "tl_favs", storageArea: a.w.localStorage }));
  assert.equal(chip(a, "fav").querySelector("span").textContent, "1");
  assert.equal(a.$('[data-fav="dublab"]').getAttribute("aria-pressed"), "true");
});

/* ---------- start-up ---------- */
test("the last station is preselected but never started automatically", () => {
  const a = boot({ seed: [["last", "soma-lush"]] });
  assert.equal(a.title(), "SomaFM Lush");
  assert.equal(a.status(), "Ready. Press play.");
  assert.equal(a.radio.src, "");
  assert.equal(a.radio.plays || 0, 0);
  assert.ok(a.card("soma-lush").classList.contains("active"));
  a.click("#play");
  assert.match(a.radio.src, /lush-128-mp3$/, "Play starts the preselected station");
});

test("a remembered station that no longer exists is ignored", () => {
  const a = boot({ seed: [["last", "lounge"]] });
  assert.equal(a.title(), "No station selected");
  a.click("#play");                                  // plays the first station
  assert.match(a.radio.src, /groovesalad/);
});

test("fresh start shows the neutral state", () => {
  const a = boot();
  assert.equal(a.$("#nowName").textContent, "Pick a station");
  assert.equal(a.$("#nowSub").textContent, "Tap a card and it plays right away.");
  assert.equal(a.title(), "No station selected");
  assert.equal(a.d.title, "Technolovers Radio");
  assert.equal(a.$(".brand").textContent, "Technolovers · Radio");
});

test("Play without a chosen station starts the first one", () => {
  const a = boot();
  a.click("#play");
  assert.equal(a.title(), "SomaFM Groove Salad");
  assert.match(a.radio.src, /groovesalad/);
});

test("the four sections switch and are remembered", () => {
  const a = boot();
  for (const [m, view] of [["pod", "podView"], ["book", "bookView"], ["note", "noteView"], ["radio", "radioView"]]) {
    a.click('[data-mode="' + m + '"]');
    for (const v of ["radioView", "podView", "bookView", "noteView"]) assert.equal(a.$("#" + v).hidden, v !== view, m + ": " + v);
    assert.equal(a.ls("view"), m);
  }
});
