const AID = "hf7mcf9bv3nv8g5f";
const API_URL = "https://frosty-leaf-0fc9.ricopbrunn.workers.dev";

const REFRESH_INTERVAL = 30000;
const SEARCH_DELAY = 350;
const MAX_SEARCH_RESULTS = 50;

let currentStop = null;
let searchTimer = null;
let refreshTimer = null;
let deferredPrompt = null;
let currentSearchId = 0;

let favorites = readJSON("catchit-favorites", []);
let lastStop = readJSON("catchit-last-stop", null);

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
   HILFSFUNKTIONEN
========================================================= */

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);

    return value
      ? JSON.parse(value)
      : fallback;

  } catch {
    return fallback;
  }
}


function saveJSON(key, value) {
  localStorage.setItem(
    key,
    JSON.stringify(value)
  );
}


function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


function uniqueBy(array, keyFunction) {
  const map = new Map();

  for (const item of array) {
    const key = keyFunction(item);

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}


/* =========================================================
   INSA / HAFAS
========================================================= */

async function hafas(svcReqL) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      12000
    );

  try {

    const response =
      await fetch(API_URL, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          ...base,
          svcReqL
        }),

        signal: controller.signal
      });


    if (!response.ok) {
      throw new Error(
        "Serverfehler " +
        response.status
      );
    }


    const data =
      await response.json();


    if (
      data.err &&
      data.err !== "OK"
    ) {
      throw new Error(
        data.errTxt ||
        data.err
      );
    }


    if (
      !Array.isArray(data.svcResL) ||
      !data.svcResL.length
    ) {
      throw new Error(
        "Keine gültige INSA-Antwort"
      );
    }


    return data;

  } catch (error) {

    if (
      error.name === "AbortError"
    ) {
      throw new Error(
        "INSA antwortet momentan zu langsam."
      );
    }

    throw error;

  } finally {

    clearTimeout(timeout);
  }
}


/* =========================================================
   HALTESTELLEN
========================================================= */

function isHalleStop(item) {
  const name =
    normalizeText(item.name);

  return (
    name.includes("halle (saale)") ||
    name.includes("halle-saale") ||
    name.startsWith("halle,") ||
    name.startsWith("halle ")
  );
}


async function locMatch(searchText) {
  const data =
    await hafas([
      {
        meth: "LocMatch",

        req: {
          input: {

            loc: {
              type: "S",
              name: searchText
            },

            field: "S",

            maxLoc:
              MAX_SEARCH_RESULTS
          }
        }
      }
    ]);


  const service =
    data.svcResL[0];


  if (
    service.err &&
    service.err !== "OK"
  ) {
    throw new Error(
      service.errTxt ||
      service.err
    );
  }


  return (
    service.res?.match?.locL ||
    []
  );
}


async function findStops(query) {
  query = query.trim();

  if (query.length < 2) {
    return [];
  }


  /*
    Erst gezielt Halle durchsuchen.
  */

  const halleQuery =
    normalizeText(query)
      .includes("halle")
      ? query
      : "Halle (Saale), " + query;


  let results =
    await locMatch(
      halleQuery
    );


  /*
    Falls INSA auf die kombinierte Suche
    nichts liefert, noch einmal allgemein
    suchen und anschließend Halle filtern.
  */

  if (!results.length) {
    results =
      await locMatch(query);
  }


  results =
    results.filter(
      item =>
        item.type === "S" &&
        isHalleStop(item)
    );


  results =
    uniqueBy(
      results,

      item =>
        item.lid ||
        item.extId ||
        item.name
    );


  results.sort(
    (a, b) =>
      String(a.name)
        .localeCompare(
          String(b.name),
          "de"
        )
  );


  return results;
}


