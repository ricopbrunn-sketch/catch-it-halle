const API_URL = "https://frosty-leaf-0fc9.ricopbrunn.workers.dev";
const AID = "hf7mcf9bv3nv8g5f";

const HALLE = {
  lat: 51.4828,
  lon: 11.9698
};

const REFRESH_MS = 30000;

/*
  Halle wird nicht mehr mit einem einzigen riesigen Radius abgefragt.
  Stattdessen laden wir mehrere Bereiche und führen die Ergebnisse zusammen.
*/
const STOP_AREAS = [
  // Zentrum
  { lat: 51.4828, lon: 11.9698 },

  // Norden / Trotha
  { lat: 51.5150, lon: 11.9650 },

  // Nordwest / Kröllwitz / Heide
  { lat: 51.5050, lon: 11.9100 },

  // Neustadt / Nietleben
  { lat: 51.4800, lon: 11.9150 },

  // Süden / Südstadt
  { lat: 51.4450, lon: 11.9650 },

  // Ammendorf / Beesen
  { lat: 51.4200, lon: 11.9800 },

  // Osten / Büschdorf
  { lat: 51.4800, lon: 12.0250 },

  // Nordost / Frohe Zukunft
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
    zoomControl: true,
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
  $("#locateBtn")?.addEventListener("click", () => {
    map.flyTo(
      [HALLE.lat, HALLE.lon],
      13,
      {
        duration: 0.6
      }
    );
  });


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

      activeFilter = button.dataset.filter || "all";

      renderStops();
    });
  });
}


/* =========================================================
   HAFAS
========================================================= */

async function hafas(svcReqL) {
  const response = await fetch(API_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      ...base,
      svcReqL
    })
  });


  if (!response.ok) {
    const text = await response.text().catch(() => "");

    throw new Error(
      `Worker HTTP ${response.status}${
        text
          ? `: ${text.slice(0, 200)}`
          : ""
      }`
    );
  }


  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Worker hat keine gültige JSON-Antwort geliefert."
    );
  }


  if (!data) {
    throw new Error(
      "Leere Antwort vom Worker."
    );
  }


  if (!Array.isArray(data.svcResL)) {
    console.error(
      "Unerwartete HAFAS-Antwort:",
      data
    );

    throw new Error(
      "Ungültige HAFAS-Antwort."
    );
  }


  const bad = data.svcResL.find(
    item =>
      item?.err &&
      item.err !== "OK"
  );


  if (bad) {
    console.error(
      "HAFAS Fehler:",
      bad
    );

    throw new Error(
      bad.errTxt ||
      bad.err ||
      "HAFAS-Fehler"
    );
  }


  return data;
}


/* =========================================================
   HALTESTELLEN LADEN
========================================================= */

