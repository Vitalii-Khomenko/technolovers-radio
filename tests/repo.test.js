// Repository rules: English only, consistent app shell (manifest, service worker, icons), valid script.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, HTML } = require("./helpers");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

/* ---------- language rule: English only ---------- */
const FILES = ["index.html", "sw.js", "manifest.webmanifest", "README.md", "CLAUDE.md", "LICENSE", "package.json", ".gitignore"]
  .concat(fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".js") && f !== "repo.test.js").map((f) => "tests/" + f));   // repo.test.js itself lists the German words

// Words that are German and not English. Case matters for the capitalised ones.
const GERMAN_WORDS = /\b(nicht|und|oder|kein|keine|keinen|wird|werden|wurde|für|mit|nach|noch|schon|sich|ist|sind|dieser|diese|eine|einen|einer|aber|wenn|dann|weil|ohne|über|zurück|weiter|Sender|Folge|Folgen|Datei|Dateien|Ordner|Notiz|Notizen|Buch|Bücher|Kapitel|Wiedergabe|Lautstärke|Einschlaf|Abspielen|Löschen|Hinzufügen|Aktualisieren|Öffnen|gehört|Suche|Fehler|Speicher|Hörbuch|Werbefrei|Weltweit|Frankreich|Deutschland|Italien|Belgien|Australien|Niederlande|Norwegen|Südkorea)\b/;
const GERMAN_CHARS = /[äöüÄÖÜß„“]/;

test("the repository is written in English only (no German words, umlauts or German quotes)", () => {
  const found = [];
  for (const f of FILES) {
    read(f).split("\n").forEach((line, i) => {
      // station URLs and provider names may contain foreign words
      const l = line.replace(/https?:\/\/\S+/g, "");
      const m = l.match(GERMAN_CHARS) || l.match(GERMAN_WORDS);
      if (m) found.push(f + ":" + (i + 1) + "  «" + m[0] + "»  " + line.trim().slice(0, 90));
    });
  }
  assert.deepEqual(found, [], "German text found:\n" + found.join("\n"));
});

test("the language rule is documented in the README and in CLAUDE.md", () => {
  assert.match(read("README.md"), /## Language rule[\s\S]*English only/);
  assert.match(read("CLAUDE.md"), /English only/);
  assert.match(read("README.md"), /The interface is in English\./);
});

test("html and manifest declare English", () => {
  assert.match(HTML, /<html lang="en">/);
  assert.equal(JSON.parse(read("manifest.webmanifest")).lang, "en");
});

test("dates are formatted for English readers", () => {
  assert.doesNotMatch(HTML, /toLocale\w*String\("de/);
  assert.match(HTML, /toLocaleDateString\("en-GB"/);
});

/* ---------- app name ---------- */
test("the app keeps its name Technolovers Radio everywhere", () => {
  assert.match(HTML, /<title>Technolovers Radio<\/title>/);
  assert.match(HTML, /<div class="brand">Techno<b>lovers<\/b> · Radio<\/div>/);
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Technolovers Radio"); assert.equal(m.short_name, "TL Radio");
  assert.match(HTML, /apple-mobile-web-app-title" content="TL Radio"/);
  assert.match(read("README.md"), /^# Technolovers Radio/m);
});

/* ---------- app shell ---------- */
test("manifest is valid and its icons exist with the declared sizes", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.start_url, "./"); assert.equal(m.display, "standalone");
  assert.ok(m.icons.length >= 3);
  for (const i of m.icons) {
    assert.ok(exists(i.src), i.src + " exists");
    const buf = fs.readFileSync(path.join(ROOT, i.src));
    assert.equal(buf.readUInt32BE(16) + "x" + buf.readUInt32BE(20), i.sizes, i.src + " size");
  }
  assert.equal(m.theme_color, HTML.match(/<meta name="theme-color" content="([^"]+)"/)[1]);
});

test("the service worker caches only files that exist and drops old caches", () => {
  const sw = read("sw.js");
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1]);
  for (const f of shell) assert.ok(f === "./" || exists(f.replace("./", "")), f + " exists");
  assert.match(sw, /const CACHE = "radio-v\d+"/);
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE\)/);
});

test("the page links its manifest and icons", () => {
  assert.match(HTML, /<link rel="manifest" href="manifest\.webmanifest">/);
  for (const f of HTML.match(/(?:icon|apple-touch-icon)" (?:type="image\/png" )?href="([^"]+)"/g).map((s) => s.match(/href="([^"]+)"/)[1])) assert.ok(exists(f), f);
});

test("no referrer is sent (SomaFM rejects foreign referrers with 403)", () => {
  assert.match(HTML, /<meta name="referrer" content="no-referrer">/);
});

test("the inline script parses", () => {
  const js = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(js));
});

test("the project has the files a contributor needs", () => {
  for (const f of ["README.md", "LICENSE", "CLAUDE.md", ".gitignore", "package.json", "package-lock.json"]) assert.ok(exists(f), f);
  const pk = JSON.parse(read("package.json"));
  assert.match(pk.scripts.test, /node --test/);
  assert.equal(pk.license, "MIT");
  assert.match(read(".gitignore"), /node_modules\//);
});
