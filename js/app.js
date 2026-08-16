/* My Maps clone — vanilla JS + Leaflet. No build step; runs as static files (GitHub Pages friendly). */
(function () {
"use strict";

/* ---------------------------------------------------------------------
   Constants / helpers
--------------------------------------------------------------------- */
const LS_INDEX = "mymaps:projects";      // { [id]: {name, updatedAt} }
const LS_PROJECT_PREFIX = "mymaps:project:";
const LS_CURRENT = "mymaps:currentProjectId";

const PALETTE = [
  "#e6194b","#3cb44b","#4363d8","#f58231","#911eb4",
  "#46f0f0","#f032e6","#bcf60c","#fabebe","#008080",
  "#e6beff","#9a6324","#800000","#aaffc3","#808000",
  "#ffd8b1","#000075","#808080","#000000","#42d4f4"
];

const COLOR_PRESETS = [
  "#e6194b","#f58231","#ffe119","#bcf60c","#3cb44b","#46f0f0","#4363d8","#911eb4","#f032e6",
  "#fabebe","#ffd8b1","#fffac8","#aaffc3","#a9cce3","#d2b4de","#f5b7b1","#85c1e9","#d7bde2",
  "#9a6324","#800000","#808000","#008080","#000075","#4d194d","#654321","#2e4053","#7d6608",
  "#000000","#333333","#666666","#999999","#cccccc","#ffffff","#ffb6c1","#40e0d0","#ff8c00"
];

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const num = parseInt(hex, 16) || 0;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v || 0)));
  return "#" + [r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("");
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function uid() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function colorForIndex(i) {
  if (i < PALETTE.length) return PALETTE[i];
  // beyond palette: generate via golden-angle HSL rotation, still fully distinct
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 70%, 45%)`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), ms);
}

/* ---------------------------------------------------------------------
   State
--------------------------------------------------------------------- */
let state = null;       // current project state
let projectId = null;
let map, drawnLayerGroups = {};   // layerId -> {group: L.FeatureGroup, byFeature: Map(featureId -> leafletLayer)}
let baseLayers = {};
let currentBaseKey = "street";
let searchMarker = null;
let activeDrawTool = null;
let currentDrawHandler = null;

function defaultState(name) {
  const layerId = uid();
  return {
    projectName: name || "Untitled map",
    layers: [
      { id: layerId, name: "Untitled layer", color: colorForIndex(0), visible: true, features: [] }
    ],
    activeLayerId: layerId,
    view: { center: [20, 0], zoom: 3 },
    baseLayer: "street"
  };
}

/* ---------------------------------------------------------------------
   Persistence
--------------------------------------------------------------------- */
function loadIndex() {
  try { return JSON.parse(localStorage.getItem(LS_INDEX)) || {}; }
  catch { return {}; }
}
function saveIndex(idx) {
  localStorage.setItem(LS_INDEX, JSON.stringify(idx));
}

function persist() {
  if (!projectId) return;
  localStorage.setItem(LS_PROJECT_PREFIX + projectId, JSON.stringify(state));
  const idx = loadIndex();
  idx[projectId] = { name: state.projectName, updatedAt: Date.now() };
  saveIndex(idx);
  localStorage.setItem(LS_CURRENT, projectId);
  scheduleGitHubSync();
}
const persistDebounced = debounce(persist, 400);

function loadProject(id) {
  const raw = localStorage.getItem(LS_PROJECT_PREFIX + id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function createNewProject(name) {
  projectId = uid();
  state = defaultState(name);
  persist();
  bootMapFromState();
}

function openProject(id) {
  const loaded = loadProject(id);
  if (!loaded) { toast("Could not open that map."); return; }
  projectId = id;
  state = loaded;
  bootMapFromState();
  closeModal();
  toast(`Opened "${state.projectName}"`);
}

/* ---------------------------------------------------------------------
   Map bootstrapping
--------------------------------------------------------------------- */
function initLeaflet() {
  map = L.map("map", { zoomControl: true }).setView([20, 0], 3);

  baseLayers.street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  baseLayers.satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  );
  baseLayers.terrain = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
  });
  baseLayers.dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  });
  baseLayers.light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  });
  baseLayers.voyager = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  });
  baseLayers.humanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors, Tiles style by Humanitarian OSM Team'
  });
  baseLayers.hybrid = L.layerGroup([
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri" }
    ),
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 }
    )
  ]);

  map.on("click", onMapClickForCircle);
}

function setBaseLayer(key) {
  if (baseLayers[currentBaseKey]) map.removeLayer(baseLayers[currentBaseKey]);
  currentBaseKey = key;
  baseLayers[key].addTo(map);
  state.baseLayer = key;
  updateBaseLayerBar();
  persistDebounced();
}

function updateBaseLayerBar() {
  document.querySelectorAll(".bl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.base === currentBaseKey);
  });
}

function bootMapFromState() {
  document.getElementById("projectName").value = state.projectName;
  clearTimeout(githubSyncTimer);
  setSyncStatus(getGitHubConfig() ? "synced" : "");

  // clear existing feature layers
  Object.values(drawnLayerGroups).forEach(({ group }) => map.removeLayer(group));
  drawnLayerGroups = {};

  if (baseLayers[currentBaseKey]) map.removeLayer(baseLayers[currentBaseKey]);
  currentBaseKey = state.baseLayer || "street";
  baseLayers[currentBaseKey].addTo(map);
  updateBaseLayerBar();

  const v = state.view || { center: [20, 0], zoom: 3 };
  map.setView(v.center, v.zoom);

  renderLayers();
  renderLayerPanel();
  updateActiveLayerLabel();

  map.on("moveend", debounce(() => {
    state.view = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
    persistDebounced();
  }, 300));
}

/* ---------------------------------------------------------------------
   Icon helpers
--------------------------------------------------------------------- */
function pinIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 23 13 23s13-13.5 13-23C26 5.8 20.2 0 13 0z" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
    <circle cx="13" cy="13" r="5.5" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    className: "pin-icon",
    html: svg,
    iconSize: [26, 36],
    iconAnchor: [13, 36],
    popupAnchor: [0, -32]
  });
}

/* ---------------------------------------------------------------------
   Layer <-> Leaflet rendering
--------------------------------------------------------------------- */
function ensureLayerGroup(layerId) {
  if (!drawnLayerGroups[layerId]) {
    drawnLayerGroups[layerId] = { group: L.featureGroup(), byFeature: new Map() };
  }
  return drawnLayerGroups[layerId];
}

function defaultWeightFor(geomType) {
  if (geomType === "Polygon") return 3;
  if (geomType === "Circle") return 2;
  return 4; // LineString
}

function defaultOpacityFor(geomType) {
  if (geomType === "Polygon") return 0.25;
  if (geomType === "Circle") return 0.2;
  return 1; // LineString and Point: fully opaque by default
}

/* One-time migration for layers created before the unified style model
   (which had independent color/width/opacity "by field" toggles that
   could each point at a different column). Folds them into a single
   styleField + one combined {color, weight, opacity} per value. */
function ensureStyleMode(layer) {
  if (layer.styleMode) return;
  const legacyField = layer.colorField || layer.widthField || layer.opacityField;
  if (legacyField) {
    layer.styleMode = "field";
    layer.styleField = legacyField;
    const values = new Set([
      ...Object.keys(layer.colorMap || {}),
      ...Object.keys(layer.widthMap || {}),
      ...Object.keys(layer.opacityMap || {})
    ]);
    layer.styleMap = {};
    values.forEach(v => {
      layer.styleMap[v] = {
        color: (layer.colorMap && layer.colorMap[v]) || layer.color,
        weight: (layer.widthMap && layer.widthMap[v] != null) ? layer.widthMap[v] : (layer.weight != null ? layer.weight : 4),
        opacity: (layer.opacityMap && layer.opacityMap[v] != null) ? layer.opacityMap[v] : (layer.opacity != null ? layer.opacity : 0.25)
      };
    });
  } else {
    layer.styleMode = "individual";
  }
  delete layer.colorField; delete layer.colorMap;
  delete layer.widthField; delete layer.widthMap;
  delete layer.opacityField; delete layer.opacityMap;
}

/* Single source of truth for a feature's rendered style. Every layer is
   in exactly one mode:
   - "uniform": every item uses the layer's own color/weight/opacity.
   - "individual": each item can be styled on its own (via the popup),
     falling back to the layer's color/weight/opacity when not set.
   - "field": one column drives style; every unique value gets one
     combined {color, weight, opacity} entry, shared by color/width/opacity. */
function resolveStyle(layer, feature) {
  ensureStyleMode(layer);
  const fallback = {
    color: layer.color,
    weight: layer.weight != null ? layer.weight : defaultWeightFor(feature.geometry.type),
    opacity: layer.opacity != null ? layer.opacity : defaultOpacityFor(feature.geometry.type)
  };
  if (layer.styleMode === "uniform") {
    return fallback;
  }
  if (layer.styleMode === "field" && layer.styleField) {
    const val = String(feature.properties[layer.styleField] ?? "");
    if (!layer.styleMap) layer.styleMap = {};
    if (!layer.styleMap[val]) {
      layer.styleMap[val] = {
        color: colorForIndex(Object.keys(layer.styleMap).length),
        weight: fallback.weight,
        opacity: fallback.opacity
      };
    }
    return layer.styleMap[val];
  }
  // individual
  return {
    color: feature.properties.color || fallback.color,
    weight: feature.properties.weight != null ? feature.properties.weight : fallback.weight,
    opacity: feature.properties.opacity != null ? feature.properties.opacity : fallback.opacity
  };
}

function featureStyle(layer, feature) { return resolveStyle(layer, feature).color; }
function featureWeight(layer, feature) { return resolveStyle(layer, feature).weight; }
function featureOpacity(layer, feature) { return resolveStyle(layer, feature).opacity; }

function buildLeafletLayerForFeature(layer, feature) {
  const color = featureStyle(layer, feature);
  const geom = feature.geometry;
  let ll;

  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    ll = L.marker([lat, lng], { icon: pinIcon(color), draggable: true, opacity: featureOpacity(layer, feature) });
    ll.on("dragend", () => {
      const p = ll.getLatLng();
      feature.geometry.coordinates = [p.lng, p.lat];
      persistDebounced();
    });
  } else if (geom.type === "Circle") {
    const [lng, lat] = geom.coordinates;
    ll = L.circle([lat, lng], { radius: geom.radius || 1000, color, weight: featureWeight(layer, feature), fillOpacity: featureOpacity(layer, feature) });
    ll.on("edit", syncCircleFromLayer(feature, ll));
  } else if (geom.type === "LineString") {
    const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
    ll = L.polyline(latlngs, { color, weight: featureWeight(layer, feature), opacity: featureOpacity(layer, feature) });
  } else if (geom.type === "Polygon") {
    const rings = geom.coordinates.map(ring => ring.map(([lng, lat]) => [lat, lng]));
    ll = L.polygon(rings, { color, weight: featureWeight(layer, feature), fillOpacity: featureOpacity(layer, feature) });
  } else {
    return null;
  }

  if (geom.type === "LineString" || geom.type === "Polygon") {
    ll.on("dblclick", (e) => {
      L.DomEvent.stop(e);
      beginShapeEdit(layer, feature, ll);
    });
  }

  ll.bindPopup(() => featurePopupHtml(layer, feature), { minWidth: 220 });
  ll.on("popupopen", (e) => wireFeaturePopup(e.popup, layer, feature, ll));
  ll.featureId = feature.id;
  return ll;
}

/* Shared vertex-editing flow, triggered from the popup's "Edit shape"
   button or by double-clicking a line/polygon directly. */
function beginShapeEdit(layer, feature, ll) {
  map.closePopup();
  if (!ll.editing) return;
  ll.editing.enable();
  toast("Drag the shape's points. Click the map elsewhere when done.");
  const finish = () => {
    if (feature.geometry.type === "LineString") {
      feature.geometry.coordinates = ll.getLatLngs().map(p => [p.lng, p.lat]);
    } else if (feature.geometry.type === "Polygon") {
      const rings = ll.getLatLngs();
      const ring = Array.isArray(rings[0]) ? rings[0] : rings;
      feature.geometry.coordinates = [ring.map(p => [p.lng, p.lat]).concat([[ring[0].lng, ring[0].lat]])];
    }
    persistDebounced();
    ll.editing.disable();
    map.off("click", finish);
  };
  map.on("click", finish);
}

function syncCircleFromLayer(feature, ll) {
  return () => {
    const c = ll.getLatLng();
    feature.geometry.coordinates = [c.lng, c.lat];
    feature.geometry.radius = ll.getRadius();
    persistDebounced();
  };
}

function renderLayers() {
  // remove groups for layers that no longer exist
  const validIds = new Set(state.layers.map(l => l.id));
  Object.keys(drawnLayerGroups).forEach(id => {
    if (!validIds.has(id)) {
      map.removeLayer(drawnLayerGroups[id].group);
      delete drawnLayerGroups[id];
    }
  });

  state.layers.forEach(layer => {
    const entry = ensureLayerGroup(layer.id);
    entry.group.clearLayers();
    entry.byFeature.clear();

    layer.features.forEach(feature => {
      const ll = buildLeafletLayerForFeature(layer, feature);
      if (ll) {
        entry.group.addLayer(ll);
        entry.byFeature.set(feature.id, ll);
      }
    });

    if (layer.visible) {
      if (!map.hasLayer(entry.group)) entry.group.addTo(map);
    } else {
      if (map.hasLayer(entry.group)) map.removeLayer(entry.group);
    }
  });
}

function getLayer(layerId) {
  return state.layers.find(l => l.id === layerId);
}
function getFeature(layerId, featureId) {
  const layer = getLayer(layerId);
  if (!layer) return null;
  return layer.features.find(f => f.id === featureId) || null;
}

/* ---------------------------------------------------------------------
   Feature popup (edit name/description/color/move-layer/delete)
--------------------------------------------------------------------- */
function featurePopupHtml(layer, feature) {
  ensureLayerColumns(layer);
  ensureStyleMode(layer);
  const layerOptions = state.layers.map(l =>
    `<option value="${l.id}" ${l.id === layer.id ? "selected" : ""}>${escapeHtml(l.name)}</option>`
  ).join("");
  const isShape = feature.geometry.type === "LineString" || feature.geometry.type === "Polygon";
  const hasStroke = feature.geometry.type !== "Point";
  const canEditStyle = layer.styleMode === "individual";
  const styleNote = layer.styleMode === "uniform"
    ? `set by this layer's style`
    : `set by field "${escapeHtml(layer.styleField || "")}"`;
  const startColor = toHexColor(featureStyle(layer, feature));
  const colorControl = !canEditStyle
    ? `<span style="font-size:11px;color:var(--text-dim);">${styleNote}</span>`
    : `<button type="button" class="fp-color-btn" data-color="${startColor}" style="background:${startColor}" title="Pick color"></button>`;
  const widthControl = !hasStroke ? "" : !canEditStyle
    ? `<div class="fp-row"><label>Width</label><span style="font-size:11px;color:var(--text-dim);">${styleNote}</span></div>`
    : `<div class="fp-row"><label>Width</label><input type="number" class="fp-weight" min="1" max="20" value="${featureWeight(layer, feature)}" style="width:56px;padding:5px;border:1px solid var(--border);border-radius:4px;"></div>`;
  const opacityControl = !canEditStyle
    ? `<div class="fp-row"><label>Opacity</label><span style="font-size:11px;color:var(--text-dim);">${styleNote}</span></div>`
    : `<div class="fp-row"><label>Opacity</label><input type="number" class="fp-opacity" min="0" max="100" step="5" value="${Math.round(featureOpacity(layer, feature) * 100)}" style="width:56px;padding:5px;border:1px solid var(--border);border-radius:4px;"><span style="font-size:11px;color:var(--text-dim);">%</span></div>`;
  const customCols = layer.columns.filter(c => c !== "name" && c !== "description");
  const customFieldsHtml = customCols.map(col => `
      <div class="fp-row">
        <label style="white-space:nowrap;">${escapeHtml(col)}</label>
        <input type="text" class="fp-field" data-col="${escapeHtml(col)}" value="${escapeHtml(feature.properties[col] || "")}" style="flex:1;min-width:0;padding:5px;border:1px solid var(--border);border-radius:4px;">
      </div>`).join("");
  return `
    <div class="fp-editor" data-layer="${layer.id}" data-feature="${feature.id}">
      <input type="text" class="fp-name" placeholder="Title" value="${escapeHtml(feature.properties.name || "")}">
      <textarea class="fp-desc" placeholder="Description">${escapeHtml(feature.properties.description || "")}</textarea>
      ${customFieldsHtml}
      <div class="fp-row">
        <label>Color</label>
        ${colorControl}
        ${isShape ? `<button class="fp-editshape" style="margin-left:auto;font-size:11px;">Edit shape</button>` : ""}
      </div>
      ${widthControl}
      ${opacityControl}
      <select class="fp-move">${layerOptions}</select>
      <div class="fp-actions">
        <button class="fp-delete">Delete</button>
        <button class="fp-save">Save</button>
      </div>
    </div>`;
}

