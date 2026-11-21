// Battery rules, checked statically on the stylesheet and the script: nothing may run or repaint without a reason.
const { test } = require("node:test");
const assert = require("node:assert");
const { HTML } = require("./helpers");

const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const js = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = noComments(css);

// every top-level rule as { sel, body } (rules inside @media are included too)
function rules(text) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(text))) out.push({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  return out;
}
const R = rules(CSS);

test("no blur filters anywhere", () => {
  assert.doesNotMatch(CSS, /(?<![-\w])filter\s*:\s*[^;}]*blur\(/, "blur() is only allowed inside backdrop-filter");
});

test("backdrop-filter is used only on the dock and the sleep panel", () => {
  const using = R.filter((r) => /backdrop-filter/.test(r.body)).map((r) => r.sel);
  assert.deepEqual(using.sort(), [".dock-in", ".sleeppanel"]);
});

test("the background is static: no animated layers", () => {
  assert.doesNotMatch(HTML, /class="aura"[^>]*>\s*<i>/, "no animated blobs inside .aura");
  const aura = R.filter((r) => /^\.aura\b/.test(r.sel));
  assert.ok(aura.length >= 1);
  for (const r of aura) assert.doesNotMatch(r.body, /animation/, r.sel);
});

test("only two keyframe animations exist, and both are stepped (a few frames per second, not 60)", () => {
  const names = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["breathe", "eq"]);
  for (const r of R) {
    const m = r.body.match(/(?:^|;|\s)animation\s*:\s*([^;]+)/);
    if (m && !/^none\b/.test(m[1].trim())) assert.match(m[1], /steps\(/, "animation in " + r.sel + " must use steps()");
  }
});

test("animations run only while playing", () => {
  for (const r of R) {
    const m = r.body.match(/(?:^|;|\s)animation\s*:\s*([^;]+)/);
    if (m && !/^none\b/.test(m[1].trim())) assert.match(r.sel, /body\.playing|\.eqmini/, "animation outside the playing state: " + r.sel);
  }
  assert.match(CSS, /body\.playing \.card\.active \.eqmini\s*\{\s*display:\s*flex/, "the card equaliser is only shown while playing");
});

test("animations are paused when nobody sees them, and reduced motion switches everything off", () => {
  assert.match(CSS, /body\.still [^{]*\{[^}]*animation-play-state:\s*paused/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation:\s*none !important[^}]*transition:\s*none !important/);
});

test("only a hidden tab pauses the card equaliser; a scrolled-away header pauses just the header animations", () => {
  const rule = R.find((r) => /body\.still /.test(r.sel) && /animation-play-state:\s*paused/.test(r.body));
  assert.ok(rule);
  const sels = rule.sel.split(",").map((x) => x.trim());
  assert.ok(sels.includes("body.bg .eqmini i"));
  assert.ok(!sels.includes("body.still .eqmini i"), "the equaliser of the playing card must keep moving while the header is scrolled away");
});

test("the hue change fades through a registered custom property instead of repainting with an animation", () => {
  assert.match(CSS, /@property --h\s*\{[^}]*syntax:\s*"<number>"/);
  assert.match(CSS, /:root\s*\{\s*transition:\s*--h \.6s/, "short fade: fewer repainted frames");
});

test("the script has exactly one interval (the stream watchdog) and no animation-frame loop", () => {
  assert.equal((js.match(/setInterval\(/g) || []).length, 1);
  assert.doesNotMatch(js, /requestAnimationFrame/);
});

test("the watchdog interval is started lazily and stops itself", () => {
  assert.match(js, /function watchOn\(\)\s*\{\s*if \(!watchT\)/);
  assert.match(js, /if \(!wantPlay\)\s*\{\s*clearInterval\(watchT\);\s*watchT = null; return; \}/);
});

test("the player equaliser bars are generated once, not re-rendered", () => {
  assert.equal((js.match(/createElement\("span"\)/g) || []).length, 1);
});

test("fonts load with display=swap so text never blocks on the network", () => {
  assert.match(HTML, /fonts\.googleapis\.com\/css2\?[^"]*display=swap/);
});
