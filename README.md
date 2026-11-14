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
- [ ] **2. Chart**: the five-bar SVG chart, entry editing and undo, offline PWA
- [ ] **3. Voice and parser**: speech and text input, fuzzy food matching, foods-file import/export
- [ ] **4. AI lookup**: nutrition lookup for unknown foods, with confirm-before-save
- [ ] **5. Days and backup**: 2 AM rollover snapshots, history, zip backup and restore
- [ ] **6. Trend indicator**

## Layout

```
docs/               the app, served as-is by GitHub Pages (no build step)
  index.html
  css/app.css
  js/
    app.js          app shell and tab bar
    store.js        the only module that touches IndexedDB
    nutrients.js    pure: nutrient definitions, targets, scaling, totals
    units.js        pure: unit names and conversions
    day.js          pure: the 2 AM food-day boundary
    ui/             screens (Today, Foods, Settings)
tests/              node --test unit tests for the pure modules
```

## Rules this code follows

- Plain HTML, CSS and vanilla ES modules. No build step, no runtime dependencies.
- No scripts from CDNs. A Content-Security-Policy allows scripts only from the app's own origin.
- Red (`#FF2D2D`) means danger (a limit exceeded) and is used for nothing else.
- Nothing is hard-deleted. Deleted entries and foods are flagged and left in storage.
- No personal data or API keys in this repo.