function toHexColor(c) {
  if (c.startsWith("#")) return c;
  // convert hsl(...) to a rough hex via canvas-free approximation
  const m = /hsl\((\d+(?:\.\d+)?),\s*(\d+)%,\s*(\d+)%\)/.exec(c);
  if (!m) return "#3388ff";
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function wireFeaturePopup(popup, layer, feature, ll) {
  const el = popup.getElement();
  if (!el) return;
  const root = el.querySelector(".fp-editor");
  if (!root) return;

  const colorBtn = root.querySelector(".fp-color-btn");
  if (colorBtn) {
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker(colorBtn.dataset.color, (c) => {
        colorBtn.dataset.color = c;
        colorBtn.style.background = c;
      }, colorBtn);
    });
  }

  const weightInput = root.querySelector(".fp-weight");
  const opacityInput = root.querySelector(".fp-opacity");

  root.querySelector(".fp-save").addEventListener("click", () => {
    feature.properties.name = root.querySelector(".fp-name").value.trim();
    feature.properties.description = root.querySelector(".fp-desc").value;
    root.querySelectorAll(".fp-field").forEach(inp => { feature.properties[inp.dataset.col] = inp.value; });
    if (colorBtn) feature.properties.color = colorBtn.dataset.color;
    if (weightInput) feature.properties.weight = Math.max(1, +weightInput.value || featureWeight(layer, feature));
    if (opacityInput) feature.properties.opacity = Math.max(0, Math.min(100, +opacityInput.value)) / 100;

    const newLayerId = root.querySelector(".fp-move").value;
    if (newLayerId !== layer.id) {
      moveFeatureToLayer(layer.id, feature.id, newLayerId);
      map.closePopup();
      renderLayers(); renderLayerPanel(); persistDebounced();
      return;
    }
    renderLayers(); renderLayerPanel(); persistDebounced();
    map.closePopup();
    toast("Saved");
  });

  root.querySelector(".fp-delete").addEventListener("click", async () => {
    if (!(await showConfirm("Delete this item?"))) return;
    layer.features = layer.features.filter(f => f.id !== feature.id);
    map.closePopup();
    renderLayers(); renderLayerPanel(); persistDebounced();
  });

  const editBtn = root.querySelector(".fp-editshape");
  if (editBtn) {
    editBtn.addEventListener("click", () => beginShapeEdit(layer, feature, ll));
  }
}