async function searchStops(
  immediate = false
) {
  const input =
    document.getElementById(
      "search"
    );

  const resultsBox =
    document.getElementById(
      "results"
    );

  const query =
    input.value.trim();


  if (query.length < 2) {

    resultsBox.innerHTML =
      query.length
        ? `<div class="search-info">
             Bitte mindestens 2 Zeichen eingeben.
           </div>`
        : "";

    return;
  }


  const searchId =
    ++currentSearchId;


  resultsBox.innerHTML =
    `<div class="search-info">
       Haltestellen werden gesucht …
     </div>`;


  try {

    const stops =
      await findStops(query);


    /*
      Zwischenzeitlich neue Suche gestartet?
      Dann dieses Ergebnis ignorieren.
    */

    if (
      searchId !==
      currentSearchId
    ) {
      return;
    }


    if (!stops.length) {

      resultsBox.innerHTML =
        `<div class="search-info">
           Keine Haltestelle in Halle (Saale) gefunden.
         </div>`;

      return;
    }


    resultsBox.innerHTML = "";


    for (
      const item
      of stops
    ) {

      const button =
        document.createElement(
          "button"
        );

      button.className =
        "search-result";

      button.innerHTML =
        `<span class="search-pin">●</span>
         <span>
           ${escapeHTML(item.name)}
         </span>`;


      button.onclick =
        async () => {

          input.value = "";

          resultsBox.innerHTML =
            "";

          await selectStop(item);
        };


      resultsBox.appendChild(
        button
      );
    }

  } catch (error) {

    resultsBox.innerHTML =
      `<div class="error-box">
         ${escapeHTML(
           error.message
         )}
       </div>`;
  }
}


function debounceSearch() {
  clearTimeout(
    searchTimer
  );


  searchTimer =
    setTimeout(
      () => searchStops(),
      SEARCH_DELAY
    );
}


async function selectStop(item) {
  currentStop = {
    name:
      item.name,

    id:
      item.extId ||
      "",

    lid:
      item.lid ||
      ""
  };


  lastStop =
    currentStop;


  saveJSON(
    "catchit-last-stop",
    lastStop
  );


  updateStopTitle();

  updateFavoriteButton();

  await loadDepartures();
}


/* =========================================================
   ZEITVERARBEITUNG
========================================================= */

function parseHafasDate(
  dateString
) {
  const value =
    String(
      dateString || ""
    );


  if (
    !/^\d{8}$/.test(value)
  ) {
    return null;
  }


  return {
    year:
      Number(
        value.slice(0, 4)
      ),

    month:
      Number(
        value.slice(4, 6)
      ) - 1,

    day:
      Number(
        value.slice(6, 8)
      )
  };
}


function parseHafasTime(
  value
) {
  const digits =
    String(value || "")
      .replace(/\D/g, "");


  if (digits.length < 4) {
    return null;
  }


  /*
    Normale HAFAS-Zeit:
    HHMMSS

    HAFAS kann zusätzlich einen
    Tagesoffset davor schreiben.
  */

  const time =
    digits.slice(-6)
      .padStart(6, "0");


  const prefix =
    digits.slice(
      0,
      Math.max(
        0,
        digits.length - 6
      )
    );


  const dayOffset =
    prefix
      ? Number(prefix)
      : 0;


  return {
    dayOffset,

    hour:
      Number(
        time.slice(0, 2)
      ),

    minute:
      Number(
        time.slice(2, 4)
      ),

    second:
      Number(
        time.slice(4, 6)
      )
  };
}


function hafasDateTime(
  dateString,
  timeString
) {
  const date =
    parseHafasDate(
      dateString
    );

  const time =
    parseHafasTime(
      timeString
    );


  if (!time) {
    return null;
  }


  let baseDate;


  if (date) {

    baseDate =
      new Date(
        date.year,
        date.month,
        date.day
      );

  } else {

    const now =
      new Date();

    baseDate =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
  }


  baseDate.setDate(
    baseDate.getDate() +
    time.dayOffset
  );


  baseDate.setHours(
    time.hour,
    time.minute,
    time.second,
    0
  );


  /*
    Falls keine Journey-Date vorhanden
    und eine Zeit kurz nach Mitternacht
    abgefragt wird.
  */

  if (!date) {

    const now =
      new Date();


    if (
      baseDate <
      new Date(
        now.getTime() -
        6 * 60 * 60 * 1000
      )
    ) {

      baseDate.setDate(
        baseDate.getDate() + 1
      );
    }
  }


  return baseDate;
}