async function loadStops(force = false) {
  setStatus(
    "Haltestellen werden geladen …",
    "loading"
  );


  markerLayer.clearLayers();


  try {
    /*
      Alle Teilbereiche gleichzeitig abfragen.
      Ein einzelner fehlgeschlagener Bereich zerstört nicht mehr alles.
    */

    const requests = STOP_AREAS.map(area =>
      loadStopArea(area)
    );


    const results = await Promise.allSettled(
      requests
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
          "Haltestellen-Bereich fehlgeschlagen:",
          result.reason
        );
      }
    }


    if (!successfulAreas) {
      throw new Error(
        "Keine HAFAS-Haltestellenabfrage war erfolgreich."
      );
    }


    stops = rawStops
      .map(normalizeStop)

      .filter(stop =>
        Number.isFinite(stop.lat) &&
        Number.isFinite(stop.lon)
      )

      /*
        Nur den Bereich Halle behalten.
        Damit verschwinden Haltestellen weit außerhalb der Stadt.
      */
      .filter(stop => {
        const distance = distanceKm(
          HALLE.lat,
          HALLE.lon,
          stop.lat,
          stop.lon
        );

        return distance <= 17;
      });


    /*
      Doppelte Haltestellen entfernen.
    */

    const unique = new Map();


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


    stops = [
      ...unique.values()
    ];


    /*
      Alphabetisch sortieren.
    */

    stops.sort((a, b) =>
      a.name.localeCompare(
        b.name,
        "de"
      )
    );


    console.log(
      `${stops.length} Haltestellen geladen`,
      stops
    );


    renderStops();


    if (!stops.length) {
      setStatus(
        "Keine Haltestellen gefunden",
        "error"
      );

      return;
    }


    setStatus(
      `${stops.length} Haltestellen • Echtzeit bereit`,
      "ok"
    );


  } catch (error) {
    console.error(
      "loadStops fehlgeschlagen:",
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
   EINEN KARTENBEREICH LADEN
========================================================= */

async function loadStopArea(area) {
  const data = await hafas([
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

          maxDist: STOP_AREA_RADIUS
        },

        getPOIs: false,
        getStops: true,

        /*
          Lieber mehrere kleinere Abfragen
          als eine riesige maxLoc-Anforderung.
        */
        maxLoc: 300
      }
    }
  ]);


  const response =
    data?.svcResL?.[0]?.res || {};


  /*
    HAFAS-Versionen liefern Locations
    teilweise unterschiedlich zurück.
  */

  let locations = [];


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
    Array.isArray(
      response?.stopL
    )
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


  /*
    HAFAS liefert normalerweise Mikrograd.
    Falls bereits normale Koordinaten kommen,
    nicht erneut teilen.
  */

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


  const bits =
    stop.pCls ??
    stop.prodClass ??
    stop.products ??
    0;


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

    extId:
      String(
        stop.extId ||
        stop.extIdStr ||
        stop.id ||
        ""
      ),

    lid:
      stop.lid ||
      "",

    lat,
    lon,

    products:
      productsFromBits(bits),

    raw:
      stop
  };
}


/* =========================================================
   VERKEHRSMITTEL DER HALTESTELLE
========================================================= */

function productsFromBits(bits) {
  const n =
    Number(bits) || 0;


  /*
    Produktklassen unterscheiden sich je HAFAS-Profil.
    Deshalb unbekannte Haltestellen nicht verstecken.
  */

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


      /*
        Unbekannte Produktklasse anzeigen.
        Sonst würden gültige Haltestellen verschwinden.
      */
      if (
        stop.products === "unknown"
      ) {
        return true;
      }


      return (
        stop.products === activeFilter
      );
    });


  for (
    const stop of visible
  ) {

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

        iconSize:
          [17, 17],

        iconAnchor:
          [8, 8]
      });


    L.marker(
      [
        stop.lat,
        stop.lon
      ],
      {
        icon
      }
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

      .addTo(
        markerLayer
      );
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
    box.classList.add(
      "hidden"
    );

    box.innerHTML = "";

    return;
  }


  const found =
    stops

      .filter(stop => {
        const haystack =
          normalizeName(
            `${stop.name} ${stop.place}`
          );

        return haystack.includes(
          term
        );
      })

      .slice(
        0,
        20
      );


  if (
    found.length
  ) {

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

  } else {

    box.innerHTML =
      `
        <div class="empty-note">
          Keine Haltestelle gefunden.
        </div>
      `;
  }


  box.classList.remove(
    "hidden"
  );


  box
    .querySelectorAll(
      ".search-item"
    )
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
              [
                stop.lat,
                stop.lon
              ],
              16,
              {
                duration: 0.5
              }
            );


            selectStop(
              stop
            );
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
    .add(
      "hidden"
    );


  $("#panelContent")
    ?.classList
    .remove(
      "hidden"
    );


  const stopName =
    $("#stopName");


  if (stopName) {
    stopName.textContent =
      stop.name;
  }


  $("#panel")
    ?.classList
    .add(
      "open"
    );


  routeLayer.clearLayers();


  await loadDepartures(
    stop,
    true
  );
}


/* =========================================================
   PANEL SCHLIESSEN
========================================================= */

function closePanel() {
  $("#panel")
    ?.classList
    .remove(
      "open"
    );
}


/* =========================================================
   ABFAHRTEN LADEN
========================================================= */