function moveFeatureToLayer(fromLayerId, featureId, toLayerId) {
  const from = getLayer(fromLayerId);
  const to = getLayer(toLayerId);
  if (!from || !to) return;
  const idx = from.features.findIndex(f => f.id === featureId);
  if (idx === -1) return;
  const [feature] = from.features.splice(idx, 1);
  delete feature.properties.color; // adopt new layer's color unless user recolors
  to.features.push(feature);
}

/* ---------------------------------------------------------------------
   Circle-on-click helper (used right after enabling circle tool we
   let Leaflet.Draw handle it; this is a no-op placeholder kept for
   symmetry / future custom tools)
--------------------------------------------------------------------- */
function onMapClickForCircle() {}

/* ---------------------------------------------------------------------
   Drawing tools
--------------------------------------------------------------------- */
function activeLayerWeight(geomType) {
  const layer = getLayer(state.activeLayerId);
  if (layer && layer.weight != null) return layer.weight;
  return defaultWeightFor(geomType);
}

const DRAW_HANDLERS = {
  marker: () => new L.Draw.Marker(map, { icon: L.divIcon({ className: "pin-icon", html: "", iconSize: [0,0] }) }),
  polyline: () => new L.Draw.Polyline(map, { shapeOptions: { color: "#3388ff", weight: activeLayerWeight("LineString") } }),
  polygon: () => new L.Draw.Polygon(map, { shapeOptions: { color: "#3388ff", weight: activeLayerWeight("Polygon") }, allowIntersection: true }),
  rectangle: () => new L.Draw.Rectangle(map, { shapeOptions: { color: "#3388ff", weight: activeLayerWeight("Polygon") } }),
  circle: () => new L.Draw.Circle(map, { shapeOptions: { color: "#3388ff", weight: activeLayerWeight("Circle") } })
};

function stopDrawing() {
  if (currentDrawHandler) {
    try { currentDrawHandler.disable(); } catch (e) {}
    currentDrawHandler = null;
  }
  activeDrawTool = null;
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
}

function startDrawing(tool, btn) {
  if (!state.activeLayerId || !getLayer(state.activeLayerId)) {
    toast("Select or add a layer first.");
    return;
  }
  if (activeDrawTool === tool) { stopDrawing(); return; }
  stopDrawing();
  activeDrawTool = tool;
  btn.classList.add("active");
  currentDrawHandler = DRAW_HANDLERS[tool]();
  currentDrawHandler.enable();
}

document.addEventListener("DOMContentLoaded", () => {
  initLeaflet();

  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = getLayer(state.activeLayerId);
    if (!layer) return;
    const geom = leafletToGeometry(e.layerType, e.layer);
    const feature = {
      id: uid(),
      type: "Feature",
      geometry: geom,
      properties: { name: "", description: "" }
    };
    layer.features.push(feature);
    stopDrawing();
    renderLayers();
    renderLayerPanel();
    persistDebounced();

    // auto-open editor popup for the newly created feature
    const entry = drawnLayerGroups[layer.id];
    const ll = entry && entry.byFeature.get(feature.id);
    if (ll) ll.openPopup();
  });

  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => startDrawing(btn.dataset.tool, btn));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") stopDrawing(); });

  wireTopbar();
  wireSidebar();
  wireModal();
  wireSearch();

  // boot: resume last project or create default
  const lastId = localStorage.getItem(LS_CURRENT);
  const idx = loadIndex();
  if (lastId && idx[lastId]) {
    projectId = lastId;
    state = loadProject(lastId) || defaultState();
  } else {
    const ids = Object.keys(idx);
    if (ids.length) {
      projectId = ids[0];
      state = loadProject(projectId) || defaultState();
    } else {
      projectId = uid();
      state = defaultState("My first map");
    }
  }
  persist();
  bootMapFromState();
});

function leafletToGeometry(type, layer) {
  if (type === "marker") {
    const p = layer.getLatLng();
    return { type: "Point", coordinates: [p.lng, p.lat] };
  }
  if (type === "polyline") {
    return { type: "LineString", coordinates: layer.getLatLngs().map(p => [p.lng, p.lat]) };
  }
  if (type === "polygon" || type === "rectangle") {
    const latlngs = layer.getLatLngs()[0];
    const coords = latlngs.map(p => [p.lng, p.lat]);
    coords.push(coords[0]);
    return { type: "Polygon", coordinates: [coords] };
  }
  if (type === "circle") {
    const c = layer.getLatLng();
    return { type: "Circle", coordinates: [c.lng, c.lat], radius: layer.getRadius() };
  }
  return null;
}

/* ---------------------------------------------------------------------
   Sidebar / layer panel
--------------------------------------------------------------------- */
function renderLayerPanel() {
  const list = document.getElementById("layerList");
  list.innerHTML = "";
  document.getElementById("layerCount").textContent = state.layers.length;

  state.layers.forEach((layer, index) => {
    const item = document.createElement("div");
    item.className = "layer-item" + (layer.id === state.activeLayerId ? " active" : "");

    const row = document.createElement("div");
    row.className = "layer-row";
    row.innerHTML = `
      <input type="checkbox" class="layer-visible" ${layer.visible ? "checked" : ""} title="Show/hide">
      <button class="layer-color" style="background:${layer.color}" title="Layer color"></button>
      <input type="text" class="layer-name" value="${escapeHtml(layer.name)}" spellcheck="false">
      <span class="layer-count">${layer.features.length}</span>
      <div class="layer-actions">
        <button class="la-up" title="Move up">↑</button>
        <button class="la-down" title="Move down">↓</button>
        <button class="la-dup" title="Duplicate layer">⧉</button>
        <button class="la-del" title="Delete layer">🗑</button>
        <button class="la-expand" title="Show items">▾</button>
      </div>
    `;
    item.appendChild(row);

    const featuresBox = document.createElement("div");
    featuresBox.className = "layer-features";

    const toolbar = document.createElement("div");
    toolbar.className = "layer-toolbar";
    toolbar.innerHTML = `
      <button class="lt-btn lt-table" title="Open data table">📋 Table</button>
      <button class="lt-btn lt-style" title="Color by field">🎨 Style</button>
    `;
    toolbar.querySelector(".lt-table").addEventListener("click", (e) => { e.stopPropagation(); openDataTableModal(layer.id); });
    toolbar.querySelector(".lt-style").addEventListener("click", (e) => { e.stopPropagation(); openStyleModal(layer.id); });
    featuresBox.appendChild(toolbar);

    if (layer.features.length === 0) {
      const empty = document.createElement("div");
      empty.className = "layer-empty";
      empty.textContent = "No items yet. Select this layer, then use the drawing tools on the map.";
      featuresBox.appendChild(empty);
    } else {
      layer.features.forEach(f => {
        const fr = document.createElement("div");
        fr.className = "feature-row";
        const icon = f.geometry.type === "Point" ? "📍" : f.geometry.type === "LineString" ? "／" : "▲";
        fr.innerHTML = `<span>${icon}</span><span class="fname">${escapeHtml(f.properties.name || "(untitled)")}</span><button class="ffocus" title="Zoom to">🔍</button><button class="fdel" title="Delete">🗑</button>`;
        fr.querySelector(".fname").addEventListener("click", () => focusFeature(layer, f));
        fr.querySelector(".ffocus").addEventListener("click", (e) => { e.stopPropagation(); focusFeature(layer, f); });
        fr.querySelector(".fdel").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!(await showConfirm("Delete this item?"))) return;
          layer.features = layer.features.filter(x => x.id !== f.id);
          renderLayers(); renderLayerPanel(); persistDebounced();
        });
        featuresBox.appendChild(fr);
      });
    }
    item.appendChild(featuresBox);
    list.appendChild(item);

    // interactions
    row.querySelector(".layer-visible").addEventListener("change", (e) => {
      layer.visible = e.target.checked;
      renderLayers(); persistDebounced();
    });
    row.querySelector(".layer-color").addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker(layer.color, (c) => { layer.color = c; renderLayers(); renderLayerPanel(); persistDebounced(); }, e.currentTarget);
    });
    const nameInput = row.querySelector(".layer-name");
    nameInput.addEventListener("click", e => e.stopPropagation());
    nameInput.addEventListener("change", () => {
      layer.name = nameInput.value.trim() || "Untitled layer";
      persist();
    });
    row.querySelector(".la-up").addEventListener("click", (e) => {
      e.stopPropagation();
      if (index > 0) { [state.layers[index-1], state.layers[index]] = [state.layers[index], state.layers[index-1]]; renderLayerPanel(); persistDebounced(); }
    });
    row.querySelector(".la-down").addEventListener("click", (e) => {
      e.stopPropagation();
      if (index < state.layers.length - 1) { [state.layers[index+1], state.layers[index]] = [state.layers[index], state.layers[index+1]]; renderLayerPanel(); persistDebounced(); }
    });
    row.querySelector(".la-dup").addEventListener("click", (e) => {
      e.stopPropagation();
      const clone = JSON.parse(JSON.stringify(layer));
      clone.id = uid();
      clone.name = layer.name + " (copy)";
      clone.features.forEach(f => f.id = uid());
      state.layers.splice(index + 1, 0, clone);
      renderLayers(); renderLayerPanel(); persistDebounced();
    });
    row.querySelector(".la-del").addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await showConfirm(`Delete layer "${layer.name}" and its ${layer.features.length} item(s)?`, "Delete layer");
      if (!ok) return;
      state.layers = state.layers.filter(l => l.id !== layer.id);
      if (state.activeLayerId === layer.id) state.activeLayerId = state.layers.length ? state.layers[0].id : null;
      renderLayers(); renderLayerPanel(); updateActiveLayerLabel(); persistDebounced();
    });
    row.querySelector(".la-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      item.classList.toggle("expanded");
    });

    row.addEventListener("click", () => {
      state.activeLayerId = layer.id;
      renderLayerPanel();
      updateActiveLayerLabel();
      persistDebounced();
    });
  });
}