function formatClock(date) {
  if (!date) {
    return "--:--";
  }


  return date.toLocaleTimeString(
    "de-DE",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}


function relativeTime(date) {
  if (!date) {
    return "--";
  }


  const diff =
    Math.round(
      (
        date.getTime() -
        Date.now()
      ) / 60000
    );


  if (diff <= 0) {
    return "jetzt";
  }


  if (diff === 1) {
    return "in 1 min";
  }


  return `in ${diff} min`;
}


function calculateDelay(
  plannedDate,
  realtimeDate
) {
  if (
    !plannedDate ||
    !realtimeDate
  ) {
    return 0;
  }


  return Math.round(
    (
      realtimeDate -
      plannedDate
    ) / 60000
  );
}


/* =========================================================
   PRODUKT / LINIE
========================================================= */

function getProduct(
  journey,
  products
) {
  const stopInfo =
    journey.stbStop || {};


  const productIndex =
    journey.prodX ??
    journey.prodL?.[0]?.prodX ??
    stopInfo.dProdX;


  if (
    typeof productIndex ===
      "number" &&
    products[productIndex]
  ) {
    return products[
      productIndex
    ];
  }


  return null;
}


function getLineName(
  journey,
  products
) {
  const product =
    getProduct(
      journey,
      products
    );


  return String(
    product?.prodCtx?.line ||
    product?.prodCtx?.catOutS ||
    product?.nameS ||
    product?.name ||
    "?"
  ).trim();
}


/* =========================================================
   ABFAHRTEN
========================================================= */

function parseDeparture(
  journey,
  products
) {
  const stopInfo =
    journey.stbStop || {};


  const plannedRaw =
    stopInfo.dTimeS ||
    journey.dTimeS ||
    null;


  const realtimeRaw =
    stopInfo.dTimeR ||
    stopInfo.dTimeP ||
    journey.dTimeR ||
    plannedRaw;


  const journeyDate =
    journey.date ||
    null;


  const plannedDate =
    hafasDateTime(
      journeyDate,
      plannedRaw
    );


  const realtimeDate =
    hafasDateTime(
      journeyDate,
      realtimeRaw
    );


  const delay =
    calculateDelay(
      plannedDate,
      realtimeDate
    );


  const cancelled =
    journey.cancelled === true ||
    stopInfo.dCncl === true ||
    stopInfo.cancelled === true;


  const realtime =
    Boolean(
      stopInfo.dTimeR ||
      stopInfo.dTimeP ||
      stopInfo.dProgType
    );


  return {
    id:
      journey.jid ||
      `${getLineName(
        journey,
        products
      )}-${realtimeRaw}`,

    line:
      getLineName(
        journey,
        products
      ),

    destination:
      journey.dirTxt ||
      "Unbekannt",

    plannedDate,

    realtimeDate,

    delay,

    realtime,

    cancelled
  };
}


async function loadDepartures() {
  const status =
    document.getElementById(
      "status"
    );

  const departures =
    document.getElementById(
      "departures"
    );


  if (!currentStop) {
    return;
  }


  status.textContent =
    "Aktualisiere …";


  try {

    const now =
      new Date();


    const date =
      now.getFullYear()
        .toString() +

      String(
        now.getMonth() + 1
      ).padStart(2, "0") +

      String(
        now.getDate()
      ).padStart(2, "0");


    const time =
      String(
        now.getHours()
      ).padStart(2, "0") +

      String(
        now.getMinutes()
      ).padStart(2, "0") +

      String(
        now.getSeconds()
      ).padStart(2, "0");


    const data =
      await hafas([
        {
          meth:
            "StationBoard",

          req: {
            type:
              "DEP",

            stbLoc: {
              lid:
                currentStop.lid
            },

            dirLoc:
              null,

            maxJny:
              40,

            date,

            time,

            dur:
              120,

            jnyFltrL: [
              {
                type:
                  "PROD",

                mode:
                  "INC",

                value:
                  1023
              }
            ]
          }
        }
      ]);


    const service =
      data.svcResL[0];


    if (
      service.err &&
      service.err !== "OK"
    ) {
      throw new Error(
        service.errTxt ||
        service.err
      );
    }


    const result =
      service.res || {};


    const products =
      result.common?.prodL ||
      [];


    let list =
      (result.jnyL || [])
        .map(
          journey =>
            parseDeparture(
              journey,
              products
            )
        );


    /*
      Ausgefallene Fahrten separat behandeln.
      Zunächst nicht vollständig entfernen.
    */

    list =
      uniqueBy(
        list,

        item =>
          item.id +
          "-" +
          (
            item.realtimeDate
              ?.getTime() ||
            ""
          )
      );


    list.sort(
      (a, b) =>
        (
          a.realtimeDate
            ?.getTime() ||
          Number.MAX_SAFE_INTEGER
        ) -
        (
          b.realtimeDate
            ?.getTime() ||
          Number.MAX_SAFE_INTEGER
        )
    );


    /*
      Alte Fahrten entfernen.
    */

    list =
      list.filter(item => {

        if (
          !item.realtimeDate
        ) {
          return true;
        }


        return (
          item.realtimeDate
            .getTime() >
          Date.now() -
          90 * 1000
        );
      });


    renderDepartures(
      list
    );


    status.textContent =
      "Zuletzt aktualisiert: " +
      new Date()
        .toLocaleTimeString(
          "de-DE",
          {
            hour:
              "2-digit",

            minute:
              "2-digit"
          }
        );


  } catch (error) {

    status.textContent =
      "Aktualisierung fehlgeschlagen";


    departures.innerHTML =
      `<div class="error-box">
         ${escapeHTML(
           error.message
         )}
       </div>`;
  }
}


function renderDepartures(list) {
  const container =
    document.getElementById(
      "departures"
    );


  container.innerHTML = "";


  if (!list.length) {

    container.innerHTML =
      `<div class="empty-state">
         Momentan keine Abfahrten gefunden.
       </div>`;

    return;
  }


  for (
    const departure
    of list
  ) {

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "departure-row";


    if (
      departure.cancelled
    ) {
      row.classList.add(
        "cancelled"
      );
    }


    const line =
      document.createElement(
        "div"
      );

    line.className =
      "line-badge";

    line.textContent =
      departure.line;


    const center =
      document.createElement(
        "div"
      );

    center.className =
      "departure-main";


    const destination =
      document.createElement(
        "div"
      );

    destination.className =
      "destination";

    destination.textContent =
      departure.destination;


    const meta =
      document.createElement(
        "div"
      );

    meta.className =
      "departure-meta";


    if (
      departure.cancelled
    ) {

      meta.innerHTML =
        `<span class="cancelled-label">
           Fahrt fällt aus
         </span>`;

    } else {

      const clock =
        formatClock(
          departure.realtimeDate
        );


      meta.innerHTML =
        `<span>${clock}</span>`;


      if (
        departure.realtime
      ) {

        meta.innerHTML +=
          `<span class="live">
             ● Echtzeit
           </span>`;
      }


      if (
        departure.delay > 0
      ) {

        meta.innerHTML +=
          `<span class="delay">
             +${departure.delay} min
           </span>`;

      } else if (
        departure.delay < 0
      ) {

        meta.innerHTML +=
          `<span class="early">
             ${departure.delay} min
           </span>`;
      }
    }


    center.appendChild(
      destination
    );

    center.appendChild(
      meta
    );


    const right =
      document.createElement(
        "div"
      );

    right.className =
      "departure-time";


    right.textContent =
      departure.cancelled
        ? "Ausfall"
        : relativeTime(
            departure.realtimeDate
          );


    row.appendChild(line);

    row.appendChild(center);

    row.appendChild(right);

    container.appendChild(row);
  }
}


/* =========================================================
   AKTUELLE HALTESTELLE
========================================================= */

function updateStopTitle() {
  const title =
    document.getElementById(
      "stopName"
    );


  if (
    currentStop &&
    title
  ) {
    title.textContent =
      currentStop.name;
  }
}


/* =========================================================
   FAVORITEN
========================================================= */

function isFavorite(stop) {
  if (!stop) {
    return false;
  }


  return favorites.some(
    favorite =>
      favorite.lid ===
      stop.lid
  );
}


function toggleFavorite() {
  if (!currentStop) {
    return;
  }


  if (
    isFavorite(
      currentStop
    )
  ) {

    favorites =
      favorites.filter(
        favorite =>
          favorite.lid !==
          currentStop.lid
      );

  } else {

    favorites.push({
      name:
        currentStop.name,

      id:
        currentStop.id,

      lid:
        currentStop.lid
    });
  }


  saveJSON(
    "catchit-favorites",
    favorites
  );


  updateFavoriteButton();

  renderFavorites();
}


function updateFavoriteButton() {
  const button =
    document.getElementById(
      "favoriteButton"
    );


  if (!button) {
    return;
  }


  button.textContent =
    isFavorite(currentStop)
      ? "★"
      : "☆";


  button.title =
    isFavorite(currentStop)
      ? "Favorit entfernen"
      : "Als Favorit speichern";
}


function renderFavorites() {
  const box =
    document.getElementById(
      "favList"
    );


  if (!box) {
    return;
  }


  box.innerHTML = "";


  if (!favorites.length) {

    box.innerHTML =
      `<div class="empty-state">
         Noch keine Favoriten gespeichert.
       </div>`;

    return;
  }


  for (
    const favorite
    of favorites
  ) {

    const button =
      document.createElement(
        "button"
      );

    button.className =
      "favorite-item";


    button.innerHTML =
      `<span>★</span>
       <span>
         ${escapeHTML(
           favorite.name
         )}
       </span>`;


    button.onclick =
      async () => {

        currentStop =
          favorite;


        lastStop =
          favorite;


        saveJSON(
          "catchit-last-stop",
          favorite
        );


        showPage("home");

        updateStopTitle();

        updateFavoriteButton();

        await loadDepartures();
      };


    box.appendChild(
      button
    );
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

function showPage(page) {
  document
    .querySelectorAll(
      ".page"
    )
    .forEach(
      element =>
        element.classList
          .add("hidden")
    );


  document
    .getElementById(page)
    ?.classList
    .remove("hidden");


  document
    .querySelectorAll(
      ".nav-button"
    )
    .forEach(
      button =>
        button.classList
          .toggle(
            "active",
            button.dataset.page ===
            page
          )
    );


  if (
    page === "favorites"
  ) {
    renderFavorites();
  }
}


/* =========================================================
   PWA
========================================================= */

window.addEventListener(
  "beforeinstallprompt",
  event => {

    event.preventDefault();

    deferredPrompt =
      event;


    const installButton =
      document.getElementById(
        "installButton"
      );


    if (installButton) {
      installButton.hidden =
        false;
    }
  }
);


async function installApp() {
  if (!deferredPrompt) {

    alert(
      "Öffne das Browser-Menü und wähle „Zum Startbildschirm hinzufügen“."
    );

    return;
  }


  deferredPrompt.prompt();

  await deferredPrompt.userChoice;

  deferredPrompt = null;
}


/* =========================================================
   ONLINE / OFFLINE
========================================================= */

function updateConnectionState() {
  document.body.classList.toggle(
    "offline",
    !navigator.onLine
  );


  const connection =
    document.getElementById(
      "connectionState"
    );


  if (connection) {
    connection.textContent =
      navigator.onLine
        ? "Online"
        : "Offline";
  }
}


window.addEventListener(
  "online",
  () => {

    updateConnectionState();

    loadDepartures();
  }
);


window.addEventListener(
  "offline",
  updateConnectionState
);


/* =========================================================
   INITIALISIERUNG
========================================================= */

async function initialize() {
  updateConnectionState();

  renderFavorites();


  document
    .getElementById(
      "search"
    )
    ?.addEventListener(
      "input",
      debounceSearch
    );


  document
    .getElementById(
      "search"
    )
    ?.addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {

          event.preventDefault();

          searchStops(true);
        }
      }
    );


  document
    .getElementById(
      "favoriteButton"
    )
    ?.addEventListener(
      "click",
      toggleFavorite
    );


  document
    .querySelectorAll(
      ".nav-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            showPage(
              button.dataset.page
            )
        );
      }
    );


  if (
    lastStop?.lid
  ) {

    currentStop =
      lastStop;

  } else {

    try {

      const results =
        await findStops(
          "Marktplatz"
        );


      if (
        results.length
      ) {

        currentStop = {
          name:
            results[0].name,

          id:
            results[0].extId ||
            "",

          lid:
            results[0].lid
        };

      }

    } catch (error) {

      console.error(
        error
      );
    }
  }


  updateStopTitle();

  updateFavoriteButton();


  if (currentStop) {
    await loadDepartures();
  }


  clearInterval(
    refreshTimer
  );


  refreshTimer =
    setInterval(
      loadDepartures,
      REFRESH_INTERVAL
    );
}


