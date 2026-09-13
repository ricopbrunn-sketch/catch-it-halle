const API_URL = "https://frosty-leaf-0fc9.ricopbrunn.workers.dev";
const AID = "hf7mcf9bv3nv8g5f";

const HALLE = {
  lat: 51.4828,
  lon: 11.9698
};

const REFRESH_MS = 30000;

const STOP_AREAS = [
  { lat: 51.4828, lon: 11.9698 },
  { lat: 51.5150, lon: 11.9650 },
  { lat: 51.5050, lon: 11.9100 },
  { lat: 51.4800, lon: 11.9150 },
  { lat: 51.4450, lon: 11.9650 },
  { lat: 51.4200, lon: 11.9800 },
  { lat: 51.4800, lon: 12.0250 },
  { lat: 51.5150, lon: 12.0150 }
];

const STOP_AREA_RADIUS = 6500;

const base = {
  ver: "1.81",
  lang: "deu",
  formatted: false,

  auth: {
    type: "AID",
    aid: AID
  },

  client: {
    id: "NASA",
    v: 1000102,
    type: "WEB",
    name: "webapp"
  }
};


/* =========================================================
   STATUS
========================================================= */

let map;
let markerLayer;
let routeLayer;

let stops = [];
let activeStop = null;
let refreshTimer = null;
let activeFilter = "all";

const $ = selector => document.querySelector(selector);


/* =========================================================
   START
========================================================= */

init();

async function init() {
  initMap();
  bindUI();

  await loadStops();

  refreshTimer = setInterval(() => {
    if (activeStop) {
      loadDepartures(activeStop, false);
    }
  }, REFRESH_MS);
}


/* =========================================================
   KARTE
========================================================= */

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true
  }).setView(
    [HALLE.lat, HALLE.lon],
    13
  );

  L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }
  ).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}


/* =========================================================
   BEDIENUNG
========================================================= */

function bindUI() {
  $("#locateBtn")?.addEventListener("click", locateUser);

  $("#refreshBtn")?.addEventListener("click", async () => {
    if (activeStop) {
      await loadDepartures(activeStop, true);
    } else {
      await loadStops(true);
    }
  });

  $("#closePanel")?.addEventListener("click", closePanel);

  $("#stopSearch")?.addEventListener("input", event => {
    renderSearch(event.target.value);
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".search-wrap")) {
      $("#searchResults")?.classList.add("hidden");
    }
  });

  document.querySelectorAll(".chip").forEach(button => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".chip")
        .forEach(btn => btn.classList.remove("active"));

      button.classList.add("active");

      activeFilter =
        button.dataset.filter || "all";

      renderStops();
    });
  });
}


/* =========================================================
   POSITION
========================================================= */

function locateUser() {
  if (!navigator.geolocation) {
    map.flyTo(
      [HALLE.lat, HALLE.lon],
      13,
      { duration: 0.6 }
    );

    return;
  }

  setStatus(
    "Standort wird bestimmt …",
    "loading"
  );

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat =
        position.coords.latitude;

      const lon =
        position.coords.longitude;

      map.flyTo(
        [lat, lon],
        16,
        { duration: 0.7 }
      );

      setStatus(
        `${stops.length} Haltestellen • Echtzeit bereit`,
        "ok"
      );
    },

    () => {
      map.flyTo(
        [HALLE.lat, HALLE.lon],
        13,
        { duration: 0.6 }
      );

      setStatus(
        `${stops.length} Haltestellen • Standort nicht verfügbar`,
        "ok"
      );
    },

    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000
    }
  );
}


/* =========================================================
   HAFAS
========================================================= */

async function hafas(svcReqL) {
  const response = await fetch(
    API_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        ...base,
        svcReqL
      })
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    let message =
      `Worker HTTP ${response.status}`;

    try {
      const errorData =
        JSON.parse(text);

      message =
        errorData.message ||
        errorData.error ||
        message;
    } catch {
      if (text) {
        message +=
          `: ${text.slice(0, 250)}`;
      }
    }

    throw new Error(message);
  }

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      "INSA lieferte kein gültiges JSON."
    );
  }

  /*
    HAFAS kann Fehler entweder oben in der Antwort
    ODER innerhalb von svcResL melden.
  */

  if (
    data?.err &&
    data.err !== "OK"
  ) {
    console.error(
      "HAFAS Hauptfehler:",
      data
    );

    throw new Error(
      data.errTxt ||
      data.err ||
      "HAFAS-Anfrage fehlgeschlagen."
    );
  }

  if (!Array.isArray(data?.svcResL)) {
    console.error(
      "Unerwartete HAFAS-Antwort:",
      data
    );

    throw new Error(
      data?.errTxt ||
      data?.err ||
      "INSA lieferte keine gültige HAFAS-Antwort."
    );
  }

  const bad =
    data.svcResL.find(item =>
      item?.err &&
      item.err !== "OK"
    );

  if (bad) {
    console.error(
      "HAFAS Servicefehler:",
      bad
    );

    throw new Error(
      bad.errTxt ||
      bad.err ||
      "HAFAS-Servicefehler."
    );
  }

  return data;
}


