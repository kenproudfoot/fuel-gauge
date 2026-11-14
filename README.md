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
- [x] **4. AI lookup**: nutrition lookup for unknown foods, with confirm-before-save
- [x] **4b. USDA lookup**: sourced values from USDA FoodData Central, with a link to the record
- [x] **4c. Label photo**: photograph a Nutrition Facts label and have the values read into the confirm card
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
    ai.js           OpenAI-compatible client, prompts, reply validation (fetch is injectable)
    usda.js         USDA FoodData Central search and record reading (fetch is injectable)
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

## USDA lookup

An AI model answers from memory and cannot say where a number came from. With a
free [USDA FoodData Central](https://fdc.nal.usda.gov/) API key under
**Settings → USDA lookup**, a food that is not in the list is searched there
first. The app lists the matching records; picking one opens the confirm card
with:

- for packaged foods, the values printed on the manufacturer's label, per label
  serving, plus anything else the record holds (phosphorus, when the
  manufacturer reported it);
- for plain foods, USDA's own figures per 100 g;
- a link to the record, and its date, since label data can be years old.

Each value is tagged **USDA**. A value USDA does not have is never taken as 0:
if AI lookup is also set up it is estimated and tagged **estimated**, and
otherwise the field is left blank to fill in. A barcode often has several
records over the years, so the newest one is fetched. Foods saved from here have
the source `usda-confirmed` and keep the record number in their notes. Only the
food words are sent to USDA, and the key is stored and protected the same way
as the AI key.

## Label photo

The camera button on Today photographs a Nutrition Facts label. The photo is
shrunk (which also drops its metadata), sent to the configured AI provider, and
the model copies the printed values: it is told never to estimate, and to leave
anything unprinted blank. The confirm card shows the photo above the values so
each number can be checked, with every value tagged **label**. Phosphorus is
rarely on a label, so when a USDA key is set and the product has a name (typed
before the photo, or printed in it), a closely matching USDA record supplies the
missing values, tagged **USDA** with a link; otherwise they stay blank to fill
in. The photo is not stored. Foods saved this way have the source
`label-confirmed`. The model must accept images.

## AI lookup

Foods that are not in the list can be looked up through any OpenAI-compatible
Chat Completions API, called with `fetch` directly from the browser. Set the
provider, API key and model under **Settings → AI lookup**. The key is stored
only in the phone's IndexedDB; it is never logged and never written to a backup.
Only the food text that was typed or dictated is sent to the provider.

A lookup never logs anything by itself. It opens a confirm card with every
value editable and tagged "estimated"; **Log & save to my foods** stores the
food as `ai-confirmed`, and **Log once** leaves the entry marked estimated.
If the AI can't be reached, the app says so and offers manual entry. Logging
known foods never uses the network.

Presets, each checked for browser (CORS) access on 2026-11-14:

| Preset | Base URL | Note |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | |
| Anthropic Claude | `https://api.anthropic.com/v1` | The app adds the `anthropic-dangerous-direct-browser-access: true` header, which this endpoint requires from browsers. Anthropic describes this compatibility layer as meant for testing rather than production. |
| Custom | any `https://` OpenAI-compatible address | Must allow browser requests from the app's origin. |

Requests send only `model` and `messages` (JSON is asked for in the prompt and
validated in the app, with one retry), because providers disagree on fields
such as `response_format`.

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