document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible" &&
      currentStop
    ) {

      loadDepartures();
    }
  }
);


if (
  "serviceWorker"
  in navigator
) {

  navigator.serviceWorker
    .register("./sw.js")
    .then(
      registration =>
        registration.update()
    )
    .catch(
      console.error
    );
}


initialize();    },
    body: JSON.stringify({
      ...base,
      svcReqL
    })
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }

  const data = await response.json();

  if (data.err && data.err !== "OK") {
    throw new Error(data.errTxt || data.err);
  }

  if (!data.svcResL || !data.svcResL.length) {
    throw new Error("Keine INSA-Antwort");
  }

  return data;
}


/* =========================
   HALTESTELLENSUCHE
========================= */

async function findStops(query) {
  const data = await hafas([
    {
      meth: "LocMatch",
      req: {
        input: {
          loc: {
            type: "S",
            name: query
          },
          field: "S",
          maxLoc: 15
        }
      }
    }
  ]);

  const service = data.svcResL[0];

  if (service.err !== "OK") {
    throw new Error(service.errTxt || service.err);
  }

  return service.res?.match?.locL || [];
}


async function searchStops() {
  const input = document.getElementById("search");
  const query = input.value.trim();

  if (!query) return;

  const box = document.getElementById("results");
  box.innerHTML = "Suche …";

  try {
    const stops = await findStops(query);

    if (!stops.length) {
      box.innerHTML = "Keine Haltestelle gefunden.";
      return;
    }

    box.innerHTML = "";

    stops.slice(0, 8).forEach((item) => {
      const button = document.createElement("button");
      button.textContent = item.name;

      button.onclick = () => {
        chooseStop(item);
      };

      box.appendChild(button);
    });

  } catch (error) {
    box.innerHTML =
      "Fehler bei der Suche: " + error.message;
  }
}