async function loadDepartures(
  stop,
  showLoading = true
) {

  const departuresBox =
    $("#departures");


  if (
    showLoading &&
    departuresBox
  ) {
    departuresBox.innerHTML =
      `
        <div class="empty-note">
          Live-Abfahrten werden geladen …
        </div>
      `;
  }


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


  /*
    lid ist bei HAFAS meist zuverlässiger als extId.
  */

  let stbLoc;


  if (
    stop.lid
  ) {

    stbLoc = {
      type: "S",
      lid: stop.lid
    };

  } else if (
    stop.extId
  ) {

    stbLoc = {
      type: "S",
      extId: stop.extId
    };

  } else {

    stbLoc = {
      type: "S",
      name: stop.name
    };

  }


  try {

    const data =
      await hafas([
        {
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
        }
      ]);


    const response =
      data?.svcResL?.[0]?.res || {};


    const journeys =
      response.jnyL || [];


    renderDepartures(
      journeys,
      response
    );


    setStatus(
      `${stops.length} Haltestellen • zuletzt ${clock(new Date())}`,
      "ok"
    );


  } catch (error) {

    console.error(
      "StationBoard fehlgeschlagen:",
      error
    );


    if (
      departuresBox
    ) {

      departuresBox.innerHTML =
        `
          <div class="empty-note">

            Live-Abfahrten konnten gerade nicht geladen werden.

            <br>

            <small>
              ${escapeHtml(error.message)}
            </small>

          </div>
        `;
    }


    setStatus(
      `Echtzeit-Fehler: ${error.message}`,
      "error"
    );
  }
}


/* =========================================================
   ABFAHRTEN ANZEIGEN
========================================================= */

function renderDepartures(
  journeys,
  response
) {

  const departures =
    $("#departures");


  if (!departures) {
    return;
  }


  if (
    !journeys.length
  ) {

    departures.innerHTML =
      `
        <div class="empty-note">
          Keine Abfahrten gefunden.
        </div>
      `;

    return;
  }


  const rows =
    journeys
      .slice(
        0,
        25
      )
      .map(
        journey => {

          const product =
            resolveProduct(
              journey,
              response
            );


          const line =
            product.line ||
            product.name ||
            journey.name ||
            "?";


          const direction =
            journey.dirTxt ||
            journey.direction ||
            "Richtung unbekannt";


          const stop =
            journey.stbStop ||
            journey.stop ||
            {};


          const planned =
            parseHafasTime(
              stop.dTimeS ||
              stop.aTimeS ||
              journey.dTimeS
            );


          const realtime =
            parseHafasTime(
              stop.dTimeR ||
              stop.aTimeR ||
              journey.dTimeR
            ) ||
            planned;


          const delay =
            planned &&
            realtime

              ? Math.round(
                  (
                    realtime -
                    planned
                  ) /
                  60000
                )

              : null;


          const mode =
            productMode(
              product,
              line
            );


          let delayHtml =
            "";


          if (
            delay !== null
          ) {

            if (
              delay <= 0
            ) {

              delayHtml =
                `
                  <small>
                    pünktlich
                  </small>
                `;

            } else {

              delayHtml =
                `
                  <small class="${delay > 2 ? "late" : ""}">
                    +${delay} min
                  </small>
                `;
            }
          }


          return `
            <div
              class="dep"
              data-jid="${escapeAttr(
                journey.jid ||
                ""
              )}"
            >

              <div
                class="line-badge ${mode}"
              >
                ${escapeHtml(
                  shortLine(line)
                )}
              </div>


              <div class="dep-main">

                <div class="dep-dir">
                  ${escapeHtml(
                    direction
                  )}
                </div>

                <div class="dep-meta">

                  ${
                    mode === "tram"
                      ? "Straßenbahn"
                      : mode === "bus"
                      ? "Bus"
                      : escapeHtml(
                          product.name ||
                          "ÖPNV"
                        )
                  }

                </div>

              </div>


              <div class="dep-time">

                ${
                  realtime
                    ? clock(realtime)
                    : "–"
                }

                ${delayHtml}

              </div>

            </div>
          `;
        }
      )
      .join("");


  departures.innerHTML =
    rows;
}