function updateActiveLayerLabel() {
  const layer = getLayer(state.activeLayerId);
  document.getElementById("activeLayerLabel").textContent = "Drawing on: " + (layer ? layer.name : "—");
}

function focusFeature(layer, feature) {
  const entry = drawnLayerGroups[layer.id];
  if (!layer.visible) { layer.visible = true; renderLayers(); renderLayerPanel(); }
  const ll = entry && entry.byFeature.get(feature.id);
  if (!ll) return;
  if (ll.getLatLng) map.setView(ll.getLatLng(), Math.max(map.getZoom(), 14));
  else if (ll.getBounds) map.fitBounds(ll.getBounds(), { maxZoom: 16 });
  setTimeout(() => ll.openPopup(), 250);
}

let activeColorPopover = null;

function closeColorPopover() {
  if (activeColorPopover) {
    activeColorPopover.remove();
    activeColorPopover = null;
    document.removeEventListener("mousedown", onColorPopoverOutsideClick, true);
  }
}
function onColorPopoverOutsideClick(e) {
  if (activeColorPopover && !activeColorPopover.contains(e.target)) closeColorPopover();
}

/* Custom color picker: preset swatches plus HEX/RGB/HSL entry modes,
   toggled by clicking the mode label — native <input type=color> dialogs
   vary wildly across browsers and don't offer this. */
function openColorPicker(current, cb, anchorEl) {
  closeColorPopover();

  let hex = toHexColor(current);
  let mode = "hex";

  const pop = document.createElement("div");
  pop.className = "cp-popover";
  pop.innerHTML = `
    <div class="cp-presets">
      ${COLOR_PRESETS.map(c => `<button type="button" class="cp-preset" style="background:${c}" data-color="${c}"></button>`).join("")}
    </div>
    <div class="cp-mode-row">
      <button type="button" class="cp-mode-btn" data-mode="hex">HEX</button>
      <button type="button" class="cp-mode-btn" data-mode="rgb">RGB</button>
      <button type="button" class="cp-mode-btn" data-mode="hsl">HSL</button>
      <span class="cp-preview"></span>
    </div>
    <div class="cp-fields"></div>
    <button type="button" class="cp-native">System color picker…</button>
  `;
  document.body.appendChild(pop);
  activeColorPopover = pop;

  const fieldsEl = pop.querySelector(".cp-fields");
  const previewEl = pop.querySelector(".cp-preview");

  function setColor(newHex) {
    hex = newHex;
    previewEl.style.background = hex;
    cb(hex);
  }

  function renderFields() {
    pop.querySelectorAll(".cp-mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    const rgb = hexToRgb(hex);
    if (mode === "hex") {
      fieldsEl.innerHTML = `<input type="text" class="cp-hex" maxlength="7" value="${hex}">`;
      fieldsEl.querySelector(".cp-hex").addEventListener("input", (e) => {
        const v = e.target.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v);
      });
    } else if (mode === "rgb") {
      fieldsEl.innerHTML = `
        <label>R<input type="number" min="0" max="255" class="cp-r" value="${rgb.r}"></label>
        <label>G<input type="number" min="0" max="255" class="cp-g" value="${rgb.g}"></label>
        <label>B<input type="number" min="0" max="255" class="cp-b" value="${rgb.b}"></label>`;
      const onChange = () => setColor(rgbToHex(
        +fieldsEl.querySelector(".cp-r").value,
        +fieldsEl.querySelector(".cp-g").value,
        +fieldsEl.querySelector(".cp-b").value
      ));
      fieldsEl.querySelectorAll("input").forEach(inp => inp.addEventListener("input", onChange));
    } else {
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      fieldsEl.innerHTML = `
        <label>H<input type="number" min="0" max="360" class="cp-h" value="${hsl.h}"></label>
        <label>S<input type="number" min="0" max="100" class="cp-s" value="${hsl.s}"></label>
        <label>L<input type="number" min="0" max="100" class="cp-l" value="${hsl.l}"></label>`;
      const onChange = () => {
        const rgb2 = hslToRgb(
          +fieldsEl.querySelector(".cp-h").value,
          +fieldsEl.querySelector(".cp-s").value,
          +fieldsEl.querySelector(".cp-l").value
        );
        setColor(rgbToHex(rgb2.r, rgb2.g, rgb2.b));
      };
      fieldsEl.querySelectorAll("input").forEach(inp => inp.addEventListener("input", onChange));
    }
  }

  pop.querySelectorAll(".cp-preset").forEach(btn => {
    btn.addEventListener("click", () => { setColor(btn.dataset.color); renderFields(); });
  });
  pop.querySelectorAll(".cp-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => { mode = btn.dataset.mode; renderFields(); });
  });
  pop.querySelector(".cp-native").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = hex;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.addEventListener("input", () => { setColor(input.value); renderFields(); });
    input.addEventListener("change", () => document.body.removeChild(input));
    input.click();
  });

  previewEl.style.background = hex;
  renderFields();

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 320);
    const left = Math.min(rect.left, window.innerWidth - 220);
    pop.style.top = Math.max(8, top) + "px";
    pop.style.left = Math.max(8, left) + "px";
  } else {
    pop.style.top = "80px";
    pop.style.left = "50%";
    pop.style.transform = "translateX(-50%)";
  }

  setTimeout(() => document.addEventListener("mousedown", onColorPopoverOutsideClick, true), 0);
}

/* ---------------------------------------------------------------------
   Topbar: menu, new/open, import/export, share, base layer
--------------------------------------------------------------------- */
function wireTopbar() {
  document.getElementById("btnSidebarToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
    setTimeout(() => map.invalidateSize(), 200);
  });

  const menu = document.getElementById("menuFile");
  menu.querySelector(".menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", () => menu.classList.remove("open"));

  document.getElementById("projectName").addEventListener("change", (e) => {
    state.projectName = e.target.value.trim() || "Untitled map";
    persist();
  });

  document.getElementById("btnAddLayer").addEventListener("click", () => {
    const layer = { id: uid(), name: `Untitled layer`, color: colorForIndex(state.layers.length), visible: true, features: [] };
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    renderLayerPanel(); updateActiveLayerLabel(); persistDebounced();
  });

  document.querySelectorAll(".bl-btn").forEach(btn => {
    btn.addEventListener("click", () => setBaseLayer(btn.dataset.base));
  });

  document.getElementById("btnNew").addEventListener("click", async () => {
    const ok = await showConfirm("Create a new blank map? Your current map is already saved and can be reopened from File > Open map.", "Create new map", false);
    if (!ok) return;
    createNewProject("Untitled map");
  });

  document.getElementById("btnOpen").addEventListener("click", openMapModal);
  document.getElementById("btnBrowseRepo").addEventListener("click", openRepoMapsModal);
  document.getElementById("btnSaveRepo").addEventListener("click", () => saveMapToRepoFolder());
  document.getElementById("btnGitHubSync").addEventListener("click", openGitHubSettingsModal);

  document.getElementById("btnImport").addEventListener("click", () => document.getElementById("fileImport").click());
  document.getElementById("fileImport").addEventListener("change", handleImportFile);

  document.getElementById("btnExportGeoJSON").addEventListener("click", exportGeoJSON);
  document.getElementById("btnExportKML").addEventListener("click", exportKML);
  document.getElementById("btnShare").addEventListener("click", shareLink);
}

/* ---- New / Open modal ---- */
function wireModal() {
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
}

let pendingConfirmResolve = null;

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  setModalWide(false);
  if (pendingConfirmResolve) {
    const resolve = pendingConfirmResolve;
    pendingConfirmResolve = null;
    resolve(false);
  }
}

function setModalWide(wide) {
  document.querySelector("#modalOverlay .modal").classList.toggle("wide", wide);
}

/* Two-click "are you sure" pattern for buttons that live inside a modal
   already (nesting the full confirm modal there would bounce the user
   out of the table/legend they're editing). First click arms the button
   and shows a confirmation label for a few seconds; a second click while
   armed performs the action. */
function armThenConfirm(btn, label, action) {
  if (btn.dataset.armed === "1") {
    clearTimeout(btn._armTimer);
    action();
    return;
  }
  btn.dataset.armed = "1";
  btn.dataset.original = btn.textContent;
  btn.textContent = label;
  btn.classList.add("confirm-armed");
  btn._armTimer = setTimeout(() => {
    btn.textContent = btn.dataset.original;
    btn.classList.remove("confirm-armed");
    delete btn.dataset.armed;
  }, 2500);
}

/* In-app replacement for window.confirm() — native dialogs are unreliable
   inside embedded browser panes, so everything routes through this modal. */