/* =========================================================
   HALTESTELLEN
========================================================= */

async function loadStops(force = false) {
  setStatus(
    "Haltestellen werden geladen …",
    "loading"
  );

  markerLayer.clearLayers();

  try {
    const results =
      await Promise.allSettled(
        STOP_AREAS.map(area =>
          loadStopArea(area)
        )
      );

    let rawStops = [];
    let successfulAreas = 0;

    for (const result of results) {
      if (
        result.status === "fulfilled"
      ) {
        successfulAreas++;

        rawStops.push(
          ...result.value
        );
      } else {
        console.warn(
          "Teilbereich fehlgeschlagen:",
          result.reason
        );
      }
    }

    if (!successfulAreas) {
      throw new Error(
        "Keine HAFAS-Haltestellenabfrage war erfolgreich."
      );
    }

    stops =
      rawStops
        .map(normalizeStop)

        .filter(stop =>
          Number.isFinite(stop.lat) &&
          Number.isFinite(stop.lon)
        )

        .filter(stop =>
          distanceKm(
            HALLE.lat,
            HALLE.lon,
            stop.lat,
            stop.lon
          ) <= 17
        );

    /*
      Duplikate entfernen
    */

    const unique =
      new Map();

    for (const stop of stops) {
      const key =
        stop.extId ||
        stop.lid ||
        `${normalizeName(stop.name)}|${stop.lat.toFixed(5)}|${stop.lon.toFixed(5)}`;

      if (!unique.has(key)) {
        unique.set(
          key,
          stop
        );
      }
    }

    stops =
      [...unique.values()];

    stops.sort((a, b) =>
      a.name.localeCompare(
        b.name,
        "de"
      )
    );

    console.log(
      "Haltestellen:",
      stops
    );

    renderStops();

    setStatus(
      `${stops.length} Haltestellen • Echtzeit bereit`,
      "ok"
    );

  } catch (error) {
    console.error(
      "Haltestellenfehler:",
      error
    );

    stops = [];

    renderStops();

    setStatus(
      `Fehler: ${error.message}`,
      "error"
    );
  }
}


/* =========================================================
   HALTESTELLENBEREICH
========================================================= */

async function loadStopArea(area) {
  const data =
    await hafas([
      {
        meth: "LocGeoPos",

        req: {
          ring: {
            cCrd: {
              x: Math.round(
                area.lon * 1e6
              ),

              y: Math.round(
                area.lat * 1e6
              )
            },

            maxDist:
              STOP_AREA_RADIUS
          },

          getPOIs: false,
          getStops: true,

          maxLoc: 300
        }
      }
    ]);

  const response =
    data?.svcResL?.[0]?.res || {};

  const locations = [];

  if (
    Array.isArray(response.locL)
  ) {
    locations.push(
      ...response.locL
    );
  }

  if (
    Array.isArray(
      response?.match?.locL
    )
  ) {
    locations.push(
      ...response.match.locL
    );
  }

  if (
    Array.isArray(response.stopL)
  ) {
    locations.push(
      ...response.stopL
    );
  }

  return locations;
}


/* =========================================================
   HALTESTELLE NORMALISIEREN
========================================================= */

function normalizeStop(stop) {
  const crd =
    stop?.crd ||
    stop?.coord ||
    {};

  let lat =
    Number(crd.y);

  let lon =
    Number(crd.x);

  if (
    Math.abs(lat) > 90
  ) {
    lat /= 1e6;
  }

  if (
    Math.abs(lon) > 180
  ) {
    lon /= 1e6;
  }

  /*
    WICHTIG:
    stop.id wird NICHT mehr als extId verwendet.

    id und extId sind bei HAFAS nicht dasselbe.
  */

  const extId =
    stop.extId != null
      ? String(stop.extId)
      : stop.extIdStr != null
      ? String(stop.extIdStr)
      : "";

  const lid =
    stop.lid
      ? String(stop.lid)
      : "";

  return {
    name:
      stop.name ||
      stop.disp ||
      stop.nameR ||
      "Haltestelle",

    place:
      stop.place ||
      stop.city ||
      stop.locality ||
      "Halle (Saale)",

    extId,
    lid,

    hafasId:
      stop.id != null
        ? String(stop.id)
        : "",

    lat,
    lon,

    products:
      productsFromBits(
        stop.pCls ??
        stop.prodClass ??
        0
      ),

    raw:
      stop
  };
}


