# Project rules

## Language: English only

Write everything in this repository in English: UI text (buttons, labels, `aria-label`s, placeholders, status and error messages), code comments, documentation, commit messages and pull request text. Do not add German or any other language, and keep `lang="en"` and English date formats. You may chat with the maintainer in their own language, but nothing in the repository is written in it.

## About the app

- The app is called "Technolovers Radio" (header "TECHNOLOVERS · RADIO", short name "TL Radio"). Keep that name even though the stations are no longer technolovers.fm.
- One file, `index.html` (markup, CSS and vanilla JavaScript), plus `sw.js` and `manifest.webmanifest`. No build step, no dependencies.
- Stations live in the `S` array (helper `ext(name, cat, genre, id, tag, urls)`); the card shows `tag` before the first " · ", and the genre line carries the country.
- Only add ad-free stations, and only HTTPS stream URLs without a redirect to `http://` (the browser blocks it as mixed content).

## Tests

- Run `npm test` before every commit; the whole suite takes about 30 seconds and must stay green.
- Add or update tests for every behaviour change. Use `tests/helpers.js` (`boot()` gives a fake `Audio`, a fake clock and helpers; `a.run(ms)` lets time pass with a healthy stream).
- A new station must keep `tests/stations.test.js` green: https only and a provider from the allow-list in that file (add the provider there when you add a new one).
- `tests/repo.test.js` fails on any German word or umlaut in the repository.

## Things that are easy to get wrong

- Send no `Referer` (`<meta name="referrer" content="no-referrer">`): SomaFM answers requests with a foreign `Referer` (github.io, localhost) with 403.
- SomaFM also answers a `HeadlessChrome` user agent with 403: use a normal Chrome user agent in automated tests.
- A headless browser reports `prefers-reduced-motion: reduce`, which switches all animations and transitions off; emulate `no-preference` when checking animations.
- Keep battery use low: no permanent background animation, no `backdrop-filter` on lists, no timers that run while nothing plays.
- Check changes in a real browser (for example headless Chrome or Brave served from `localhost`) and verify that a stream really plays, not only that the code parses.