async function chooseStop(item) {
  stop = {
    name: item.name,
    id: item.lid
  };

  document.getElementById("results").innerHTML = "";
  document.getElementById("stopName").textContent = stop.name;

  await load();
}


/* =========================
   DATUM / ZEIT
========================= */

function hafasDate() {
  const now = new Date();

  return (
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0")
  );
}


function hafasTime() {
  const now = new Date();

  return (
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    "00"
  );
}


function normalizeHafasTime(value) {
  if (!value) return null;

  const text = String(value).replace(/\D/g, "");

  if (text.length < 4) return null;

  return text.padStart(6, "0").slice(0, 6);
}


function timeToDate(value) {
  const normalized = normalizeHafasTime(value);

  if (!normalized) return null;

  const hours = Number(normalized.slice(0, 2));
  const minutes = Number(normalized.slice(2, 4));
  const seconds = Number(normalized.slice(4, 6));

  const now = new Date();
  const date = new Date(now);

  date.setHours(hours, minutes, seconds, 0);

  /*
    INSA liefert bei Nachtfahrten Zeiten nach Mitternacht.
    Liegt die errechnete Uhrzeit deutlich in der Vergangenheit,
    gehört sie sehr wahrscheinlich zum folgenden Kalendertag.
  */
  if (date.getTime() < now.getTime() - 6 * 60 * 60 * 1000) {  return service.res?.match?.locL || [];
}

async function searchStops() {
  const input = document.getElementById("search");
  const query = input.value.trim();

  if (!query) return;

  const box = document.getElementById("results");
  box.innerHTML = "Suche …";

  try {
    const stops = await findStops(query);

    if (!stops.length) {
      box.innerHTML = "Keine Haltestelle gefunden.";
      return;
    }

    box.innerHTML = "";

    stops.slice(0, 8).forEach((item) => {
      const button = document.createElement("button");
      button.textContent = item.name;
      button.onclick = () => chooseStop(item);
      box.appendChild(button);
    });

  } catch (error) {
    box.innerHTML = "Fehler bei der Suche: " + error.message;
  }
}

async function chooseStop(item) {
  stop = {
    name: item.name,
    id: item.lid
  };

  document.getElementById("results").innerHTML = "";
  document.getElementById("stopName").textContent = stop.name;

  await load();
}

function hafasDate() {
  const now = new Date();

  return (
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0")
  );
}

function hafasTime() {
  const now = new Date();

  return (
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    "00"
  );
}

function showTime(value) {
  if (!value || value.length < 4) return "--";

  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2, 4));

  const now = new Date();
  const departure = new Date();

  departure.setHours(hours, minutes, 0, 0);

  if (departure < now) {
    departure.setDate(departure.getDate() + 1);
  }

  const diff = Math.round((departure - now) / 60000);

  if (diff <= 0) return "jetzt";
  if (diff === 1) return "in 1 min";

  return "in " + diff + " min";
}

