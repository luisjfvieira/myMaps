# My Maps

A self-hosted clone of Google My Maps — draw markers, lines, and shapes across as many layers as you want (Google caps you at 10; this doesn't cap you at all). Pure static HTML/CSS/JS, so it runs directly on GitHub Pages with no build step and no server.

## Features

- **Unlimited layers** — add, rename, recolor, reorder, duplicate, and delete layers freely (including down to zero).
- Draw **markers, lines, polygons, rectangles, and circles** on whichever layer is active. Double-click a line or polygon to reshape it directly.
- Click any item to edit its **title, description, color, line/border width, and opacity**, or move it to a different layer.
- **Data table per layer** — open, edit any cell, add or delete columns, delete rows — like a mini spreadsheet for that layer's items.
- **Three style modes per layer**, picked from the layer's Style panel: **Uniform** (one color/width/opacity for every item), **Individual** (style each item on its own, from its popup), or **By column** (pick one column and every unique value gets its own color+width+opacity, shown as an editable legend).
- Custom **color picker** with presets plus HEX/RGB/HSL entry modes.
- **Search** for places (powered by OpenStreetMap/Nominatim) and drop a pin from the result.
- Switch base maps: **Street, Light, Voyager, Satellite, Hybrid, Terrain, Humanitarian, Dark**.
- **Import** GeoJSON or KML files (including extra columns from `<ExtendedData>`); **export** your map as GeoJSON or KML (compatible with Google Earth / My Maps import).
- **Multiple saved maps** — your work autosaves in the browser (localStorage); use **File > Open map (this browser)** to switch between maps saved on this device.
- **Repo-backed map gallery** — use **File > Save to repo folder…** to write the current map into this project's `maps/` folder, then commit & push with GitHub Desktop. Anyone visiting the published site (including you, on any device) can then use **File > Browse repo maps…** to see and open every map that's been saved that way — a real "My Maps" list, backed by files in your repo instead of one browser's storage.
- **GitHub auto-sync** — set up a personal access token once (**File > GitHub auto-sync settings…**) and the open map commits itself to `maps/` in your repo automatically as you edit, no GitHub Desktop step required.
- **Share link** — generates a URL with the whole map packed into it, so someone else can open it in their own browser (no account or server required).

## Switching between maps

- **Maps saved on this device only:** File > Open map (this browser). These live in this browser's local storage and won't show up anywhere else.
- **Maps saved to the repo:** File > Browse repo maps…. This reads `maps/index.json`, so it works for anyone on the published site, not just you. Opening one of these loads it as a new local copy and remembers which repo file it came from, so saving again with **Save to repo folder…** updates that same file.

## Saving a map into the repo

1. With the map open, choose **File > Save to repo folder…**.
2. In Chrome or Edge, a folder picker opens — select this project's `maps` folder (the browser will remember it for next time). The app writes `maps/<your-map-name>.json` and updates `maps/index.json` directly in your working copy.
   - In Firefox/Safari (no folder-picker support), it instead downloads `<your-map-name>.json` and `index.json` — drag both into the `maps/` folder yourself.
3. Open **GitHub Desktop** — you'll see the new/changed files under `maps/`. Commit and push.
4. Once GitHub Pages redeploys (usually under a minute), the map appears for anyone using **Browse repo maps…** on the live site.

Deleting a map from the gallery is manual: delete its file from `maps/`, remove its entry from `maps/index.json`, then commit & push.

## GitHub auto-sync (no GitHub Desktop step)

1. **File > GitHub auto-sync settings…**
2. Create a token at `github.com/settings/tokens` — a classic token with the `repo` scope, or a fine-grained token with **Contents: Read and write** on this repo.
3. Enter `owner/repo`, the branch (usually `main`), and the token, then Save.
4. From then on, edits to the open map are committed straight to `maps/` in your repo a few seconds after you stop editing — watch the status badge next to the map name (`☁ pending…` → `☁ syncing…` → `☁ synced`). **Push all local maps now** in that same dialog does a one-time bulk push of every map already saved in this browser.

The token is stored only in this browser's localStorage — only enable this on a device you trust, and revoke the token on GitHub any time to turn it off remotely.

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
