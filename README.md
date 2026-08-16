# My Maps

A self-hosted clone of Google My Maps — draw markers, lines, and shapes across as many layers as you want (Google caps you at 10; this doesn't cap you at all). Pure static HTML/CSS/JS, so it runs directly on GitHub Pages with no build step and no server.

## Features

- **Unlimited layers** — add, rename, recolor, reorder, duplicate, and delete layers freely (including down to zero).
- Draw **markers, lines, polygons, rectangles, and circles** on whichever layer is active. Double-click a line or polygon to reshape it directly.
- Click any item to edit its **title, description, color, line/border width, opacity, and line type** (solid/dashed/dotted/dash-dot), or move it to a different layer.
- **Data table per layer** — open, edit any cell, add or delete columns, delete rows, or copy/paste a whole column (via the OS clipboard, so you can move data between columns, layers, or even a spreadsheet app).
- **Three style modes per layer**, picked from the layer's Style panel: **Uniform** (one color/width/opacity/line-type for every item), **Individual** (style each item on its own, from its popup), or **By column** (pick one column and every unique value gets its own combined style, shown as an editable legend).
- Click a layer's color swatch for a quick style popover — color, opacity (slider), width, and line type all in one place, editing that layer's default style.
- Custom **color picker** with presets plus HEX/RGB/HSL entry modes.
- **Search** for places (powered by OpenStreetMap/Nominatim) and drop a pin from the result.
- Switch base maps: **Street, Light, Voyager, Satellite, Hybrid, Terrain, Humanitarian, Dark**.
- **Import** GeoJSON or KML files (including extra columns from `<ExtendedData>`); **export** your map as GeoJSON or KML (compatible with Google Earth / My Maps import).
- **Multiple saved maps** — your work autosaves in the browser (localStorage); use **File > Open map (this browser)** to switch between maps saved on this device.
- **Repo-backed map gallery** — use **File > Save to repo folder…** to write the current map into this project's `maps/` folder, then commit & push with GitHub Desktop. Anyone visiting the published site (including you, on any device) can then use **File > Browse repo maps…** to see and open every map that's been saved that way — a real "My Maps" list, backed by files in your repo instead of one browser's storage.
- **GitHub auto-sync** — set up a personal access token once (**File > GitHub auto-sync settings…**) and the open map commits itself to `maps/` in your repo automatically as you edit, no GitHub Desktop step required.
- **Google Drive auto-sync** — an independent, optional second backend: connect a Google account (**File > Google Drive sync settings…**) and the open map saves itself into a "My Maps Data" folder in your Drive automatically as you edit. Can run at the same time as GitHub sync — each is its own on/off switch, and a save pushes to whichever you've turned on.
- **Share link** — generates a URL with the whole map packed into it, so someone else can open it in their own browser (no account or server required).

## Switching between maps

- **Maps saved on this device only:** File > Open map (this browser). These live in this browser's local storage and won't show up anywhere else.
- **Maps saved to the repo:** File > Browse repo maps…. This reads `maps/index.json`, so it works for anyone on the published site, not just you. Opening one of these loads it as a new local copy and remembers which repo file it came from, so saving again with **Save to repo folder…** updates that same file.

## Saving a map into the repo

1. With the map open, choose **File > Save to repo folder…**.
2. In Chrome or Edge, a folder picker opens the first time — select this project's `maps` folder. After that, the app remembers that exact folder (it's stored in this browser, not just this tab) and reuses it automatically on every later save, with no picker and usually no prompt at all. The app writes `maps/<your-map-name>.json` and updates `maps/index.json` directly in your working copy.
   - In Firefox/Safari (no folder-picker support), it instead downloads `<your-map-name>.json` and `index.json` — drag both into the `maps/` folder yourself.
3. Open **GitHub Desktop** — you'll see the new/changed files under `maps/`. Commit and push.
4. Once GitHub Pages redeploys (usually under a minute), the map appears for anyone using **Browse repo maps…** on the live site.

