// scripts/layers.js
// ----------------------------------------------------
// Layers Panel
// - Upload CSV/GeoJSON/Shapefile ZIP
// - Uploaded layers list
// - Repo layers list grouped
// - Roads non-interactive
// - Stores features for later analysis
// ----------------------------------------------------
console.log("✅ layers.js loaded");

(function () {
  // ----------------------------
  // Global store for analysis later
  // ----------------------------
  window.UserLayerManager = window.UserLayerManager || {
    uploaded: {}, // id -> { layer, features, meta, active, opacity }
    repo: {}, // id -> { layer, features, meta, active, opacity }
    getAllActiveFeatures() {
      const out = [];
      for (const id in this.uploaded) {
        const d = this.uploaded[id];
        if (d?.active && Array.isArray(d.features)) out.push(...d.features);
      }
      for (const id in this.repo) {
        const d = this.repo[id];
        if (d?.active && Array.isArray(d.features)) out.push(...d.features);
      }
      return out;
    },
  };

  function uid(prefix = "layer") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function el(tag, className, html) {
    const d = document.createElement(tag);
    if (className) d.className = className;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function sanitize(x) {
    return window.LayerStyle?.sanitize ? window.LayerStyle.sanitize(x) : String(x ?? "");
  }

  // ----------------------------
  // CSV handling
  // Default projection: EPSG:32620 (UTM WGS84 20N)
  // ----------------------------
  function utmToLatLon32620(easting, northing) {
    if (typeof proj4 === "undefined") return null;

    const utm20 = "+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs";
    const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";

    try {
      const [lon, lat] = proj4(utm20, wgs84, [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  }

  async function handleCsvUpload(file) {
    if (typeof Papa === "undefined") {
      alert("PapaParse is missing. Ensure papaparse is loaded.");
      return null;
    }

    const text = await file.text();
    const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;

    const markers = [];
    const features = [];

    for (const r of rows) {
      // Expect Easting/Northing (UTM 20N default)
      const e = parseFloat(r.Easting);
      const n = parseFloat(r.Northing);
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;

      const ll = utmToLatLon32620(e, n);
      if (!ll) continue;

      const m = L.circleMarker([ll.lat, ll.lon], {
        radius: 6,
        color: "#22c55e",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 0.85,
      });

      // Popup with all fields
      const popupHtml = window.LayerStyle?.makePopupHtml
        ? window.LayerStyle.makePopupHtml(file.name, r)
        : `<div class="ema-popup"><pre>${sanitize(JSON.stringify(r, null, 2))}</pre></div>`;
      m.bindPopup(popupHtml);

      markers.push(m);

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [ll.lon, ll.lat] },
        properties: { ...r, __sourceFile: file.name, __assumedCRS: "EPSG:32620" },
      });
    }

    const group = L.featureGroup(markers);
    group.__ema = {
      type: "upload_csv",
      setOpacity(opacity) {
        group.eachLayer((l) => l.setStyle?.({ fillOpacity: opacity }));
      },
      updateZoomStyles() {},
    };

    return { layer: group, features };
  }

  async function handleGeoJsonUpload(file) {
    // GeoJSON should already be EPSG:4326 for web maps
    const text = await file.text();
    const data = JSON.parse(text);

    const cfg = { id: uid("upload_geojson"), name: file.name, type: "upload_geojson" };
    const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

    return { layer: built.layer, features: data.features || [] };
  }

  async function handleShapefileZipUpload(file) {
    // shpjs will use .prj if present; no user CRS prompt
    if (typeof shp === "undefined") {
      alert(
        "Shapefile support requires shpjs.\nAdd:\n<script src=\"https://unpkg.com/shpjs@latest/dist/shp.min.js\"></script>"
      );
      return null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = await shp(arrayBuffer); // GeoJSON output

    const cfg = { id: uid("upload_shp"), name: file.name, type: "upload_shp" };
    const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

    return { layer: built.layer, features: data.features || [] };
  }

  // ----------------------------
  // UI builders
  // ----------------------------
  function makeSection(title, subtitle = "") {
    const sec = el("div", "layer-section");
    sec.appendChild(el("h3", "", sanitize(title)));
    if (subtitle) sec.appendChild(el("p", "", sanitize(subtitle)));
    return sec;
  }

  /**
   * makeLayerRow()
   * - nameBtn is the "style" button
   * - toggle is below label
   * - opacity slider under toggle
   * - metadata link under opacity (when needed)
   * - remove X button only when enabled (for uploads)
   */
  function makeLayerRow(name, metaUrl = "", options = {}) {
    const { showRemove = false, onRemove = null } = options;

    const wrap = el("div", "layer-item-card");

    // TOP ROW: Name button + optional remove button
    const topRow = el("div", "layer-card-toprow");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "space-between";
    topRow.style.gap = "10px";

    // Title button (also acts as style button)
    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "layer-name-btn";
    titleBtn.textContent = name;

    topRow.appendChild(titleBtn);

    // Remove button (only for uploads)
    let removeBtn = null;
    if (showRemove) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "layer-remove-btn";
      removeBtn.title = "Remove this uploaded layer";
      removeBtn.setAttribute("aria-label", "Remove layer");
      removeBtn.textContent = "✕";

      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onRemove === "function") onRemove();
      });

      topRow.appendChild(removeBtn);
    }

    // Toggle row (below title)
    const toggleRow = el("div", "layer-toggle-row");
    toggleRow.innerHTML = `
      <label class="toggle-switch" title="Toggle layer">
        <input type="checkbox" class="layer-toggle" />
        <span class="toggle-slider"></span>
      </label>
    `;

    const toggle = toggleRow.querySelector(".layer-toggle");

    // Opacity row
    const opacityRow = el("div", "layer-opacity-row");
    opacityRow.innerHTML = `
      <div class="layer-opacity-label">Opacity</div>
      <input class="opacity-slider" type="range" min="0" max="1" step="0.05" value="0.7">
    `;
    const slider = opacityRow.querySelector(".opacity-slider");

    // Metadata icon row (optional)
    const metaRow = el("div", "layer-meta-row");

    if (metaUrl) {
      const metaLink = document.createElement("a");
      metaLink.className = "layer-meta-link";
      metaLink.href = metaUrl;
      metaLink.target = "_blank";
      metaLink.rel = "noopener noreferrer";
      metaLink.title = "Open metadata document";
      metaLink.innerHTML = `📄 <span>Metadata</span>`;
      metaRow.appendChild(metaLink);
    } else {
      metaRow.style.display = "none";
    }

    wrap.appendChild(topRow);
    wrap.appendChild(toggleRow);
    wrap.appendChild(opacityRow);
    wrap.appendChild(metaRow);

    // --- Style panel (hidden until name clicked)
    // We build the actual controls lazily when the user clicks the layer name
    // because repo layers load asynchronously and uploads can have different fields.
    const stylePanel = el("div", "upload-style-panel hidden");
    wrap.appendChild(stylePanel);

    return { container: wrap, toggle, nameBtn: titleBtn, slider, removeBtn, stylePanel };
  }

  // ----------------------------
  // Repo layer grouping
  // ----------------------------
  function groupRepoLayers(config) {
    const groups = {};
    for (const cfg of config) {
      const t = cfg.type || "other";
      if (!groups[t]) groups[t] = [];
      groups[t].push(cfg);
    }
    return groups;
  }

  // ----------------------------
  // Styling helpers (repo + uploads)
  // ----------------------------
  function inferGeomTypeFromFeatures(features, fallback = "polygon") {
    try {
      const t = features?.[0]?.geometry?.type;
      if (!t) return fallback;
      if (t.includes("Point")) return "point";
      if (t.includes("Line")) return "line";
      if (t.includes("Polygon")) return "polygon";
      return fallback;
    } catch {
      return fallback;
    }
  }

  function listFieldsFromFeatures(features) {
    const props = features?.[0]?.properties;
    if (!props) return [];
    return Object.keys(props);
  }

  function buildCategoryMapFromFeatures(features, field) {
    if (!field) return null;
    const values = (features || []).map((f) => f?.properties?.[field]);
    if (window.LayerStyle?.buildCategoryColorMap) {
      return window.LayerStyle.buildCategoryColorMap(values);
    }

    // fallback simple palette
    const uniq = Array.from(new Set(values.map((v) => String(v ?? ""))));
    const out = {};
    const count = uniq.length || 1;
    uniq.forEach((v, i) => {
      const hue = (i * 360) / count;
      out[v] = `hsl(${hue}, 55%, 78%)`;
    });
    return out;
  }

  function ensureLayerStyleDefaults(obj) {
    obj.style = obj.style || {
      mode: "single", // single | category
      field: null,
      strokeColor: "#6b7280",
      fillColor: "#e5e7eb",
      pointColor: "#22c55e",
      categoryMap: null,
    };
    // Backfill any missing keys
    if (!obj.style.mode) obj.style.mode = "single";
    if (obj.style.strokeColor === undefined) obj.style.strokeColor = "#6b7280";
    if (obj.style.fillColor === undefined) obj.style.fillColor = "#e5e7eb";
    if (obj.style.pointColor === undefined) obj.style.pointColor = "#22c55e";
  }

  function buildLeafletLayerFromStore(obj) {
    // Rebuild a Leaflet layer from stored features + style settings
    ensureLayerStyleDefaults(obj);

    const features = obj.features || [];

    // CSV uploads are stored as point features, but we build manually for full control
    if (obj.meta?.source === "upload" && obj.meta?.uploadKind === "csv") {
      const markers = [];
      for (const f of features) {
        const coords = f?.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;

        const lon = coords[0];
        const lat = coords[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const props = f?.properties || {};

        // Category or single color
        let color = obj.style.pointColor;
        if (obj.style.mode === "category" && obj.style.field && obj.style.categoryMap) {
          const key = props[obj.style.field];
          color = obj.style.categoryMap[key] || obj.style.pointColor;
        }

        const m = L.circleMarker([lat, lon], {
          radius: 6,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: obj.opacity ?? 0.7,
        });

        const popupHtml = window.LayerStyle?.makePopupHtml
          ? window.LayerStyle.makePopupHtml(obj.name, props)
          : `<pre>${sanitize(JSON.stringify(props, null, 2))}</pre>`;
        m.bindPopup(popupHtml, { maxWidth: 380 });

        markers.push(m);
      }

      const group = L.featureGroup(markers);
      group.__ema = {
        type: "upload_csv",
        setOpacity(opacity) {
          group.eachLayer((l) => l.setStyle?.({ fillOpacity: opacity }));
        },
        updateZoomStyles() {},
      };

      return group;
    }

    const geomType = inferGeomTypeFromFeatures(features);
    const labelField = obj.meta?.labelField || null;

    const stylePolygon = (feature) => {
      const props = feature?.properties || {};

      let fillColor = obj.style.fillColor;
      if (obj.style.mode === "category" && obj.style.field && obj.style.categoryMap) {
        const key = props[obj.style.field];
        fillColor = obj.style.categoryMap[key] || fillColor;
      }

      return {
        color: obj.style.strokeColor,
        weight: window.LayerStyle?.getPolygonStrokeWidth
          ? window.LayerStyle.getPolygonStrokeWidth(map.getZoom())
          : 2,
        fillColor,
        fillOpacity: obj.opacity ?? 0.7,
        opacity: 1,
      };
    };

    const styleLine = (feature) => {
      const props = feature?.properties || {};
      let color = obj.style.strokeColor;
      if (obj.style.mode === "category" && obj.style.field && obj.style.categoryMap) {
        const key = props[obj.style.field];
        color = obj.style.categoryMap[key] || color;
      }
      return {
        color,
        weight: 2,
        opacity: obj.opacity ?? 0.7,
      };
    };

    const pointToLayer = (feature, latlng) => {
      const props = feature?.properties || {};
      let color = obj.style.pointColor;
      if (obj.style.mode === "category" && obj.style.field && obj.style.categoryMap) {
        const key = props[obj.style.field];
        color = obj.style.categoryMap[key] || color;
      }
      return L.circleMarker(latlng, {
        radius: 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: obj.opacity ?? 0.7,
      });
    };

    const onEachFeature = (feature, lyr) => {
      const props = feature?.properties || {};
      const popupHtml = window.LayerStyle?.makePopupHtml
        ? window.LayerStyle.makePopupHtml(obj.name, props, obj.meta?.hideFields || [])
        : `<pre>${sanitize(JSON.stringify(props, null, 2))}</pre>`;

      lyr.bindPopup(popupHtml, {
        maxWidth: 380,
        closeButton: true,
        autoPan: true,
      });

      // Optional tooltip label (polygon only)
      if (geomType === "polygon" && labelField && props[labelField]) {
        lyr.bindTooltip(String(props[labelField]), {
          direction: "center",
          className: "zone-label",
          sticky: true,
        });
      }
    };

    let leafletLayer;
    const fc = { type: "FeatureCollection", features: features };

    if (geomType === "polygon") {
      leafletLayer = L.geoJSON(fc, { style: stylePolygon, onEachFeature });
    } else if (geomType === "line") {
      leafletLayer = L.geoJSON(fc, { style: styleLine, onEachFeature });
    } else if (geomType === "point") {
      leafletLayer = L.geoJSON(fc, { pointToLayer, onEachFeature });
    } else {
      leafletLayer = L.geoJSON(fc, { onEachFeature });
    }

    leafletLayer.__ema = {
      type: `styled_${geomType}`,
      setOpacity(opacity) {
        // polygons use fillOpacity, lines use opacity, points use fillOpacity
        if (geomType === "polygon") {
          leafletLayer.setStyle({ fillOpacity: opacity });
        } else if (geomType === "line") {
          leafletLayer.setStyle({ opacity: opacity });
        } else if (geomType === "point") {
          leafletLayer.eachLayer((l) => l.setStyle?.({ fillOpacity: opacity }));
        }
      },
      updateZoomStyles() {
        if (geomType === "polygon" && window.LayerStyle?.getPolygonStrokeWidth) {
          leafletLayer.setStyle({ weight: window.LayerStyle.getPolygonStrokeWidth(map.getZoom()) });
        }
      },
    };

    return leafletLayer;
  }

  function applyStyleUpdate(obj, storeKey, id) {
    if (!obj) return;

    // Update category map if required
    if (obj.style.mode === "category" && obj.style.field) {
      obj.style.categoryMap = buildCategoryMapFromFeatures(obj.features || [], obj.style.field);
    } else {
      obj.style.categoryMap = null;
    }

    const wasActive = !!obj.active;
    const oldLayer = obj.layer;

    // Remove old layer from map
    if (oldLayer && map.hasLayer(oldLayer)) {
      map.removeLayer(oldLayer);
    }

    // Rebuild
    obj.layer = buildLeafletLayerFromStore(obj);

    // Persist back into manager
    window.UserLayerManager[storeKey][id] = obj;

    if (wasActive) {
      obj.layer.addTo(map);
    }

    // Keep opacity applied
    if (obj.layer?.__ema?.setOpacity) {
      obj.layer.__ema.setOpacity(obj.opacity ?? 0.7);
    }

    // Keep zoom-responsiveness
    if (obj.layer.__ema?.updateZoomStyles) {
      // Attach only once per store entry
      if (!obj.__zoomHandlerAttached) {
        obj.__zoomHandlerAttached = true;
        map.on("zoomend", () => {
          try {
            obj.layer?.__ema?.updateZoomStyles?.();
          } catch {
            // ignore
          }
        });
      }
    }
  }

  function buildStylePanel(row, obj, storeKey, id) {
    if (!row?.stylePanel || !obj) return;
    if (row.stylePanel.__built) return;

    // Roads are handled separately and are not shown in the panel
    if (obj.meta?.type === "roads") {
      row.stylePanel.innerHTML = `<div class="muted small">Road styling is fixed.</div>`;
      row.stylePanel.__built = true;
      return;
    }

    ensureLayerStyleDefaults(obj);

    const features = obj.features || [];
    const fields = listFieldsFromFeatures(features);
    const geomType =
      obj.meta?.source === "upload" && obj.meta?.uploadKind === "csv"
        ? "point"
        : inferGeomTypeFromFeatures(features);

    // Ensure sane defaults per geometry
    if (geomType === "point" && !obj.style.pointColor) obj.style.pointColor = "#22c55e";

    row.stylePanel.innerHTML = `
      <div class="upload-style-grid">
        <label class="small muted">Style by field</label>
        <select class="upload-field-select">
          <option value="">(single colour)</option>
          ${fields
            .map((f) => `<option value="${sanitize(f)}">${sanitize(f)}</option>`)
            .join("")}
        </select>

        <div class="upload-color-row">
          <div class="upload-color-block">
            <label class="small muted">Stroke</label>
            <input type="color" class="stroke-color" value="${obj.style.strokeColor}">
          </div>

          <div class="upload-color-block fill-block">
            <label class="small muted">Fill</label>
            <input type="color" class="fill-color" value="${obj.style.fillColor}">
          </div>

          <div class="upload-color-block point-block">
            <label class="small muted">Point</label>
            <input type="color" class="point-color" value="${obj.style.pointColor}">
          </div>
        </div>

        <div class="small muted">
          Tip: choosing a field will auto-generate colours per category.
        </div>
      </div>
    `;

    // Hide irrelevant blocks based on geometry
    const fillBlock = row.stylePanel.querySelector(".fill-block");
    const pointBlock = row.stylePanel.querySelector(".point-block");
    if (geomType === "polygon") {
      if (pointBlock) pointBlock.style.display = "none";
    } else if (geomType === "line") {
      if (fillBlock) fillBlock.style.display = "none";
      if (pointBlock) pointBlock.style.display = "none";
    } else if (geomType === "point") {
      if (fillBlock) fillBlock.style.display = "none";
    }

    // Set dropdown selected if already category mode
    const fieldSelect = row.stylePanel.querySelector(".upload-field-select");
    if (obj.style.mode === "category" && obj.style.field) {
      fieldSelect.value = obj.style.field;
    }

    // Wire events
    const strokePicker = row.stylePanel.querySelector(".stroke-color");
    const fillPicker = row.stylePanel.querySelector(".fill-color");
    const pointPicker = row.stylePanel.querySelector(".point-color");

    fieldSelect.addEventListener("change", () => {
      const field = fieldSelect.value;
      if (field) {
        obj.style.mode = "category";
        obj.style.field = field;
      } else {
        obj.style.mode = "single";
        obj.style.field = null;
      }
      applyStyleUpdate(obj, storeKey, id);
    });

    strokePicker.addEventListener("input", () => {
      obj.style.strokeColor = strokePicker.value;
      applyStyleUpdate(obj, storeKey, id);
    });

    if (fillPicker) {
      fillPicker.addEventListener("input", () => {
        obj.style.fillColor = fillPicker.value;
        applyStyleUpdate(obj, storeKey, id);
      });
    }

    if (pointPicker) {
      pointPicker.addEventListener("input", () => {
        obj.style.pointColor = pointPicker.value;
        applyStyleUpdate(obj, storeKey, id);
      });
    }

    row.stylePanel.__built = true;
  }

  // ----------------------------
  // Initiation
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof map === "undefined") {
      console.warn("❌ layers.js: map not found. Ensure main.js loads first.");
      return;
    }

    if (!window.LayerStyle) {
      console.warn("❌ layers.js: LayerStyle missing. Ensure layerStyle.js loads before layers.js.");
      return;
    }

    const root = document.getElementById("layers-root");
    if (!root) {
      console.warn("❌ layers.js: #layers-root missing. Add panel-layers container in index.html.");
      return;
    }

    root.innerHTML = "";

    async function preloadRepoLayers() {
      const registry = window.GEOJSON_LAYERS_CONFIG || [];

      for (const cfg of registry) {
        if (window.UserLayerManager.repo[cfg.id]) continue;

        try {
          const resp = await fetch(cfg.url);
          const data = await resp.json();

          const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

          const feats = built.features || (data.features || []);
          const labelField = computeLabelField(cfg, feats);

          window.UserLayerManager.repo[cfg.id] = {
            id: cfg.id,
            name: cfg.name,
            layer: built.layer,
            features: feats,
            active: false,
            opacity: cfg.type === "roads" ? 0.6 : 0.7,
            meta: {
              type: cfg.type,
              url: cfg.url,

              labelField: labelField,
            },
          };

          // Zoom-aware styling is handled by applyStyleUpdate(...) which attaches a safe handler.
        } catch (e) {
          console.warn("❌ Failed to preload repo layer:", cfg.name, e);
        }
      }

      console.log("✅ Repo layers preloaded");

      // Notify Filters/Analysis that repo layers are ready
      document.dispatchEvent(new CustomEvent("layers:repoPreloaded"));

      // Force Major Roads always ON
      const roadsId = "major_roads";
      const roadsObj = window.UserLayerManager.repo[roadsId];

      if (roadsObj?.layer) {
        roadsObj.active = true;

        if (!map.hasLayer(roadsObj.layer)) {
          roadsObj.layer.addTo(map);
        }

        // Ensure dynamic visibility behavior kicks in
        roadsObj.layer.__ema?.setActive?.(true);

        // Set base opacity (line opacity) for roads
        roadsObj.layer.__ema?.setOpacity?.(0.6);
      }
    }

        // Determine the label field used for styling/tooltips (to be used in analysis and filter sections)
        function computeLabelField(cfg, features) {
          if (!features || !features.length) return null;

          // If config explicitly provides labelField, use it
          if (cfg.labelField) return cfg.labelField;

          // Same defaults used in layerStyle.js
          if (cfg.type === "municipality") return "NAME_1";
          if (cfg.type === "zone") return "zone";

          // Otherwise guess from properties
          if (window.LayerStyle?.guessLabelProperty) {
            return window.LayerStyle.guessLabelProperty(features);
          }

          return null;
        }

    // Start preloading (runs in background)
    preloadRepoLayers();

    // ----------------------------
    // Section 1: Upload
    // ----------------------------
    const uploadSec = makeSection("Upload data", "Upload CSV (UTM), GeoJSON, or Shapefile (.zip).");

    const uploadUI = el("div", "layer-upload-row");
    uploadUI.innerHTML = `
      <label>Select file(s)</label>
      <input id="upload-file" type="file" multiple accept=".csv,.geojson,.json,.zip" />
      <button id="upload-btn" type="button">Upload</button>
    `;

    uploadSec.appendChild(uploadUI);
    root.appendChild(uploadSec);

    const fileInput = uploadUI.querySelector("#upload-file");
    const uploadBtn = uploadUI.querySelector("#upload-btn");

    // ----------------------------
    // Section 2: Uploaded layers
    // ----------------------------
    const uploadedSec = makeSection("User-uploaded layers", "Uploaded layers appear here.");
    const uploadedList = el("div", "layer-list");
    uploadedSec.appendChild(uploadedList);
    root.appendChild(uploadedSec);

    // ----------------------------
    // Section 3: Repo layers
    // ----------------------------
    const repoSec = makeSection("GeoJson layers");
    root.appendChild(repoSec);

    const repoGroups = groupRepoLayers(window.GEOJSON_LAYERS_CONFIG || []);
    const groupOrder = window.REPO_LAYER_GROUPS || [];

    // Create group blocks in a consistent order
    for (const g of groupOrder) {
      const list = repoGroups[g.id];
      if (!list || !list.length) continue;

      // Remove roads from what gets displayed in the panel
      const visibleList = list.filter((cfg) => cfg.type !== "roads");

      // If nothing remains after filtering, skip the entire group heading
      if (!visibleList.length) continue;

      const groupBlock = el("div", "layer-section");
      groupBlock.style.marginTop = "12px";
      groupBlock.appendChild(el("h3", "", sanitize(g.title)));

      const groupList = el("div", "layer-list");
      groupBlock.appendChild(groupList);
      repoSec.appendChild(groupBlock);

      for (const cfg of visibleList) {
        const row = makeLayerRow(cfg.name, cfg.metaUrl || "");
        groupList.appendChild(row.container);

        row.slider.value = "0.7";

        row.toggle.addEventListener("change", () => {
          const isOn = row.toggle.checked;

          const obj = window.UserLayerManager.repo[cfg.id];
          if (!obj) {
            alert(`Layer not ready yet: ${cfg.name}`);
            row.toggle.checked = false;
            return;
          }

          obj.active = isOn;

          if (isOn) {
            obj.layer.addTo(map);
            obj.layer.__ema?.setOpacity(parseFloat(row.slider.value));
          } else {
            map.removeLayer(obj.layer);
          }
        });

        row.slider.addEventListener("input", () => {
          const obj = window.UserLayerManager.repo[cfg.id];
          const val = parseFloat(row.slider.value);

          if (!obj) return;
          obj.opacity = val;

          if (obj.active && obj.layer?.__ema?.setOpacity) {
            obj.layer.__ema.setOpacity(val);
          }
        });

        row.nameBtn.addEventListener("click", () => {
          const obj = window.UserLayerManager.repo[cfg.id];
          if (!obj) {
            alert(`Layer not ready yet: ${cfg.name}`);
            return;
          }

          // Build controls on first open
          buildStylePanel(row, obj, "repo", cfg.id);

          // Toggle visibility
          row.stylePanel.classList.toggle("hidden");
        });
      }
    }

    // ----------------------------
    // Upload click
    // ----------------------------
    uploadBtn.addEventListener("click", async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) {
        alert("Please select at least one file.");
        return;
      }

      for (const file of files) {
        let result = null;
        let uploadKind = "unknown";

        try {
          const lower = file.name.toLowerCase();

          if (lower.endsWith(".csv")) {
            uploadKind = "csv";
            result = await handleCsvUpload(file);
          } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
            uploadKind = "geojson";
            result = await handleGeoJsonUpload(file);
          } else if (lower.endsWith(".zip")) {
            uploadKind = "shp";
            result = await handleShapefileZipUpload(file);
          } else {
            alert(`Unsupported file type: ${file.name}`);
            continue;
          }
        } catch (e) {
          console.warn("Upload failed:", e);
          alert(`Failed to upload: ${file.name}`);
          continue;
        }

        if (!result) continue;

        const id = uid("upload");
        const { layer, features } = result;

        const uploadLabelField = computeLabelField({ type: "uploaded" }, features);

        window.UserLayerManager.uploaded[id] = {
          id,
          name: file.name,
          layer,
          features,
          active: false,
          opacity: 0.7,
          meta: {
            source: "upload",
            uploadKind: uploadKind,
            fileName: file.name,

            labelField: uploadLabelField,
          },
        };

        // ✅ Create row WITH REMOVE (X) for uploads only
        const row = makeLayerRow(file.name, "", {
          showRemove: true,
          onRemove: () => {
            const obj = window.UserLayerManager.uploaded[id];
            if (!obj) return;

            // Remove from map if present
            if (obj.layer && map.hasLayer(obj.layer)) {
              map.removeLayer(obj.layer);
            }

            // Remove from store (so analysis cannot access it)
            delete window.UserLayerManager.uploaded[id];

            // Remove UI card
            row.container.remove();
          },
        });

        uploadedList.appendChild(row.container);

        row.slider.value = "0.7";

        row.toggle.addEventListener("change", () => {
          const isOn = row.toggle.checked;
          const obj = window.UserLayerManager.uploaded[id];
          if (!obj) return;

          obj.active = isOn;

          if (isOn) {
            obj.layer.addTo(map);
            obj.layer.__ema?.setOpacity(parseFloat(row.slider.value));
          } else {
            map.removeLayer(obj.layer);
          }
        });

        row.slider.addEventListener("input", () => {
          const obj = window.UserLayerManager.uploaded[id];
          if (!obj) return;

          const val = parseFloat(row.slider.value);
          obj.opacity = val;

          if (obj.active && obj.layer?.__ema?.setOpacity) {
            obj.layer.__ema.setOpacity(val);
          }
        });

        row.nameBtn.addEventListener("click", () => {
          const obj = window.UserLayerManager.uploaded[id];
          if (!obj) return;

          // Build controls on first open
          buildStylePanel(row, obj, "uploaded", id);

          // Toggle visibility
          row.stylePanel.classList.toggle("hidden");
        });
      }

      fileInput.value = "";
    });

    console.log("✅ Layers panel initialized");
  });
})();