function showConfirm(message, okText = "Delete", danger = true) {
  return new Promise(resolve => {
    pendingConfirmResolve = resolve;
    document.getElementById("modalTitle").textContent = "Please confirm";
    document.getElementById("modalBody").innerHTML = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.4;">${escapeHtml(message)}</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="small-btn secondary" id="cfCancel">Cancel</button>
        <button class="small-btn ${danger ? "danger" : ""}" id="cfOk">${escapeHtml(okText)}</button>
      </div>`;
    document.getElementById("cfOk").addEventListener("click", () => {
      pendingConfirmResolve = null;
      document.getElementById("modalOverlay").classList.remove("open");
      resolve(true);
    });
    document.getElementById("cfCancel").addEventListener("click", closeModal);
    document.getElementById("modalOverlay").classList.add("open");
  });
}

/* In-app replacement for window.prompt() — used to hand back the share link
   when the clipboard API is unavailable or blocked. */
function showLinkModal(message, url) {
  pendingConfirmResolve = null;
  document.getElementById("modalTitle").textContent = "Shareable link";
  document.getElementById("modalBody").innerHTML = `
    <p style="margin:0 0 10px;font-size:14px;">${escapeHtml(message)}</p>
    <input type="text" id="shareUrlInput" readonly style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:12px;margin-bottom:14px;box-sizing:border-box;">
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="small-btn secondary" id="cfClose">Close</button>
      <button class="small-btn" id="cfCopy">Copy link</button>
    </div>`;
  const input = document.getElementById("shareUrlInput");
  input.value = url;
  document.getElementById("cfClose").addEventListener("click", closeModal);
  document.getElementById("cfCopy").addEventListener("click", () => {
    input.select();
    navigator.clipboard?.writeText(url).then(() => toast("Copied!")).catch(() => {
      document.execCommand("copy");
      toast("Copied!");
    });
  });
  document.getElementById("modalOverlay").classList.add("open");
  input.select();
}

/* ---------------------------------------------------------------------
   Data table (per layer): edit values, add/delete columns & rows
--------------------------------------------------------------------- */
const INTERNAL_STYLE_KEYS = new Set(["color", "weight", "opacity"]);

function ensureLayerColumns(layer) {
  const known = new Set(layer.columns || ["name", "description"]);
  layer.features.forEach(f => Object.keys(f.properties).forEach(k => {
    if (!INTERNAL_STYLE_KEYS.has(k) && !known.has(k)) known.add(k);
  }));
  layer.columns = Array.from(known);
}

function openDataTableModal(layerId) {
  const layer = getLayer(layerId);
  if (!layer) return;
  ensureLayerColumns(layer);
  document.getElementById("modalTitle").textContent = `Data table — ${layer.name}`;
  setModalWide(true);
  renderDataTable(layer);
  document.getElementById("modalOverlay").classList.add("open");
}

function renderDataTable(layer) {
  const cols = layer.columns;
  let html = `<div class="dt-wrap"><table class="data-table"><thead><tr>`;
  cols.forEach(c => {
    const locked = c === "name" || c === "description";
    html += `<th>${escapeHtml(c)}${locked ? "" : ` <button class="dt-colDel" data-col="${escapeHtml(c)}" title="Delete column">×</button>`}</th>`;
  });
  html += `<th></th></tr></thead><tbody>`;
  if (layer.features.length === 0) {
    html += `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--text-dim);padding:14px;border-right:none;">No items in this layer yet.</td></tr>`;
  } else {
    layer.features.forEach(f => {
      html += `<tr>`;
      cols.forEach(c => {
        html += `<td><input type="text" class="dt-cell" data-feature="${f.id}" data-col="${escapeHtml(c)}" value="${escapeHtml(f.properties[c] || "")}"></td>`;
      });
      html += `<td><button class="dt-rowDel" data-feature="${f.id}" title="Delete row">🗑</button></td></tr>`;
    });
  }
  html += `</tbody></table></div>
    <div class="dt-toolbar">
      <input type="text" id="dtNewCol" placeholder="New column name">
      <button class="small-btn secondary" id="dtAddCol">+ Add column</button>
      <button class="small-btn" id="dtDone" style="margin-left:auto;">Done</button>
    </div>`;
  const body = document.getElementById("modalBody");
  body.innerHTML = html;

  body.querySelector("#dtDone").addEventListener("click", closeModal);

  const addCol = () => {
    const input = document.getElementById("dtNewCol");
    const name = input.value.trim();
    if (!name) return;
    if (layer.columns.includes(name)) { toast("Column already exists"); return; }
    layer.columns.push(name);
    layer.features.forEach(f => { if (!(name in f.properties)) f.properties[name] = ""; });
    persistDebounced();
    renderDataTable(layer);
  };
  body.querySelector("#dtAddCol").addEventListener("click", addCol);
  body.querySelector("#dtNewCol").addEventListener("keydown", (e) => { if (e.key === "Enter") addCol(); });

  body.querySelectorAll(".dt-colDel").forEach(btn => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.col;
      armThenConfirm(btn, "Sure?", () => {
        layer.columns = layer.columns.filter(c => c !== col);
        layer.features.forEach(f => delete f.properties[col]);
        if (layer.styleField === col) { layer.styleField = null; layer.styleMode = "individual"; }
        renderLayers(); renderLayerPanel(); persistDebounced();
        renderDataTable(layer);
      });
    });
  });

  body.querySelectorAll(".dt-rowDel").forEach(btn => {
    btn.addEventListener("click", () => {
      const fid = btn.dataset.feature;
      armThenConfirm(btn, "Sure?", () => {
        layer.features = layer.features.filter(f => f.id !== fid);
        renderLayers(); renderLayerPanel(); persistDebounced();
        renderDataTable(layer);
      });
    });
  });

  body.querySelectorAll(".dt-cell").forEach(inp => {
    inp.addEventListener("change", () => {
      const f = layer.features.find(x => x.id === inp.dataset.feature);
      if (!f) return;
      f.properties[inp.dataset.col] = inp.value;
      renderLayers(); renderLayerPanel(); persistDebounced();
    });
  });
}

/* ---------------------------------------------------------------------
   Style by field: color every item in a layer from a property value
--------------------------------------------------------------------- */
function openStyleModal(layerId) {
  const layer = getLayer(layerId);
  if (!layer) return;
  ensureLayerColumns(layer);
  ensureStyleMode(layer);
  setModalWide(false);
  document.getElementById("modalTitle").textContent = `Style — ${layer.name}`;
  renderStyleModal(layer);
  document.getElementById("modalOverlay").classList.add("open");
}

const STYLE_MODES = [
  { value: "uniform", label: "Uniform", hint: "Every item looks the same." },
  { value: "individual", label: "Individual", hint: "Style each item on its own, from its popup." },
  { value: "field", label: "By column", hint: "Every value in a column gets its own color, width & opacity." }
];

function renderStyleModal(layer) {
  const body = document.getElementById("modalBody");
  const mode = layer.styleMode || "individual";
  body.innerHTML = `
    <div class="style-mode-picker">
      ${STYLE_MODES.map(m => `<button type="button" class="style-mode-btn ${mode === m.value ? "active" : ""}" data-mode="${m.value}">${m.label}</button>`).join("")}
    </div>
    <p id="styleModeHint" style="font-size:12px;color:var(--text-dim);margin:8px 0 14px;">${STYLE_MODES.find(m => m.value === mode).hint}</p>
    <div id="styleModeBody"></div>`;
  renderStyleModeBody(layer);

  body.querySelectorAll(".style-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      layer.styleMode = btn.dataset.mode;
      if (layer.styleMode === "field" && !layer.styleField && layer.columns.length) {
        layer.styleField = layer.columns[0];
      }
      body.querySelectorAll(".style-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
      document.getElementById("styleModeHint").textContent = STYLE_MODES.find(m => m.value === layer.styleMode).hint;
      renderLayers(); renderLayerPanel(); persistDebounced();
      renderStyleModeBody(layer);
    });
  });
}

