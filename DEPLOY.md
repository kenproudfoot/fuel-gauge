# Deploying Fuel Gauge

The app is the static files in `docs/`. GitHub Pages serves that folder as-is.
There is no build step.

## 1. Create the repo and enable Pages

With the GitHub CLI:

```sh
git init -b main
git add -A
git commit -m "Initial commit"
gh repo create fuel-gauge --public --source=. --push
gh api -X POST repos/{owner}/fuel-gauge/pages -f 'source[branch]=main' -f 'source[path]=/docs'
```

Or in the browser: create a public repo, push to it, then go to
**Settings → Pages → Build and deployment**, choose **Deploy from a branch**,
branch **main**, folder **/docs**, and save.

The app appears at `https://<your-username>.github.io/fuel-gauge/` a minute or
two after each push. Check progress with `gh run list` or the repo's Actions tab.

Before every push, check that nothing personal is staged:

```sh
git status --short
```

`.gitignore` already blocks exports (`*.txt`, `*.csv`, `*.zip`), any `data/`
folder and `.env` files. Foods, logs and the API key live only in the phone's
storage and never belong in this repo.

## 2. Test locally on the Mac

```sh
npm test         # unit tests
npm run serve    # same as: python3 -m http.server 8080 --directory docs
```

Open <http://localhost:8080>. In Safari, **Develop → Enter Responsive Design
Mode** shows it at iPhone size.

Data saved at `localhost` is separate from the data on the phone.

## 3. Test on the iPhone

Open the Pages URL in **Safari** on the iPhone. Pages serves over HTTPS, which
Safari requires for the microphone and for protected storage.

Loading the Mac's local server from the phone over Wi-Fi
(`http://<mac-ip>:8080`) works for a quick look at layout, but it is plain
HTTP, so the mic, the service worker and protected storage are all off. Use the
Pages URL for real testing.

## 4. Add to the Home Screen

1. Open the Pages URL in Safari.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Fuel Gauge from its Home Screen icon from now on.

Two things to know:

- **The Home Screen app has its own storage, separate from the Safari tab.**
  Anything entered in the Safari tab does not appear in the Home Screen app.
  Add it to the Home Screen first, then enter foods there.
- Safari can clear a website's data after about a week without visits. Home
  Screen apps are exempt, which is another reason to always use the icon.
  **Settings → About** in the app shows whether storage is protected.

Removing the app from the Home Screen deletes its data. Once backup lands
(phase 5), export a backup first.

## 5. How updates reach the phone

A service worker (`docs/sw.js`) keeps a copy of the whole app on the phone, so
it opens and logs with no signal. That copy is tied to a version number.

To release a change:

1. Bump the version in **three** places to the same value: `docs/js/version.js`,
   `VERSION` in `docs/sw.js`, and `version` in `package.json`.
2. If you added or removed a file under `docs/`, update the `ASSETS` list in
   `docs/sw.js`.
3. Run `npm test`. It fails if the versions disagree or `ASSETS` does not match
   the files in `docs/`.
4. Commit and push.

On the phone, the next time the app is opened or brought to the front it checks
for a new version, downloads it in the background, and shows an
**"Update available, tap to reload"** banner. Nothing changes under you until
you tap it. **Settings → About** shows the version that is running.

If you push without bumping the version, phones keep running the old copy.

GitHub Pages lets browsers cache `sw.js` for about 10 minutes, so a new release
can take that long to be noticed.

Updates never touch your data: foods, entries and settings stay in IndexedDB
across versions.

On the Mac, the service worker is off at `localhost` so edits show on reload.
Add `?sw=1` to the URL to test offline behavior locally.
