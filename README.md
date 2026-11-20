# Werbefrei Radio

A small web app for listening to ad-free electronic and ambient radio stations, plus podcasts, your own audiobooks and Markdown notes. It is one HTML file with no build step and no dependencies, and it can be installed as an app (PWA).

**Live:** https://esildooor-commits.github.io/technolovers-radio/

The interface is in German.

## Features

The app has four tabs:

### Radio
- 20 ad-free stations from independent, listener-funded or public broadcasters, in five categories: Chill & Ambient, House & Trance, Bass & Glitch, Eclectic, Weltweit (worldwide).
  - [SomaFM](https://somafm.com): Groove Salad, Deep Space One, Drone Zone, Lush, Secret Agent, Space Station Soma, Beat Blender, The Trip, Cliqhop, Dub Step Beyond.
  - The two channels of [NTS Radio](https://www.nts.live) (UK).
  - Weltweit: [FIP](https://www.radiofrance.fr/fip) (France: general, Electro, Groove, Jazz, World), [DLF Nova](https://www.deutschlandfunknova.de) (Germany), [KEXP](https://www.kexp.org) and [Radio Paradise](https://radioparadise.com) (USA).
  - The streams are played straight from the stations' own servers. The app does not add or remove anything.
  - The app sends no `Referer` header (`<meta name="referrer">`). SomaFM answers requests that carry a foreign `Referer`, such as from `github.io` or `localhost`, with 403.
- Search, category filter and favourites.
- If a stream address does not answer, the app tries its backup address (SomaFM has two servers) and reconnects by itself when a stream stalls or drops.
- Clicking the station that is already playing does nothing, and switching quickly connects only to the last station you chose.
- Volume and mute, plus a sleep timer: pick 5–90 minutes, add or take off 5 or 15 minutes while it runs, or cancel it. It shows a live countdown and fades the volume out over the last 20 seconds before pausing.
- Lock-screen and media-key controls (Media Session API).
- Keyboard: <kbd>Space</kbd> plays or pauses, <kbd>←</kbd>/<kbd>→</kbd> switch stations (in the podcast player they jump back 15 s or forward 30 s).

### Podcasts
- Search for shows or single episodes. Data comes from the [iTunes Search API](https://performance-partners.apple.com/search-api), which needs no key.
- Subscriptions, with a "new" badge for episodes you have not seen yet.
- A show's episode list (up to the newest 200), with search inside it.
- Queue (playlist) and listening progress per episode.
- Downloads are stored in the browser, so they also play offline. You can also save them as a file.
- Playback speed from 0.75× to 2×, and buttons to skip back 15 s or forward 30 s.

### Audiobooks (Bücher)
- Import a folder (subfolders are included) or single files. Supported formats: mp3, m4a, m4b, aac, ogg, oga, opus, wav, flac.
- Chapters are sorted in natural order (1, 2, 10). You can re-sort them by name, date or size, or by dragging.
- The app remembers progress and the current chapter, and you can mark chapters as heard. You can keep several books and add chapters to a book later.

### Notes (Notizen)
- A read-only Markdown viewer for a folder such as an Obsidian vault. It aims to look like the preview in Obsidian or VS Code.
- Supported Markdown:
  - headings, lists, task lists, tables, quotes, footnotes and front-matter properties;
  - Obsidian wikilinks, embeds and callouts;
  - images, and highlighting for common programming languages.
- Table of contents, full-text search, adjustable font size, and the scroll position is remembered for each note.
- "Aktualisieren" (refresh) loads a newer copy of the folder. Hidden folders such as `.obsidian` are skipped.
- HTML inside notes is never executed. Formulas and Mermaid diagrams are shown as plain text.

## Privacy and storage

There is no account and no server-side storage. Everything stays in the browser:

| What | Where |
|---|---|
| Favourites, subscriptions, queue, progress, settings, book and folder lists | `localStorage` (keys prefixed with `tl_`) |
| Downloaded episodes, imported audiobooks and notes | IndexedDB, database `tl_pod` |

Imported books and notes are **copies**, so they use as much space as the original files. Clearing the site data removes them; the originals on your device are not touched.

Network requests go only to:
- the stream servers (somafm.com, ntslive.net, radiofrance.fr, dlf.de / rndfnk.com, streamguys1.com and radioparadise.com);
- the iTunes Search API;
- the podcast hosts;
- Google Fonts.

The app works in several tabs at once: imports and deletes are coordinated with Web Locks, and the other tabs pick up changes automatically.

## Running locally

No install or build step is needed. Serve the folder over HTTP, so that the service worker and storage work, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.

## Project structure

| File | Purpose |
|---|---|
| `index.html` | The whole app: markup, styles and script (vanilla JavaScript) |
| `sw.js` | Service worker. It caches only the app shell, so the app opens offline. Streams and podcast files are never cached by it. |
| `manifest.webmanifest` | PWA manifest (name, colours, icons) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | App icons |

## Deployment

The site is published with GitHub Pages from the root of the `main` branch, so changes merged into `main` go live after the Pages build. The service worker loads the newest version from the network first; after a deploy it is enough to reload the page.

## Browser support

The app is built for current Chrome, Edge, Firefox and Safari, on desktop and mobile. Folder import needs a browser that supports picking folders; where that is not available, use "Einzelne Dateien" (single files).

## Developers

- [esildooor-commits](https://github.com/esildooor-commits): creator of the project
- [Vitalii-Khomenko](https://github.com/Vitalii-Khomenko): developer

## License

[MIT](LICENSE). The license covers the code of this app only. The radio streams, podcast feeds and the iTunes Search API belong to their providers and have their own terms.