/* =========================================================
   PRODUKTKLASSEN
========================================================= */

function productsFromBits(bits) {
  const n =
    Number(bits) || 0;

  const tram =
    Boolean(n & 16) ||
    Boolean(n & 32);

  const bus =
    Boolean(n & 64) ||
    Boolean(n & 128) ||
    Boolean(n & 256);

  if (
    tram &&
    bus
  ) {
    return "both";
  }

  if (tram) {
    return "tram";
  }

  if (bus) {
    return "bus";
  }

  return "unknown";
}


/* =========================================================
   MARKER
========================================================= */

function renderStops() {
  markerLayer.clearLayers();

  const visible =
    stops.filter(stop => {
      if (
        activeFilter === "all"
      ) {
        return true;
      }

      if (
        stop.products === "both"
      ) {
        return true;
      }

      if (
        stop.products === "unknown"
      ) {
        return true;
      }

      return (
        stop.products === activeFilter
      );
    });

  for (const stop of visible) {
    let markerClass =
      stop.products;

    if (
      markerClass === "unknown"
    ) {
      markerClass = "bus";
    }

    const icon =
      L.divIcon({
        className: "",

        html:
          `<div class="stop-marker ${markerClass}"></div>`,

        iconSize: [17, 17],
        iconAnchor: [8, 8]
      });

    L.marker(
      [stop.lat, stop.lon],
      { icon }
    )

      .bindTooltip(
        escapeHtml(stop.name),
        {
          direction: "top",
          offset: [0, -8]
        }
      )

      .on(
        "click",
        () => selectStop(stop)
      )

      .addTo(markerLayer);
  }
}


/* =========================================================
   SUCHE
========================================================= */

function renderSearch(query) {
  const box =
    $("#searchResults");

  if (!box) {
    return;
  }

  const term =
    normalizeName(query);

  if (
    term.length < 2
  ) {
    box.classList.add("hidden");
    box.innerHTML = "";

    return;
  }

  const found =
    stops
      .filter(stop => {
        const text =
          normalizeName(
            `${stop.name} ${stop.place}`
          );

        return text.includes(term);
      })

      .slice(0, 20);

  if (!found.length) {
    box.innerHTML =
      `
      <div class="empty-note">
        Keine Haltestelle gefunden.
      </div>
      `;

    box.classList.remove("hidden");

    return;
  }

  box.innerHTML =
    found
      .map(
        (stop, index) => `
          <button
            class="search-item"
            data-i="${index}"
          >
            ${escapeHtml(stop.name)}

            <small>
              ${escapeHtml(
                stop.place ||
                "Halle (Saale)"
              )}
            </small>
          </button>
        `
      )
      .join("");

  box.classList.remove("hidden");

  box
    .querySelectorAll(".search-item")
    .forEach(
      (button, index) => {
        button.addEventListener(
          "click",
          () => {
            const stop =
              found[index];

            $("#stopSearch").value =
              stop.name;

            box.classList.add(
              "hidden"
            );

            map.flyTo(
              [stop.lat, stop.lon],
              16,
              { duration: 0.5 }
            );

            selectStop(stop);
          }
        );
      }
    );
}


/* =========================================================
   HALTESTELLE AUSWÄHLEN
========================================================= */

async function selectStop(stop) {
  activeStop =
    stop;

  $("#panelEmpty")
    ?.classList
    .add("hidden");

  $("#panelContent")
    ?.classList
    .remove("hidden");

  const stopName =
    $("#stopName");

  if (stopName) {
    stopName.textContent =
      stop.name;
  }

  $("#panel")
    ?.classList
    .add("open");

  routeLayer.clearLayers();

  console.log(
    "Ausgewählte Haltestelle:",
    {
      name: stop.name,
      extId: stop.extId,
      lid: stop.lid,
      hafasId: stop.hafasId,
      raw: stop.raw
    }
  );

  await loadDepartures(
    stop,
    true
  );
}


/* =========================================================
   PANEL
========================================================= */

function closePanel() {
  $("#panel")
    ?.classList
    .remove("open");
}


/* =========================================================
   STATIONBOARD REQUEST
========================================================= */

async function requestStationBoard(
  stop,
  stbLoc
) {
  const now =
    new Date();

  const date =
    `${now.getFullYear()}${pad(
      now.getMonth() + 1
    )}${pad(
      now.getDate()
    )}`;

  const time =
    `${pad(
      now.getHours()
    )}${pad(
      now.getMinutes()
    )}00`;

  console.log(
    "StationBoard mit