async function load() {
  const status = document.getElementById("status");
  const departures = document.getElementById("departures");

  status.textContent = "Aktualisiere …";

  try {
    if (!stop.id) {
      const found = await findStops("Halle (Saale), Marktplatz");

      if (!found.length) {
        throw new Error("Marktplatz nicht gefunden");
      }

      stop = {
        name: found[0].name,
        id: found[0].lid
      };

      document.getElementById("stopName").textContent = stop.name;
    }

    const data = await hafas([
      {
        meth: "StationBoard",
        req: {
          type: "DEP",
          stbLoc: {
            lid: stop.id
          },
          dirLoc: null,
          maxJny: 15,
          date: hafasDate(),
          time: hafasTime(),
          dur: 60,
          jnyFltrL: [
            {
              type: "PROD",
              mode: "INC",
              value: 1023
            }
          ]
        }
      }
    ]);

    const service = data.svcResL[0];

    if (service.err !== "OK") {
      throw new Error(service.errTxt || service.err);
    }

    const result = service.res || {};
    const journeys = result.jnyL || [];
    const products = result.common?.prodL || [];

    status.textContent =
      "Zuletzt aktualisiert: " +
      new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      });

    departures.innerHTML = "";

    if (!journeys.length) {
      departures.textContent = "Keine Abfahrten gefunden.";
      return;
    }

    journeys.forEach((journey) => {
      const row = document.createElement("div");
      row.className = "row";

      const stopInfo = journey.stbStop || {};

      const productIndex =
        journey.prodX ??
        journey.prodL?.[0]?.prodX ??
        stopInfo.dProdX;

      const product =
        productIndex !== undefined
          ? products[productIndex]
          : null;

      const line =
        product?.prodCtx?.line ||
        product?.prodCtx?.catOutS ||
        product?.name ||
        "?";

      const destination =
        journey.dirTxt ||
        "Unbekannt";

      const planned = stopInfo.dTimeS;
      const realtime = stopInfo.dTimeR || planned;

      const left = document.createElement("div");
      left.innerHTML =
        "<b>" + line + "</b><br>" +
        "<span class='muted'>" + destination + "</span>";

      const right = document.createElement("div");
      right.className = "time";
      right.textContent = showTime(realtime);

      row.appendChild(left);
      row.appendChild(right);
      departures.appendChild(row);
    });

  } catch (error) {
    status.textContent = "Fehler";
    departures.textContent = error.message;
  }
}

function tab(id, element) {
  document
    .querySelectorAll("main > section")
    .forEach((section) => section.classList.add("hidden"));

  document.getElementById(id).classList.remove("hidden");

  document
    .querySelectorAll(".tabs button")
    .forEach((button) => button.classList.remove("active"));

  element.classList.add("active");

  if (id === "favorites") renderFav();
}

function renderFav() {
  const box = document.getElementById("favList");

  if (!favorites.length) {
    box.innerHTML = "Noch keine Favoriten.";
    return;
  }

  box.innerHTML = "";

  favorites.forEach((favorite) => {
    const button = document.createElement("button");
    button.textContent = favorite.name;

    button.onclick = () => {
      stop = favorite;
      document.getElementById("stopName").textContent = stop.name;
      load();
    };

    box.appendChild(button);
  });
}

function chooseFav() {
  if (!stop.id) return;

  if (!favorites.some((f) => f.id === stop.id)) {
    favorites.push(stop);
    localStorage.setItem("fav", JSON.stringify(favorites));
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
});

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
  } else {
    alert("Nutze im Browser „Zum Startbildschirm hinzufügen“.");
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

load();
setInterval(load, 30000);