Deleting a map from the gallery is manual: delete its file from `maps/`, remove its entry from `maps/index.json`, then commit & push.

## GitHub auto-sync (no GitHub Desktop step)

1. **File > GitHub auto-sync settings…**
2. Create a token at `github.com/settings/tokens` — a classic token with the `repo` scope, or a fine-grained token with **Contents: Read and write** on this repo.
3. Enter `owner/repo`, the branch (usually `main`), and the token, then Save.
4. From then on, edits to the open map are committed straight to `maps/` in your repo — at most once every 2 minutes while you're actively editing, so it won't spam commits — watch the status badge next to the map name (`☁ pending…` → `☁ syncing…` → `☁ synced`). **Push all local maps now** in that same dialog does a one-time bulk push of every map already saved in this browser.

The token is stored only in this browser's localStorage — only enable this on a device you trust, and revoke the token on GitHub any time to turn it off remotely.

## Google Drive auto-sync

Independent of GitHub sync — turn on one, the other, or both. Setup needs a one-time Google OAuth Client ID (free, a few minutes):

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project (or reuse one), then **APIs & Services > Credentials > Create Credentials > OAuth client ID > Web application**.
2. Under "Authorized JavaScript origins", add the URL(s) you'll use the app from (e.g. `https://<your-username>.github.io` and `http://localhost:5500` for local testing).
3. Copy the generated Client ID (looks like `xxxxxxxxxx.apps.googleusercontent.com`) — no client secret is needed for this.
4. In the app: **File > Google Drive sync settings…**, paste the Client ID, **Save & Connect**, and sign in with the Google account you want to save to.
5. From then on, edits to the open map are saved into a **"My Maps Data"** folder in that Drive account — at most once every 2 minutes while you're actively editing — watch the second status badge next to the map name (`🗂 pending…` → `🗂 syncing…` → `🗂 synced`). **Push all local maps now** does a one-time bulk push of every map already saved in this browser. **File > Browse Google Drive maps…** lists and opens anything saved there.

The Client ID itself isn't secret, but it's stored in this browser's localStorage alongside a short-lived Google access token; the underlying Drive access only ever covers files this app created (the `drive.file` scope), not your whole Drive.

## Limitations vs. Google My Maps

- No turn-by-turn directions layer.
- Maps aren't tied to a Google-style account — "saved on this device" (localStorage) and "saved to the repo" (`maps/` folder) are the two persistence options, described above.
- The one-click **Save to repo folder…** folder picker requires a Chromium browser (Chrome/Edge); other browsers fall back to downloading the files for you to move manually.
- Very large maps produce very long share links — prefer Export/Import or the repo folder for those.

## Running it locally

Just open `index.html` in a browser, or serve the folder with any static file server, e.g.:

```bash
npx serve .
```

## Publishing with GitHub Desktop + GitHub Pages

1. In **GitHub Desktop**: `File > Add local repository…` and pick this `my-maps` folder. If it says the folder isn't a repo yet, click **create a repository** here.
2. Click **Publish repository** (top bar). Choose a name (e.g. `my-maps`) and publish — it can be public or private, but GitHub Pages on a free account requires the repo to be **public** to be viewable.
3. On GitHub.com, open the repo → **Settings > Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`, then **Save**.
5. Wait a minute, then visit `https://<your-username>.github.io/<repo-name>/`.

Any time you edit the files, commit and push (via GitHub Desktop) and the live site updates automatically within a minute or two.

## Data & privacy notes

- All map data stays in your browser (localStorage) unless you explicitly Export or Share it — nothing is sent to a server by this app itself.
- The Search box calls the public OpenStreetMap Nominatim API, and base maps load tiles from OpenStreetMap / Esri / OpenTopoMap / CARTO — those requests go directly from your visitor's browser to those free public services (standard practice for this kind of app, same as most non-Google map tools).