function renderStyleModeBody(layer) {
  const box = document.getElementById("styleModeBody");
  if (layer.styleMode === "uniform") {
    box.innerHTML = uniformStyleRowHtml(layer);
    wireUniformStyleRow(box, layer, () => { renderLayers(); persistDebounced(); });
  } else if (layer.styleMode === "field") {
    box.innerHTML = `
      <div class="fp-row" style="margin-bottom:14px;">
        <label style="font-size:13px;white-space:nowrap;">Column</label>
        <select id="styleFieldSelect" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:4px;">
          ${layer.columns.map(f => `<option value="${escapeHtml(f)}" ${layer.styleField === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select>
      </div>
      <div id="styleFieldLegend"></div>`;
    document.getElementById("styleFieldSelect").addEventListener("change", (e) => {
      layer.styleField = e.target.value;
      renderLayers(); renderLayerPanel(); persistDebounced();
      renderStyleFieldLegend(layer);
    });
    renderStyleFieldLegend(layer);
  } else {
    box.innerHTML = `
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Default for new items, and for any item that hasn't been styled individually yet:</p>
      ${uniformStyleRowHtml(layer)}`;
    wireUniformStyleRow(box, layer, () => { renderLayers(); renderLayerPanel(); persistDebounced(); });
  }
}

function uniformStyleRowHtml(layer) {
  const color = layer.color || "#3388ff";
  const weight = layer.weight != null ? layer.weight : 4;
  const opacity = layer.opacity != null ? Math.round(layer.opacity * 100) : 25;
  return `
    <div class="legend-row">
      <button type="button" class="legend-swatch" id="uniformColor" style="background:${color}"></button>
      <input type="number" id="uniformWidth" class="legend-width" min="1" max="20" value="${weight}" title="Line/border width (px)">
      <input type="number" id="uniformOpacity" class="legend-opacity" min="0" max="100" step="5" value="${opacity}" title="Opacity (%)">
      <span style="font-size:11px;color:var(--text-dim);">color · width · opacity%</span>
    </div>`;
}

function wireUniformStyleRow(scope, layer, onChange) {
  scope.querySelector("#uniformColor").addEventListener("click", (e) => {
    openColorPicker(layer.color || "#3388ff", (c) => {
      layer.color = c;
      e.currentTarget.style.background = c;
      onChange();
    }, e.currentTarget);
  });
  scope.querySelector("#uniformWidth").addEventListener("change", (e) => {
    layer.weight = Math.max(1, +e.target.value || 1);
    onChange();
  });
  scope.querySelector("#uniformOpacity").addEventListener("change", (e) => {
    layer.opacity = Math.max(0, Math.min(100, +e.target.value)) / 100;
    onChange();
  });
}

function renderStyleFieldLegend(layer) {
  const box = document.getElementById("styleFieldLegend");
  if (!layer.styleField) {
    box.innerHTML = `<p style="font-size:12px;color:var(--text-dim);">This layer has no columns yet — add one from its data table first.</p>`;
    return;
  }
  const values = new Set();
  layer.features.forEach(f => values.add(String(f.properties[layer.styleField] ?? "(blank)")));
  if (!layer.styleMap) layer.styleMap = {};
  let html = `<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">color · width · opacity% · value</div>`;
  Array.from(values).sort().forEach(val => {
    if (!layer.styleMap[val]) {
      layer.styleMap[val] = { color: colorForIndex(Object.keys(layer.styleMap).length), weight: layer.weight != null ? layer.weight : 4, opacity: layer.opacity != null ? layer.opacity : 0.25 };
    }
    const s = layer.styleMap[val];
    html += `<div class="legend-row" data-val="${escapeHtml(val)}">
      <button type="button" class="legend-swatch" style="background:${s.color}"></button>
      <input type="number" class="legend-width" min="1" max="20" value="${s.weight}">
      <input type="number" class="legend-opacity" min="0" max="100" step="5" value="${Math.round(s.opacity * 100)}">
      <span>${escapeHtml(val)}</span>
    </div>`;
  });
  if (values.size === 0) html += `<p style="font-size:12px;color:var(--text-dim);">This layer has no items yet.</p>`;
  box.innerHTML = html;
  box.querySelectorAll(".legend-row[data-val]").forEach(row => {
    const val = row.dataset.val;
    row.querySelector(".legend-swatch").addEventListener("click", (e) => {
      openColorPicker(layer.styleMap[val].color, (c) => {
        layer.styleMap[val].color = c;
        e.currentTarget.style.background = c;
        renderLayers(); persistDebounced();
      }, e.currentTarget);
    });
    row.querySelector(".legend-width").addEventListener("change", (e) => {
      layer.styleMap[val].weight = Math.max(1, +e.target.value || 1);
      renderLayers(); persistDebounced();
    });
    row.querySelector(".legend-opacity").addEventListener("change", (e) => {
      layer.styleMap[val].opacity = Math.max(0, Math.min(100, +e.target.value)) / 100;
      renderLayers(); persistDebounced();
    });
  });
}

function openMapModal() {
  setModalWide(false);
  const idx = loadIndex();
  const body = document.getElementById("modalBody");
  const ids = Object.keys(idx).sort((a, b) => (idx[b].updatedAt||0) - (idx[a].updatedAt||0));
  if (ids.length === 0) {
    body.innerHTML = `<p>No saved maps yet.</p>`;
  } else {
    body.innerHTML = ids.map(id => `
      <div class="map-list-item" data-id="${id}">
        <div class="mli-info">
          <div class="mli-name">${escapeHtml(idx[id].name)}</div>
          <div class="mli-meta">Updated ${new Date(idx[id].updatedAt).toLocaleString()}</div>
        </div>
        <button class="small-btn danger mli-del">Delete</button>
      </div>`).join("");
    body.querySelectorAll(".map-list-item").forEach(row => {
      const id = row.dataset.id;
      row.querySelector(".mli-info").addEventListener("click", () => openProject(id));
      row.querySelector(".mli-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(`Delete "${idx[id].name}"? This cannot be undone.`, "Delete map");
        if (!ok) return;
        localStorage.removeItem(LS_PROJECT_PREFIX + id);
        delete idx[id];
        saveIndex(idx);
        openMapModal();
      });
    });
  }
  document.getElementById("modalTitle").textContent = "Open map";
  document.getElementById("modalOverlay").classList.add("open");
}

/* ---------------------------------------------------------------------
   Repo-backed maps: maps/index.json + maps/<file>.json committed to the
   GitHub repo itself, so anyone visiting the published site (or you, on
   any device) can browse the same gallery of maps — this is the part
   localStorage alone can't do, since it never leaves one browser.
--------------------------------------------------------------------- */
function slugify(name) {
  const s = (name || "map").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (s || "map") + ".json";
}

async function fetchRepoMapsIndex() {
  try {
    const res = await fetch("maps/index.json", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function openRepoMapsModal() {
  setModalWide(false);
  document.getElementById("modalTitle").textContent = "Browse repo maps";
  const body = document.getElementById("modalBody");
  body.innerHTML = `<p style="font-size:13px;color:var(--text-dim);">Loading maps/index.json…</p>`;
  document.getElementById("modalOverlay").classList.add("open");

  fetchRepoMapsIndex().then(entries => {
    if (entries.length === 0) {
      body.innerHTML = `
        <p style="font-size:13px;color:var(--text-dim);line-height:1.5;">
          No maps found in this site's <code>maps/</code> folder yet.<br><br>
          Use <b>File &gt; Save to repo folder…</b> to add this map there, then commit &amp; push with
          GitHub Desktop so it shows up here for anyone visiting the site.
        </p>`;
      return;
    }
    const sorted = entries.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    body.innerHTML = sorted.map(m => `
      <div class="map-list-item" data-file="${escapeHtml(m.file)}">
        <div class="mli-info">
          <div class="mli-name">${escapeHtml(m.name || m.file)}</div>
          <div class="mli-meta">${m.updatedAt ? "Updated " + new Date(m.updatedAt).toLocaleString() : escapeHtml(m.file)}</div>
        </div>
      </div>`).join("");
    body.querySelectorAll(".map-list-item").forEach(row => {
      row.querySelector(".mli-info").addEventListener("click", () => loadRepoMap(row.dataset.file));
    });
  });
}

async function loadRepoMap(file) {
  try {
    const res = await fetch(`maps/${file}`, { cache: "no-store" });
    if (!res.ok) throw new Error("not found");
    const loaded = await res.json();
    if (!loaded || !loaded.layers) throw new Error("invalid map file");
    projectId = uid();
    state = loaded;
    state.repoFile = file;
    persist();
    bootMapFromState();
    closeModal();
    toast(`Opened "${state.projectName}" from maps/${file}`);
  } catch (err) {
    console.error(err);
    toast("Could not load that map from the repo.");
  }
}

let repoDirHandle = null;

async function pickRepoDirHandle() {
  if (repoDirHandle) {
    try {
      if ((await repoDirHandle.queryPermission({ mode: "readwrite" })) === "granted") return repoDirHandle;
      if ((await repoDirHandle.requestPermission({ mode: "readwrite" })) === "granted") return repoDirHandle;
    } catch (e) { /* handle went stale, fall through to re-pick */ }
  }
  repoDirHandle = await window.showDirectoryPicker({ id: "mymaps-repo-maps", mode: "readwrite" });
  return repoDirHandle;
}

async function writeJsonFile(dirHandle, filename, data) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function readJsonFile(dirHandle, filename) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (e) {
    return null;
  }
}

/* Saves the current map into the site's maps/ folder (index.json + the
   map's own JSON file) using the File System Access API, so the files
   land right in the working copy of the repo — ready for GitHub Desktop
   to pick up as changes to commit & push. Falls back to downloading both
   files (for browsers without that API, e.g. Firefox/Safari). */
async function saveMapToRepoFolder() {
  const filename = state.repoFile || slugify(state.projectName);

  if (!window.showDirectoryPicker) {
    downloadFile(filename, JSON.stringify(state, null, 2), "application/json");
    const index = await fetchRepoMapsIndex();
    upsertIndexEntry(index, filename, state.projectName);
    downloadFile("index.json", JSON.stringify(index, null, 2), "application/json");
    state.repoFile = filename;
    persist();
    toast(`Downloaded ${filename} and index.json — move both into your repo's maps/ folder, then commit & push.`);
    return;
  }

  try {
    const dirHandle = await pickRepoDirHandle();
    await writeJsonFile(dirHandle, filename, state);
    const index = (await readJsonFile(dirHandle, "index.json")) || [];
    upsertIndexEntry(index, filename, state.projectName);
    await writeJsonFile(dirHandle, "index.json", index);
    state.repoFile = filename;
    persist();
    toast(`Saved to maps/${filename} — commit & push in GitHub Desktop to publish.`);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      toast("Could not save to that folder.");
    }
  }
}

function upsertIndexEntry(index, file, name) {
  const existing = index.find(m => m.file === file);
  if (existing) { existing.name = name; existing.updatedAt = Date.now(); }
  else index.push({ file, name, updatedAt: Date.now() });
}

/* ---------------------------------------------------------------------
   GitHub auto-sync: commits the open map straight to the repo via the
   GitHub REST API, a few seconds after you stop editing. No GitHub
   Desktop step needed once this is set up — but it does mean a personal
   access token sits in this browser's localStorage, so only enable it on
   a device/browser you trust.
--------------------------------------------------------------------- */
const LS_GITHUB = "mymaps:github"; // { repo: "owner/name", branch, token }
const GITHUB_SYNC_DELAY = 8000;

function getGitHubConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_GITHUB));
    return (cfg && cfg.repo && cfg.token) ? cfg : null;
  } catch (e) { return null; }
}
function saveGitHubConfig(cfg) { localStorage.setItem(LS_GITHUB, JSON.stringify(cfg)); }
function clearGitHubConfig() { localStorage.removeItem(LS_GITHUB); }

function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
function base64ToUtf8(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))); }

async function githubApi(path, options) {
  const cfg = getGitHubConfig();
  if (!cfg) throw new Error("GitHub sync isn't set up yet.");
  return fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, Object.assign({
    headers: Object.assign({
      "Authorization": `Bearer ${cfg.token}`,
      "Accept": "application/vnd.github+json"
    }, (options && options.headers) || {})
  }, options || {}));
}

async function githubGetFile(path, branch) {
  const res = await githubApi(`contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read ${path} (${res.status})`);
  const data = await res.json();
  return { sha: data.sha, content: base64ToUtf8(data.content) };
}