/* =========================================================
   PRODUKT AUFLÖSEN
========================================================= */

function resolveProduct(
  journey,
  response
) {

  if (
    journey.prodL?.length
  ) {
    return journey.prodL[0];
  }


  const common =
    response?.common || {};


  const products =
    common.prodL || [];


  const index =
    journey.prodX ??
    journey.prodIdx;


  if (
    Number.isInteger(index) &&
    products[index]
  ) {
    return products[index];
  }


  return {
    name:
      journey.prodName ||
      journey.name ||
      "",

    line:
      journey.line ||
      journey.prodName ||
      journey.name ||
      ""
  };
}


/* =========================================================
   BUS / TRAM
========================================================= */

function productMode(
  product,
  line
) {

  const text =
    `
      ${product?.name || ""}
      ${product?.catOut || ""}
      ${product?.catCode || ""}
      ${line || ""}
    `.toLowerCase();


  if (
    /tram|straßenbahn|str\b/.test(
      text
    )
  ) {
    return "tram";
  }


  if (
    /bus/.test(
      text
    )
  ) {
    return "bus";
  }


  /*
    typische HAVAG Straßenbahnlinien
  */

  if (
    /^\s*(1|2|3|4|5|7|8|9|10|12|16|95)\s*$/.test(
      String(line)
    )
  ) {
    return "tram";
  }


  return "bus";
}


/* =========================================================
   LINIENNUMMER
========================================================= */

function shortLine(value) {
  return String(
    value ||
    "?"
  )

    .replace(
      /^(tram|str|bus)\s*/i,
      ""
    )

    .trim()

    .slice(
      0,
      6
    );
}


/* =========================================================
   HAFAS-ZEIT
========================================================= */

function parseHafasTime(value) {
  if (!value) {
    return null;
  }


  const text =
    String(value)
      .replace(
        /\D/g,
        ""
      );


  if (
    text.length < 4
  ) {
    return null;
  }


  /*
    Letzte sechs Stellen:
    HHMMSS
  */

  const time =
    text
      .slice(-6)
      .padStart(
        6,
        "0"
      );


  const hour =
    Number(
      time.slice(
        0,
        2
      )
    );


  const minute =
    Number(
      time.slice(
        2,
        4
      )
    );


  const second =
    Number(
      time.slice(
        4,
        6
      )
    );


  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }


  const date =
    new Date();


  date.setHours(
    hour % 24,
    minute,
    second || 0,
    0
  );


  return date;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  text,
  mode
) {

  const status =
    $("#mapStatus");


  if (status) {
    status.textContent =
      text;
  }


  const dot =
    $("#statusDot");


  if (!dot) {
    return;
  }


  dot.className =
    "status-dot";


  if (
    mode === "loading"
  ) {
    dot.classList.add(
      "loading"
    );
  }


  if (
    mode === "error"
  ) {
    dot.classList.add(
      "error"
    );
  }
}


/* =========================================================
   UHRZEIT
========================================================= */

function clock(date) {
  return new Intl.DateTimeFormat(
    "de-DE",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


/* =========================================================
   HILFSFUNKTIONEN
========================================================= */

function pad(value) {
  return String(value)
    .padStart(
      2,
      "0"
    );
}


function normalizeName(value) {
  return String(
    value ||
    ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /ß/g,
      "ss"
    )
    .trim();
}


function distanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R =
    6371;


  const p1 =
    lat1 *
    Math.PI /
    180;


  const p2 =
    lat2 *
    Math.PI /
    180;


  const dp =
    (
      lat2 -
      lat1
    ) *
    Math.PI /
    180;


  const dl =
    (
      lon2 -
      lon1
    ) *
    Math.PI /
    180;


  const a =
    Math.sin(
      dp / 2
    ) ** 2 +

    Math.cos(p1) *
    Math.cos(p2) *

    Math.sin(
      dl / 2
    ) ** 2;


  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}


function escapeHtml(value) {
  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function escapeAttr(value) {
  return escapeHtml(value);
    }
