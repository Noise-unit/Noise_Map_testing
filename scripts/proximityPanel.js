// scripts/proximityPanel.js
// ----------------------------------------------------
// Proximity Panel
// - Renders the Proximity Events UI that was previously inside the Filters panel
// - Writes to the SAME per-dataset state object (window.FiltersPanelState[datasetId])
// - Triggers the existing Filters panel Apply/Clear handlers so filtering logic remains single-source
// ----------------------------------------------------

console.log("✅ proximityPanel.js loaded");

(function () {
  // ----------------------------------------------------
  // Shared state helper
  // ----------------------------------------------------
  window.FiltersPanelState = window.FiltersPanelState || {}; 

  function getState(datasetId) {
    window.FiltersPanelState[datasetId] = window.FiltersPanelState[datasetId] || {};
    return window.FiltersPanelState[datasetId];
  }

  // ----------------------------------------------------
  // Small DOM helpers
  // ----------------------------------------------------
  function el(tag, className, html) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function guessReferenceFields(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const keys = Object.keys(rows[0] || {});
    const bad = new Set(["easting", "northing", "lat", "lon", "latitude", "longitude"]);
    const score = (k) => {
      const t = k.toLowerCase();
      if (bad.has(t)) return -100;
      let s = 0;
      if (t.includes("ref")) s += 5;
      if (t.includes("reference")) s += 5;
      if (t.includes("vr")) s += 3;
      if (t.includes("application")) s += 2;
      if (t.includes("cec")) s += 2;
      if (t.includes("file")) s += 2;
      if (t.endsWith("id") || t === "id") s += 1;
      return s;
    };
    return keys
      .map((k) => ({ k, s: score(k) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.k);
  }

    function guessDateFields(rows) {
      // Only allow START/END date choices
      if (!Array.isArray(rows) || rows.length === 0) return [];

      const keys = Object.keys(rows[0] || {});

      const looksDate = (v) => {
        if (v == null || v === "") return false;
        const d = new Date(String(v).trim());
        return !Number.isNaN(d.getTime());
      };

      const hasDateValues = (k) => rows.some((r) => looksDate(r?.[k]));

      const norm = (s) =>
        String(s)
          .toLowerCase()
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const isStart = (k) => {
        const n = norm(k);
        return (n.includes("start") && n.includes("date")) || n === "start date" || n === "start";
      };

      const isEnd = (k) => {
        const n = norm(k);
        return (n.includes("end") && n.includes("date")) || n === "end date" || n === "end";
      };

      const startFields = keys.filter((k) => isStart(k) && hasDateValues(k));
      const endFields = keys.filter((k) => isEnd(k) && hasDateValues(k));

      return [...startFields, ...endFields];
    }

  // ----------------------------------------------------
  // Find the existing Filters panel card for a dataset so we can click its buttons
  // ----------------------------------------------------
  function findFiltersPanelButtons(datasetName) {
    const root = document.getElementById("filters-root");
    if (!root) return { applyBtn: null, clearBtn: null };

    const details = root.querySelectorAll("details");
    for (const d of details) {
      const titleEl = d.querySelector("summary .name");
      if (!titleEl) continue;
      if (titleEl.textContent.trim() === datasetName.trim()) {
        return {
          applyBtn: d.querySelector(".apply-btn"),
          clearBtn: d.querySelector(".clear-btn"),
        };
      }
    }
    return { applyBtn: null, clearBtn: null };
  }

  // ----------------------------------------------------
  // Panel Builder
  // ----------------------------------------------------
  function buildProximityPanel(appManager) {
    const root = document.getElementById("proximity-root");
    if (!root) return;

    root.innerHTML = "";

    const active = [];
    try {
      // AppDataManager keeps datasets as Map(id -> dataset)
      for (const ds of appManager.datasets.values()) {
        if (ds?.active) active.push(ds);
      }
    } catch (e) {
      console.warn("Proximity panel: cannot read active datasets:", e);
      return;
    }

    if (!active.length) {
      root.appendChild(
        el(
          "div",
          "ema-muted",
          "No active datasets. Enable a Google Sheets dataset in <b>Application Data</b> first."
        )
      );
      return;
    }

    const help = el(
      "div",
      "ema-help",
      `
      <div style="margin-bottom:8px;"><b>Proximity Events</b> filters records to those within a radius and time window of a reference Application.</div>
      `
    );
    root.appendChild(help);

    for (const ds of active) {
      const cfg = ds.config;

      const state = getState(cfg.id);
      state.nearbyRef = state.nearbyRef ?? "";
      state.nearbyRadius = Number.isFinite(state.nearbyRadius) ? state.nearbyRadius : 1000;
      state.nearbyDays = Number.isFinite(state.nearbyDays) ? state.nearbyDays : 14;
      state.nearbyDateField = state.nearbyDateField ?? "";

      // Field suggestions
      const possibleRefFields = guessReferenceFields(ds.rows || []);
      const dateFields = guessDateFields(ds.rows || []);

      const details = document.createElement("details");
      details.open = state.proxOpen !== false;

      const summary = el(
        "summary",
        "filter-dataset-summary",
        `
        <div class="title">${escapeHTML(cfg.name)}</div>
        <div class="meta">Proximity</div>
        `
      );
      details.appendChild(summary);

      summary.addEventListener("click", () => {
        setTimeout(() => (state.proxOpen = details.open), 0);
      });

      const card = el("div", "filter-dataset-card");
      details.appendChild(card);
      root.appendChild(details);

      card.innerHTML = `
        <div class="filter-block">
          <div class="filter-subtitle">Proximity Events</div>

          <div class="filter-row">
            <label>Reference No. of Interest</label>
            <input class="nearby-ref" type="text" placeholder="e.g. 8715 or VR8715" />
          </div>

          <div class="filter-row">
            <label>Radius (metres)</label>
            <input class="nearby-radius" type="number" min="0" step="50" placeholder="e.g. 1000" />
          </div>

          <div class="filter-row">
            <label>Period (± days)</label>
            <input class="nearby-days" type="number" min="0" step="1" placeholder="e.g. 14" />
          </div>

          <div class="filter-row">
            <label>Proximity Date Field</label>
            <select class="nearby-date-field"></select>
          </div>

          <div class="filter-actions">
            <button class="ema-btn primary apply-prox-btn" type="button">Apply Proximity</button>
            <button class="ema-btn ghost clear-prox-btn" type="button">Clear Proximity</button>
            <button class="ema-btn ghost results-prox-btn" type="button">Show Results</button>
          </div>
        </div>
      `;

      const nearbyRefInput = card.querySelector(".nearby-ref");
      const nearbyRadiusInput = card.querySelector(".nearby-radius");
      const nearbyDaysInput = card.querySelector(".nearby-days");
      const nearbyDateFieldSel = card.querySelector(".nearby-date-field");
      const applyBtn = card.querySelector(".apply-prox-btn");
      const clearBtn = card.querySelector(".clear-prox-btn");
      const resultsBtn = card.querySelector(".results-prox-btn");

      nearbyRefInput.value = state.nearbyRef || "";
      nearbyRadiusInput.value = String(state.nearbyRadius ?? 1000);
      nearbyDaysInput.value = String(state.nearbyDays ?? 14);

      nearbyDateFieldSel.innerHTML =
        `<option value="">(select date field)</option>` +
        dateFields.map((f) => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join("");
      nearbyDateFieldSel.value = state.nearbyDateField || "";

      nearbyRefInput.addEventListener("input", () => (state.nearbyRef = nearbyRefInput.value));
      nearbyRadiusInput.addEventListener("input", () => (state.nearbyRadius = Number(nearbyRadiusInput.value || 0)));
      nearbyDaysInput.addEventListener("input", () => (state.nearbyDays = Number(nearbyDaysInput.value || 0)));
      nearbyDateFieldSel.addEventListener("change", () => (state.nearbyDateField = nearbyDateFieldSel.value));

      applyBtn.addEventListener("click", () => {
        const btns = findFiltersPanelButtons(cfg.name);
        if (btns.applyBtn) {
          btns.applyBtn.click();
        } else {
          alert("Filters panel buttons not found. Open the Filters panel once, then try again.");
        }
      });
          
      resultsBtn.addEventListener("click", () => {
        if (window.FiltersPanelAPI && typeof window.FiltersPanelAPI.showResults === "function") {
          window.FiltersPanelAPI.showResults(cfg.id);
          return;
        }
        alert("Results system not available yet.");
      });
      
      clearBtn.addEventListener("click", () => {
        // reset state
        state.nearbyRef = "";
        state.nearbyRadius = 1000;
        state.nearbyDays = 14;
        state.nearbyDateField = "";

        nearbyRefInput.value = "";
        nearbyRadiusInput.value = "1000";
        nearbyDaysInput.value = "14";
        nearbyDateFieldSel.value = "";

        const btns = findFiltersPanelButtons(cfg.name);
        if (btns.clearBtn) {
          btns.clearBtn.click();
        }
      });
    }
  }

  // ----------------------------------------------------
  // Init / rebuild hooks
  // ----------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.AppDataManager) return;

    buildProximityPanel(window.AppDataManager);

    document.addEventListener("appdata:datasetActiveChanged", () => buildProximityPanel(window.AppDataManager));
    document.addEventListener("appdata:datasetLoaded", () => buildProximityPanel(window.AppDataManager));
    document.addEventListener("appdata:datasetReloaded", () => buildProximityPanel(window.AppDataManager));

    console.log("✅ Proximity panel initialized.");
  });
})();