async function githubPutFile(path, content, message, branch, knownSha, retriesLeft) {
  if (retriesLeft === undefined) retriesLeft = 2;
  const sha = knownSha !== undefined ? knownSha : (await githubGetFile(path, branch) || {}).sha;
  const body = { message, content: utf8ToBase64(content), branch };
  if (sha) body.sha = sha;
  const res = await githubApi(`contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const isShaConflict = res.status === 409 || (res.status === 422 && /does not match/i.test(err.message || ""));
    if (isShaConflict && retriesLeft > 0) {
      // Someone (another tab, another device, a manual commit) changed this file since we
      // last read its sha. Re-fetch the current sha and retry instead of failing outright.
      return githubPutFile(path, content, message, branch, undefined, retriesLeft - 1);
    }
    throw new Error(err.message || `Couldn't write ${path} (${res.status})`);
  }
  return res.json();
}

function setSyncStatus(kind, detail) {
  const el = document.getElementById("githubSyncStatus");
  if (!el) return;
  if (!getGitHubConfig()) { el.textContent = ""; el.className = "sync-status"; el.title = ""; return; }
  const labels = {
    pending: "☁ pending…",
    syncing: "☁ syncing…",
    synced: "☁ synced " + new Date().toLocaleTimeString(),
    error: "⚠ sync failed"
  };
  el.textContent = labels[kind] || "";
  el.className = "sync-status " + kind;
  el.title = kind === "error" ? (detail || "Sync failed — click File > GitHub auto-sync settings to check your token/repo.") : "";
}

let githubSyncTimer = null;
let githubSyncing = false;

function scheduleGitHubSync() {
  if (!getGitHubConfig()) return;
  clearTimeout(githubSyncTimer);
  setSyncStatus("pending");
  githubSyncTimer = setTimeout(syncCurrentMapToGitHub, GITHUB_SYNC_DELAY);
}

async function syncCurrentMapToGitHub() {
  const cfg = getGitHubConfig();
  if (!cfg || githubSyncing || !state) return;
  githubSyncing = true;
  setSyncStatus("syncing");
  const branch = cfg.branch || "main";
  try {
    const filename = state.repoFile || slugify(state.projectName);
    await githubPutFile(`maps/${filename}`, JSON.stringify(state, null, 2), `Update map: ${state.projectName}`, branch);
    state.repoFile = filename;

    let index = [];
    let indexSha = null;
    const indexFile = await githubGetFile("maps/index.json", branch);
    if (indexFile) { index = JSON.parse(indexFile.content); indexSha = indexFile.sha; }
    const existing = index.find(m => m.file === filename);
    if (!existing || existing.name !== state.projectName) {
      upsertIndexEntry(index, filename, state.projectName);
      await githubPutFile("maps/index.json", JSON.stringify(index, null, 2), "Update maps index", branch, indexSha);
    }

    localStorage.setItem(LS_PROJECT_PREFIX + projectId, JSON.stringify(state));
    setSyncStatus("synced");
  } catch (err) {
    console.error(err);
    setSyncStatus("error", err.message);
  } finally {
    githubSyncing = false;
  }
}

/* Bulk-pushes every map currently saved in this browser to the repo —
   for migrating existing local maps once sync is first turned on. */
async function pushAllLocalMapsToGitHub() {
  const cfg = getGitHubConfig();
  if (!cfg) { toast("Set up GitHub sync first."); return; }
  const branch = cfg.branch || "main";
  const idx = loadIndex();
  const ids = Object.keys(idx);
  if (!ids.length) { toast("No local maps to push."); return; }
  toast(`Pushing ${ids.length} map(s) to GitHub…`);

  clearTimeout(githubSyncTimer);
  githubSyncing = true;

  let index = [];
  let indexSha = null;
  try {
    const indexFile = await githubGetFile("maps/index.json", branch);
    if (indexFile) { index = JSON.parse(indexFile.content); indexSha = indexFile.sha; }
  } catch (e) { console.error(e); }

  let ok = 0, failed = 0;
  try {
    for (const id of ids) {
      const proj = loadProject(id);
      if (!proj) continue;
      const filename = proj.repoFile || slugify(proj.projectName);
      try {
        await githubPutFile(`maps/${filename}`, JSON.stringify(proj, null, 2), `Push map: ${proj.projectName}`, branch);
        proj.repoFile = filename;
        localStorage.setItem(LS_PROJECT_PREFIX + id, JSON.stringify(proj));
        upsertIndexEntry(index, filename, proj.projectName);
        ok++;
      } catch (err) {
        console.error(`Failed to push "${proj.projectName}"`, err);
        failed++;
      }
    }
    try {
      await githubPutFile("maps/index.json", JSON.stringify(index, null, 2), "Update maps index", branch, indexSha);
    } catch (err) { console.error(err); }
  } finally {
    githubSyncing = false;
  }

  toast(failed ? `Pushed ${ok} map(s), ${failed} failed — check console.` : `Pushed ${ok} map(s) to GitHub.`);
}

function openGitHubSettingsModal() {
  setModalWide(false);
  const cfg = getGitHubConfig() || {};
  document.getElementById("modalTitle").textContent = "GitHub auto-sync";
  document.getElementById("modalBody").innerHTML = `
    <p style="margin:0 0 12px;font-size:12px;color:var(--text-dim);line-height:1.5;">
      Once set up, the map you have open is committed to your repo automatically, a few seconds after you stop editing —
      no GitHub Desktop step needed. Create a token at <b>github.com/settings/tokens</b>
      (classic token, <code>repo</code> scope; or a fine-grained token with <b>Contents: Read and write</b> on this repo).
      The token is stored only in this browser's local storage.
    </p>
    <label style="font-size:12px;color:var(--text-dim);">Repository (owner/repo)</label>
    <input type="text" id="ghRepo" placeholder="yourname/my-maps" value="${escapeHtml(cfg.repo || "")}" style="width:100%;padding:7px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;box-sizing:border-box;">
    <label style="font-size:12px;color:var(--text-dim);">Branch</label>
    <input type="text" id="ghBranch" placeholder="main" value="${escapeHtml(cfg.branch || "main")}" style="width:100%;padding:7px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;box-sizing:border-box;">
    <label style="font-size:12px;color:var(--text-dim);">Personal access token</label>
    <input type="password" id="ghToken" placeholder="ghp_… or github_pat_…" value="${escapeHtml(cfg.token || "")}" style="width:100%;padding:7px;margin:4px 0 14px;border:1px solid var(--border);border-radius:4px;box-sizing:border-box;">
    <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
      <button class="small-btn danger" id="ghDisable">Turn off sync</button>
      <div style="display:flex;gap:8px;">
        <button class="small-btn secondary" id="ghPushAll">Push all local maps now</button>
        <button class="small-btn" id="ghSave">Save</button>
      </div>
    </div>`;
  document.getElementById("modalOverlay").classList.add("open");

  const readForm = () => ({
    repo: document.getElementById("ghRepo").value.trim(),
    branch: document.getElementById("ghBranch").value.trim() || "main",
    token: document.getElementById("ghToken").value.trim()
  });

  document.getElementById("ghSave").addEventListener("click", () => {
    const next = readForm();
    if (!next.repo || !next.token) { toast("Repository and token are required."); return; }
    saveGitHubConfig(next);
    closeModal();
    setSyncStatus("pending");
    toast("GitHub sync enabled.");
    scheduleGitHubSync();
  });
  document.getElementById("ghDisable").addEventListener("click", () => {
    clearGitHubConfig();
    clearTimeout(githubSyncTimer);
    setSyncStatus("");
    closeModal();
    toast("GitHub sync turned off.");
  });
  document.getElementById("ghPushAll").addEventListener("click", () => {
    const next = readForm();
    if (!next.repo || !next.token) { toast("Repository and token are required."); return; }
    saveGitHubConfig(next);
    closeModal();
    pushAllLocalMapsToGitHub();
  });
}

