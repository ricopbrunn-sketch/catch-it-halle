const API_URL = "https://frosty-leaf-0fc9.ricopbrunn.workers.dev";
const AID = "hf7mcf9bv3nv8g5f";

const HALLE = { lat: 51.4828, lon: 11.9698 };
const STOP_RADIUS_METERS = 18000;
const REFRESH_MS = 30000;

const base = {
  ver: "1.81",
  lang: "deu",
  formatted: false,
  auth: { type: "AID", aid: AID },
  client: { id: "NASA", v: 1000102, type: "WEB", name: "webapp" }
};

let map;
let markerLayer;
let routeLayer;
let stops = [];
let activeStop = null;
let refreshTimer = null;
let activeFilter = "all";

const $ = s => document.querySelector(s);

init();

async function init() {
  initMap();
  bindUI();
  await loadStops();
  refreshTimer = setInterval(() => {
    if (activeStop) loadDepartures(activeStop, false);
  }, REFRESH_MS);
}

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  }).setView([HALLE.lat, HALLE.lon], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function bindUI() {
  $("#locateBtn").addEventListener("click", () => {
    map.flyTo([HALLE.lat, HALLE.lon], 13, { duration: .6 });
  });

  $("#refreshBtn").addEventListener("click", async () => {
    if (activeStop) await loadDepartures(activeStop, true);
    else await loadStops(true);
  });

  $("#closePanel").addEventListener("click", closePanel);

  $("#stopSearch").addEventListener("input", e => renderSearch(e.target.value));

  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrap")) $("#searchResults").classList.add("hidden");
  });

  document.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderStops();
    });
  });
}

async function hafas(svcReqL) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, svcReqL })
  });

  if (!r.ok) throw new Error(`Worker: HTTP ${r.status}`);

  const data = await r.json();

  if (data?.svcResL?.some(x => x.err && x.err !== "OK")) {
    const bad = data.svcResL.find(x => x.err && x.err !== "OK");
    throw new Error(bad.errTxt || bad.err || "HAFAS-Fehler");
  }

  return data;
}

