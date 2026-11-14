# Fuel Gauge

A voice-first food and kidney-nutrient logger that runs entirely on an iPhone.

It tracks calories, protein, sodium, potassium and phosphorus against daily
targets, plus effective carbs (total carbs minus fiber). There is no server:
the app is a static web app, and every food, log entry and setting is stored
on the device in IndexedDB.

Fuel Gauge only reports what was eaten. It never suggests insulin doses.

## Quick start

```sh
npm test         # run the unit tests (Node 20+; no packages to install)
npm run serve    # serve the app at http://localhost:8080
```

Then open <http://localhost:8080> in a browser. To put it on a phone, see
[DEPLOY.md](DEPLOY.md).

## Status

Built in phases.

- [x] **1. Scaffold**: storage, settings (targets and colors), my foods, manual logging, tests
- [x] **2. Chart**: the five-bar SVG chart, entry editing and undo, offline PWA
- [x] **3. Voice and parser**: speech and text input, fuzzy food matching, foods-file import/export
- [ ] **4. AI lookup**: nutrition lookup for unknown foods, with confirm-before-save
- [x] **5. Days and backup**: 2 AM rollover snapshots, history, zip backup and restore (done ahead of phase 4)
- [ ] **6. Trend indicator**

## Layout

```
docs/               the app, served as-is by GitHub Pages (no build step)
  index.html
  sw.js             service worker: offline app shell, versioned updates
  manifest.webmanifest, icons/
  css/app.css
  js/
    app.js          app shell and tab bar
    store.js        the only module that touches IndexedDB
    chart.js        pure: renderChartSVG(totals, targets, colors) -> SVG string
    nutrients.js    pure: nutrient definitions, targets, scaling, totals
    parser.js       pure: "half a banana" -> amount + unit + food, and commands
    fuzzy.js        pure: matching a spoken name to foods and aliases
    foodsFile.js    pure: the foods text file (parse, merge/replace plan, export)
    history.js      pure: a finished day's summary record and readable text log
    backup.js       pure: backup files (entries.csv, daily_summary.csv, ...) and restore planning
    units.js        pure: unit names and conversions
    day.js          pure: the 2 AM food-day boundary
    ui/             screens (Today, History, Foods, Settings), files, backup
  vendor/           third-party code copied in (JSZip); see vendor/README.md
tests/              node --test unit tests for the pure modules
```

## Logging

Type or dictate into the field on the Today screen and press Return:

- `log 12gm of candied pecans`, `2 slices toast`, `half a banana`, `a cup of rice`, `1.5 oz cheddar`
- `undo`, `delete the pecans`, `what's left?`

Known foods are logged instantly and never need the network. If several foods
match, the app asks which one. Press and hold an entry to edit or delete it.

## Days, history and backup

The food day rolls over at 2:00 AM. There is no background process, so past
days are filed the next time the app is opened: each gets a stored summary, a
readable text log and a PNG of its final chart. The History screen lists them.

**Settings → Backup** builds one zip (entries.csv, daily_summary.csv, a PNG and
text log per finished day, my-foods.txt, and settings.json with no API key) and
hands it to the share sheet. It can also export a date range, and restore from
a backup zip; restoring only adds what is missing.

## The foods file

Foods import and export as a plain-text CSV, so the list can be edited on a
computer and moved to the phone through Files or iCloud Drive.
[docs/example-foods.txt](docs/example-foods.txt) has the header and the column
notes. Import previews its changes ("12 new, 3 updated, 1 line skipped") and
offers Merge or Replace all before anything is saved.

## Rules this code follows

- Plain HTML, CSS and vanilla ES modules. No build step, no runtime dependencies.
- No scripts from CDNs. A Content-Security-Policy allows scripts only from the app's own origin.
- Red (`#FF2D2D`) means danger (a limit exceeded) and is used for nothing else.
- Nothing is hard-deleted. Deleted entries and foods are flagged and left in storage.
- No personal data or API keys in this repo.