/* ---------------------------------------------------------------------
   Import / Export
--------------------------------------------------------------------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stateToGeoJSON() {
  const features = [];
  state.layers.forEach(layer => {
    layer.features.forEach(f => {
      let geometry = f.geometry;
      if (geometry.type === "Circle") {
        geometry = { type: "Point", coordinates: geometry.coordinates };
      }
      features.push({
        type: "Feature",
        geometry,
        properties: {
          ...f.properties,
          layer: layer.name,
          color: featureStyle(layer, f),
          opacity: featureOpacity(layer, f),
          ...(f.geometry.type !== "Point" ? { weight: featureWeight(layer, f) } : {}),
          ...(f.geometry.type === "Circle" ? { radius: f.geometry.radius } : {})
        }
      });
    });
  });
  return { type: "FeatureCollection", properties: { name: state.projectName }, features };
}

function exportGeoJSON() {
  const gj = stateToGeoJSON();
  downloadFile(`${safeFileName(state.projectName)}.geojson`, JSON.stringify(gj, null, 2), "application/geo+json");
  toast("Exported GeoJSON");
}

function safeFileName(s) { return (s || "map").replace(/[^a-z0-9\-_ ]/gi, "").trim() || "map"; }

function kmlColor(hex, opacity) {
  hex = toHexColor(hex).replace("#", "");
  if (hex.length !== 6) hex = "ff0000";
  const r = hex.slice(0,2), g = hex.slice(2,4), b = hex.slice(4,6);
  const alpha = Math.round(Math.max(0, Math.min(1, opacity == null ? 1 : opacity)) * 255).toString(16).padStart(2, "0");
  return `${alpha}${b}${g}${r}`;
}

function exportKML() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeHtml(state.projectName)}</name>\n`;
  state.layers.forEach(layer => {
    xml += `<Folder><name>${escapeHtml(layer.name)}</name>\n`;
    layer.features.forEach(f => {
      const baseColor = featureStyle(layer, f);
      const weight = featureWeight(layer, f);
      const opacity = featureOpacity(layer, f);
      const g = f.geometry;
      const iconColor = kmlColor(baseColor, 1);
      const strokeColor = kmlColor(baseColor, g.type === "LineString" ? opacity : 1);
      const fillColor = kmlColor(baseColor, g.type === "Polygon" ? opacity : 0.5);
      xml += `<Placemark><name>${escapeHtml(f.properties.name || "")}</name><description>${escapeHtml(f.properties.description || "")}</description>`;
      const extraKeys = Object.keys(f.properties).filter(k => !INTERNAL_STYLE_KEYS.has(k) && k !== "name" && k !== "description");
      if (extraKeys.length) {
        xml += `<ExtendedData>` + extraKeys.map(k =>
          `<Data name="${escapeHtml(k)}"><value>${escapeHtml(f.properties[k])}</value></Data>`
        ).join("") + `</ExtendedData>`;
      }
      xml += `<Style><IconStyle><color>${iconColor}</color></IconStyle><LineStyle><color>${strokeColor}</color><width>${weight}</width></LineStyle><PolyStyle><color>${fillColor}</color></PolyStyle></Style>`;
      if (g.type === "Point" || g.type === "Circle") {
        xml += `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`;
      } else if (g.type === "LineString") {
        xml += `<LineString><coordinates>${g.coordinates.map(c => c[0]+","+c[1]+",0").join(" ")}</coordinates></LineString>`;
      } else if (g.type === "Polygon") {
        xml += `<Polygon><outerBoundaryIs><LinearRing><coordinates>${g.coordinates[0].map(c => c[0]+","+c[1]+",0").join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      }
      xml += `</Placemark>\n`;
    });
    xml += `</Folder>\n`;
  });
  xml += `</Document></kml>`;
  downloadFile(`${safeFileName(state.projectName)}.kml`, xml, "application/vnd.google-earth.kml+xml");
  toast("Exported KML");
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (file.name.toLowerCase().endsWith(".kml")) {
        importKML(reader.result, file.name);
      } else {
        importGeoJSON(JSON.parse(reader.result), file.name);
      }
    } catch (err) {
      console.error(err);
      toast("Could not read that file.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

function newImportLayer(name) {
  const layer = { id: uid(), name, color: colorForIndex(state.layers.length), visible: true, features: [] };
  state.layers.push(layer);
  return layer;
}

function importGeoJSON(gj, filename) {
  const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
  const layer = newImportLayer(`Imported: ${filename.replace(/\.[^.]+$/, "")}`);
  feats.forEach(f => {
    if (!f.geometry) return;
    let geometry = f.geometry;
    if (geometry.type === "Point" && f.properties && f.properties.radius) {
      geometry = { type: "Circle", coordinates: geometry.coordinates, radius: f.properties.radius };
    } else if (geometry.type === "Polygon" && geometry.coordinates.length) {
      // keep as-is
    } else if (geometry.type === "MultiPolygon" || geometry.type === "MultiLineString" || geometry.type === "MultiPoint") {
      // flatten: take first part for simplicity
      geometry = geometry.type === "MultiPoint"
        ? { type: "Point", coordinates: geometry.coordinates[0] }
        : geometry.type === "MultiLineString"
          ? { type: "LineString", coordinates: geometry.coordinates[0] }
          : { type: "Polygon", coordinates: geometry.coordinates[0] };
    }
    const props = Object.assign({}, f.properties);
    props.name = props.name || props.Name || "";
    props.description = props.description || props.Description || "";
    delete props.Name;
    delete props.Description;
    layer.features.push({ id: uid(), type: "Feature", geometry, properties: props });
  });
  ensureLayerColumns(layer);
  state.activeLayerId = layer.id;
  renderLayers(); renderLayerPanel(); updateActiveLayerLabel(); persist();
  toast(`Imported ${layer.features.length} item(s) into "${layer.name}"`);
}

/* Reads a placemark's <ExtendedData> — Google My Maps and most GIS tools
   store extra data-table columns here, as either <Data name="..."><value>
   or the schema-based <SimpleData name="...">, never as plain attributes
   on the Placemark itself. */
function parseKmlExtendedData(pm) {
  const props = {};
  const ext = pm.getElementsByTagName("ExtendedData")[0];
  if (!ext) return props;
  Array.from(ext.getElementsByTagName("Data")).forEach(d => {
    const key = d.getAttribute("name");
    if (!key) return;
    const valueEl = d.getElementsByTagName("value")[0];
    props[key] = valueEl ? valueEl.textContent : "";
  });
  Array.from(ext.getElementsByTagName("SimpleData")).forEach(d => {
    const key = d.getAttribute("name");
    if (key) props[key] = d.textContent;
  });
  return props;
}

function importKML(xmlText, filename) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const layer = newImportLayer(`Imported: ${filename.replace(/\.[^.]+$/, "")}`);

  const parseCoords = (text) => text.trim().split(/\s+/).map(pair => {
    const [lng, lat] = pair.split(",").map(Number);
    return [lng, lat];
  });

  placemarks.forEach(pm => {
    const name = pm.getElementsByTagName("name")[0]?.textContent || "";
    const desc = pm.getElementsByTagName("description")[0]?.textContent || "";
    const extra = parseKmlExtendedData(pm);
    let geometry = null;

    const point = pm.getElementsByTagName("Point")[0];
    const line = pm.getElementsByTagName("LineString")[0];
    const poly = pm.getElementsByTagName("Polygon")[0];

    if (point) {
      const c = parseCoords(point.getElementsByTagName("coordinates")[0].textContent)[0];
      geometry = { type: "Point", coordinates: c };
    } else if (line) {
      geometry = { type: "LineString", coordinates: parseCoords(line.getElementsByTagName("coordinates")[0].textContent) };
    } else if (poly) {
      const ring = poly.getElementsByTagName("coordinates")[0].textContent;
      geometry = { type: "Polygon", coordinates: [parseCoords(ring)] };
    }
    if (geometry) {
      layer.features.push({ id: uid(), type: "Feature", geometry, properties: { name, description: desc, ...extra } });
    }
  });

  ensureLayerColumns(layer);
  state.activeLayerId = layer.id;
  renderLayers(); renderLayerPanel(); updateActiveLayerLabel(); persist();
  toast(`Imported ${layer.features.length} item(s) into "${layer.name}"`);
}

/* ---------------------------------------------------------------------
   Share link (encodes full state into URL hash)
--------------------------------------------------------------------- */
function shareLink() {
  const json = JSON.stringify(state);
  const packed = LZString.compressToEncodedURIComponent(json);
  const url = `${location.origin}${location.pathname}#share=${packed}`;
  if (url.length > 8000) {
    toast("This map is large — the link may not work in all browsers. Consider Export instead.");
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      toast("Shareable link copied to clipboard!");
    }).catch(() => {
      showLinkModal("Couldn't access the clipboard automatically — copy the link below:", url);
    });
  } else {
    showLinkModal("Copy the link below to share this map:", url);
  }
}

function tryLoadFromHash() {
  const m = /#share=(.+)/.exec(location.hash);
  if (!m) return false;
  try {
    const json = LZString.decompressFromEncodedURIComponent(m[1]);
    const loaded = JSON.parse(json);
    if (loaded && loaded.layers) {
      projectId = uid();
      state = loaded;
      persist();
      toast("Loaded shared map. It's now saved as your own copy.");
      return true;
    }
  } catch (e) { console.error(e); }
  return false;
}

/* ---------------------------------------------------------------------
   Search (Nominatim / OpenStreetMap)
--------------------------------------------------------------------- */
function wireSearch() {
  const box = document.getElementById("searchBox");
  const results = document.getElementById("searchResults");
  const runSearch = debounce(async () => {
    const q = box.value.trim();
    if (q.length < 3) { results.classList.remove("open"); results.innerHTML = ""; return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.length) { results.innerHTML = `<div>No results</div>`; results.classList.add("open"); return; }
      results.innerHTML = data.map((d, i) => `<div data-i="${i}">${escapeHtml(d.display_name)}</div>`).join("");
      results.classList.add("open");
      results.querySelectorAll("div[data-i]").forEach(row => {
        row.addEventListener("click", () => {
          const d = data[+row.dataset.i];
          const lat = +d.lat, lng = +d.lon;
          map.setView([lat, lng], 14);
          if (searchMarker) map.removeLayer(searchMarker);
          searchMarker = L.marker([lat, lng], { icon: pinIcon("#1a73e8") }).addTo(map)
            .bindPopup(`<b>${escapeHtml(d.display_name)}</b><br><button id="addSearchPin" style="margin-top:6px;">Add to active layer</button>`)
            .openPopup();
          searchMarker.on("popupopen", () => {
            document.getElementById("addSearchPin")?.addEventListener("click", () => {
              const layer = getLayer(state.activeLayerId);
              if (!layer) { toast("Select a layer first."); return; }
              layer.features.push({ id: uid(), type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { name: d.display_name.split(",")[0], description: d.display_name } });
              renderLayers(); renderLayerPanel(); persistDebounced();
              map.removeLayer(searchMarker); searchMarker = null;
              toast("Added");
            });
          });
          results.classList.remove("open");
          box.value = d.display_name;
        });
      });
    } catch (err) { console.error(err); }
  }, 400);
  box.addEventListener("input", runSearch);
  document.addEventListener("click", (e) => { if (!results.contains(e.target) && e.target !== box) results.classList.remove("open"); });
}

/* ---------------------------------------------------------------------
   Sidebar wiring placeholder (kept for structure / future extension)
--------------------------------------------------------------------- */
function wireSidebar() {}

/* Load shared-link content on first paint if present */
window.addEventListener("load", () => {
  if (location.hash.startsWith("#share=")) {
    setTimeout(() => { if (tryLoadFromHash()) bootMapFromState(); }, 0);
  }
});

})();
