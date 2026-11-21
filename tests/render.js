// Shows how the app renders a Markdown file (a debugging helper, not part of the app).
//   node tests/render.js path/to/note.md [--text]     the HTML of the note (or only its text with --text)
// Other files and images in the same folder are loaded as part of the vault too, so that links and images resolve.
const fs = require("node:fs"), path = require("node:path");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const file = process.argv[2];
if (!file) { console.error("Usage: node tests/render.js <file.md> [--text]"); process.exit(1); }
const dir = path.dirname(path.resolve(file)), name = path.basename(file);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), {
    url: "https://example.test/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.Audio = class { constructor() { this.paused = true; this.volume = 1; } addEventListener() {} removeAttribute() {} load() {} pause() {} play() { return Promise.resolve(); } };
      w.indexedDB = new IDBFactory(); w.URL.createObjectURL = (b) => "blob:" + b.size; w.URL.revokeObjectURL = () => {}; w.scrollTo = () => {}; w.confirm = () => true;
    },
  });
  const w = dom.window, d = w.document;
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(md|markdown|png|jpe?g|gif|webp|svg)$/i.test(e.name)).map((e) => {
    const f = new File([fs.readFileSync(path.join(dir, e.name))], e.name);
    Object.defineProperty(f, "webkitRelativePath", { value: "Vault/" + e.name }); return f;
  });
  d.querySelector('[data-mode="note"]').click();
  const inp = d.querySelector("#pickMd"); Object.defineProperty(inp, "files", { value: files });
  inp.dispatchEvent(new w.Event("change")); await tick(400);
  d.querySelector('[data-act="vopen"]').click(); await tick(50);
  const btn = [...d.querySelectorAll(".tf")].find((b) => b.textContent === name.replace(/\.(md|markdown)$/i, ""));
  if (!btn) { console.error("Note not found:", name); process.exit(1); }
  btn.click(); await tick(150);
  const body = d.querySelector("#mdBody");
  console.log(process.argv.includes("--text") ? body.textContent : body.innerHTML);
  process.exit(0);
})();