async function loadStops(force = false) {
  setStatus("Haltestellen werden geladen …", "loading");

  try {
    const data = await hafas([{
      meth: "LocGeoPos",
      req: {
        ring: {
          cCrd: {
            x: Math.round(HALLE.lon * 1e6),
            y: Math.round(HALLE.lat * 1e6)
          },
          maxDist: STOP_RADIUS_METERS
        },
        getPOIs: false,
        getStops: true,
        maxLoc: 1000
      }
    }]);

    const res = data?.svcResL?.[0]?.res || {};
    const raw = res.locL || res.match?.locL || [];

    stops = raw
      .map(normalizeStop)
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .filter(s => /halle|saale|lettin|trotha|neustadt|ammendorf|beesen|reideburg|nietleben|büschdorf|kröllwitz|diemitz|dölau/i.test(
        `${s.name} ${s.place || ""}`
      ) || distanceKm(HALLE.lat, HALLE.lon, s.lat, s.lon) < 14);

    // Doppelte Einträge derselben Haltestelle entfernen.
    const seen = new Set();
    stops = stops.filter(s => {
      const key = s.extId || `${s.name}|${s.lat.toFixed(5)}|${s.lon.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    renderStops();
    setStatus(`${stops.length} Haltestellen • Echtzeit bereit`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(`Haltestellen konnten nicht geladen werden`, "error");
  }
}

function normalizeStop(s) {
  const crd = s.crd || s.coord || {};
  const products = productsFromBits(s.pCls ?? s.prodClass ?? 0);

  return {
    name: s.name || s.disp || "Haltestelle",
    place: s.place || s.city || "",
    extId: s.extId || s.extIdStr || s.id || "",
    lid: s.lid || "",
    lat: Number(crd.y) / 1e6,
    lon: Number(crd.x) / 1e6,
    products,
    raw: s
  };
}

function productsFromBits(bits) {
  // HAFAS-Produktklassen unterscheiden sich je Profil. Die Klassifizierung
  // wird nur für die Kartenfilter genutzt; "all" zeigt immer alles.
  const n = Number(bits) || 0;
  const hasTram = Boolean(n & 16) || Boolean(n & 32);
  const hasBus = Boolean(n & 64) || Boolean(n & 128) || Boolean(n & 256);
  if (hasTram && hasBus) return "both";
  if (hasTram) return "tram";
  if (hasBus) return "bus";
  return "unknown";
}

function renderStops() {
  markerLayer.clearLayers();

  const visible = stops.filter(s => {
    if (activeFilter === "all") return true;
    return s.products === activeFilter || s.products === "both" || s.products === "unknown";
  });

  for (const stop of visible) {
    const cls = stop.products === "unknown" ? "bus" : stop.products;
    const icon = L.divIcon({
      className: "",
      html: `<div class="stop-marker ${cls}"></div>`,
      iconSize: [17, 17],
      iconAnchor: [8, 8]
    });

    L.marker([stop.lat, stop.lon], { icon })
      .on("click", () => selectStop(stop))
      .addTo(markerLayer);
  }
}

function renderSearch(q) {
  const box = $("#searchResults");
  const term = q.trim().toLowerCase();

  if (term.length < 2) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const found = stops
    .filter(s => `${s.name} ${s.place}`.toLowerCase().includes(term))
    .slice(0, 12);

  box.innerHTML = found.length
    ? found.map((s, i) => `
        <button class="search-item" data-i="${i}">
          ${escapeHtml(s.name)}
          <small>${escapeHtml(s.place || "Halle (Saale)")}</small>
        </button>`).join("")
    : `<div class="empty-note">Keine Haltestelle gefunden.</div>`;

  box.classList.remove("hidden");

  box.querySelectorAll(".search-item").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const stop = found[i];
      $("#stopSearch").value = stop.name;
      box.classList.add("hidden");
      map.flyTo([stop.lat, stop.lon], 16, { duration: .5 });
      selectStop(stop);
    });
  });
}

async function selectStop(stop) {
  activeStop = stop;
  $("#panelEmpty").classList.add("hidden");
  $("#panelContent").classList.remove("hidden");
  $("#stopName").textContent = stop.name;
  $("#panel").classList.add("open");
  routeLayer.clearLayers();
  await loadDepartures(stop, true);
}

function closePanel() {
  $("#panel").classList.remove("open");
}

async function loadDepartures(stop, showLoading = true) {
  if (showLoading) {
    $("#departures").innerHTML = `<div class="empty-note">Live-Abfahrten werden geladen …</div>`;
  }

  const now = new Date();
  const date = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}00`;

  const stbLoc = stop.lid
    ? { type: "S", lid: stop.lid }
    : { type: "S", extId: stop.extId, name: stop.name };

  try {
    const data = await hafas([{
      meth: "StationBoard",
      req: {
        type: "DEP",
        stbLoc,
        date,
        time,
        maxJny: 40,
        getPasslist: true,
        getPolyline: false
      }
    }]);

    const res = data?.svcResL?.[0]?.res || {};
    const journeys = res.jnyL || [];
    renderDepartures(journeys, res);
    setStatus(`${stops.length} Haltestellen • zuletzt ${clock(new Date())}`, "ok");
  } catch (err) {
    console.error(err);
    $("#departures").innerHTML = `
      <div class="empty-note">
        Live-Abfahrten konnten gerade nicht geladen werden.<br>
        <small>${escapeHtml(err.message)}</small>
      </div>`;
    setStatus("Echtzeit-Abfrage fehlgeschlagen", "error");
  }
}

function renderDepartures(journeys, res) {
  if (!journeys.length) {
    $("#departures").innerHTML = `<div class="empty-note">Keine Abfahrten gefunden.</div>`;
    return;
  }

  const rows = journeys.slice(0, 25).map(j => {
    const prod = resolveProduct(j, res);
    const line = prod.line || prod.name || j.name || "?";
    const dir = j.dirTxt || j.direction || "Richtung unbekannt";

    const st = j.stbStop || j.stop || {};
    const planned = parseHafasTime(st.dTimeS || st.aTimeS || j.dTimeS);
    const realtime = parseHafasTime(st.dTimeR || st.aTimeR || j.dTimeR) || planned;

    const delay = planned && realtime
      ? Math.round((realtime - planned) / 60000)
      : null;

    const mode = productMode(prod, line);

    return `
      <div class="dep" data-jid="${escapeAttr(j.jid || "")}">
        <div class="line-badge ${mode}">${escapeHtml(shortLine(line))}</div>
        <div class="dep-main">
          <div class="dep-dir">${escapeHtml(dir)}</div>
          <div class="dep-meta">${mode === "tram" ? "Straßenbahn" : mode === "bus" ? "Bus" : escapeHtml(prod.name || "ÖPNV")}</div>
        </div>
        <div class="dep-time">
          ${realtime ? clock(realtime) : "–"}
          ${delay == null ? "" : `<small class="${delay > 2 ? "late" : ""}">${delay <= 0 ? "pünktlich" : `+${delay} min`}</small>`}
        </div>
      </div>`;
  }).join("");

  $("#departures").innerHTML = rows;
}

function resolveProduct(j, res) {
  if (j.prodL?.length) return j.prodL[0];

  const common = res?.common || {};
  const prodL = common.prodL || [];
  const idx = j.prodX ?? j.prodIdx;
  if (Number.isInteger(idx) && prodL[idx]) return prodL[idx];

  return {
    name: j.prodName || j.name || "",
    line: j.line || j.prodName || j.name || ""
  };
}

function productMode(prod, line) {
  const s = `${prod?.name || ""} ${prod?.catOut || ""} ${prod?.catCode || ""} ${line || ""}`.toLowerCase();
  if (/tram|straßenbahn|str\b/.test(s)) return "tram";
  if (/bus/.test(s)) return "bus";
  // HAVAG-Straßenbahnlinien sind in Halle meist kurze reine Nummern.
  if (/^\s*(1|2|3|4|5|7|8|9|10|12|16|95)\s*$/.test(String(line))) return "tram";
  return "bus";
}

function shortLine(s) {
  return String(s || "?")
    .replace(/^(tram|str|bus)\s*/i, "")
    .trim()
    .slice(0, 6);
}

function parseHafasTime(v) {
  if (!v) return null;
  const s = String(v).replace(/\D/g, "");
  if (s.length < 4) return null;

  // HAFAS kann Tagesoffsets vor der Uhrzeit kodieren. Für die Anzeige reicht
  // die rechte HHMMSS-Gruppe.
  const t = s.slice(-6).padStart(6, "0");
  const hRaw = Number(t.slice(0,2));
  const m = Number(t.slice(2,4));
  const sec = Number(t.slice(4,6));
  if (!Number.isFinite(hRaw) || !Number.isFinite(m)) return null;

  const d = new Date();
  d.setHours(hRaw % 24, m, sec || 0, 0);
  return d;
}

function setStatus(text, mode) {
  $("#mapStatus").textContent = text;
  const dot = $("#statusDot");
  dot.className = "status-dot";
  if (mode === "loading") dot.classList.add("loading");
  if (mode === "error") dot.classList.add("error");
}

function clock(d) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2-lat1) * Math.PI / 180;
  const dl = (lon2-lon1) * Math.PI / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeAttr(v) {
  return escapeHtml(v);
}
