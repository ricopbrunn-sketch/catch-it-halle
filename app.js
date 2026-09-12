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
   SPEICHER / HILFSFUNKTIONEN
========================================================= */

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);

    if (!value) {
      return fallback;
    }

    return JSON.parse(value);

  } catch {
    return fallback;
  }
}


function saveJSON(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  } catch (error) {
    console.error(
      "Speichern fehlgeschlagen:",
      error
    );
  }
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
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(API_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        ...base,
        svcReqL
      }),

      signal: controller.signal
    });


    if (!response.ok) {
      throw new Error(
        "Serverfehler " + response.status
      );
    }


    const data = await response.json();


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
    if (error.name === "AbortError") {
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
   HALTESTELLENSUCHE
========================================================= */

function isHalleStop(item) {
  const name = normalizeText(
    item?.name
  );

  return (
    name.includes("halle (saale)") ||
    name.includes("halle-saale") ||
    name.startsWith("halle,") ||
    name.startsWith("halle ")
  );
}


async function locMatch(searchText) {
  const data = await hafas([
    {
      meth: "LocMatch",

      req: {
        input: {
          loc: {
            type: "S",
            name: searchText
          },

          field: "S",
          maxLoc: MAX_SEARCH_RESULTS
        }
      }
    }
  ]);


  const service = data.svcResL[0];


  if (
    service.err &&
    service.err !== "OK"
  ) {
    throw new Error(
      service.errTxt ||
      service.err
    );
  }


  return service.res?.match?.locL || [];
}


async function findStops(query) {
  query = String(query || "").trim();

  if (query.length < 2) {
    return [];
  }


  const alreadyContainsHalle =
    normalizeText(query).includes("halle");


  const halleQuery =
    alreadyContainsHalle
      ? query
      : "Halle (Saale), " + query;


  let combined = [];


  /*
    Suche 1:
    gezielt mit Halle (Saale)
  */
  try {
    const first =
      await locMatch(halleQuery);

    combined.push(...first);

  } catch (error) {
    console.warn(
      "Gezielte Halle-Suche fehlgeschlagen:",
      error
    );
  }


  /*
    Suche 2:
    allgemeine Suche als Ergänzung
  */
  try {
    const second =
      await locMatch(query);

    combined.push(...second);

  } catch (error) {
    console.warn(
      "Allgemeine Suche fehlgeschlagen:",
      error
    );
  }


  combined = combined.filter(
    item =>
      item &&
      item.name &&
      item.lid &&
      isHalleStop(item)
  );


  combined = uniqueBy(
    combined,
    item =>
      item.lid ||
      item.extId ||
      item.name
  );


  combined.sort(
    (a, b) =>
      String(a.name).localeCompare(
        String(b.name),
        "de"
      )
  );


  return combined;
}


async function searchStops(
  immediate = false
) {
  const input =
    document.getElementById("search");

  const resultsBox =
    document.getElementById("results");


  if (!input || !resultsBox) {
    return;
  }


  const query =
    input.value.trim();


  if (query.length < 2) {
    resultsBox.innerHTML =
      query.length
        ? `
          <div class="search-info">
            Bitte mindestens 2 Zeichen eingeben.
          </div>
        `
        : "";

    return;
  }


  const searchId =
    ++currentSearchId;


  resultsBox.innerHTML = `
    <div class="search-info">
      Haltestellen werden gesucht …
    </div>
  `;


  try {
    const stops =
      await findStops(query);


    if (
      searchId !==
      currentSearchId
    ) {
      return;
    }


    if (!stops.length) {
      resultsBox.innerHTML = `
        <div class="search-info">
          Keine Haltestelle in Halle (Saale) gefunden.
        </div>
      `;

      return;
    }


    resultsBox.innerHTML = "";


    for (const item of stops) {
      const button =
        document.createElement(
          "button"
        );

      button.className =
        "search-result";


      button.innerHTML = `
        <span class="search-pin">●</span>

        <span>
          ${escapeHTML(item.name)}
        </span>
      `;


      button.addEventListener(
        "click",
        async () => {
          input.value = "";
          resultsBox.innerHTML = "";

          await selectStop(item);
        }
      );


      resultsBox.appendChild(
        button
      );
    }

  } catch (error) {
    resultsBox.innerHTML = `
      <div class="error-box">
        ${escapeHTML(error.message)}
      </div>
    `;
  }
}


function debounceSearch() {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(
    () => searchStops(),
    SEARCH_DELAY
  );
}


async function selectStop(item) {
  if (!item?.lid) {
    return;
  }


  currentStop = {
    name: item.name,
    id: item.extId || "",
    lid: item.lid
  };


  lastStop = currentStop;


  saveJSON(
    "catchit-last-stop",
    currentStop
  );


  updateStopTitle();
  updateFavoriteButton();

  await loadDepartures();
}


/* =========================================================
   DATUM / ZEIT
========================================================= */

function currentHafasDate() {
  const now = new Date();

  return (
    now.getFullYear().toString() +
    String(
      now.getMonth() + 1
    ).padStart(2, "0") +
    String(
      now.getDate()
    ).padStart(2, "0")
  );
}


function currentHafasTime() {
  const now = new Date();

  return (
    String(
      now.getHours()
    ).padStart(2, "0") +

    String(
      now.getMinutes()
    ).padStart(2, "0") +

    String(
      now.getSeconds()
    ).padStart(2, "0")
  );
}


function parseHafasDate(value) {
  const text =
    String(value || "");


  if (!/^\d{8}$/.test(text)) {
    return null;
  }


  return {
    year:
      Number(
        text.slice(0, 4)
      ),

    month:
      Number(
        text.slice(4, 6)
      ) - 1,

    day:
      Number(
        text.slice(6, 8)
      )
  };
}


function parseHafasTime(value) {
  const digits =
    String(value || "")
      .replace(/\D/g, "");


  if (digits.length < 4) {
    return null;
  }


  let dayOffset = 0;
  let timePart = digits;


  if (digits.length > 6) {
    const prefix =
      digits.slice(
        0,
        digits.length - 6
      );

    dayOffset =
      Number(prefix) || 0;

    timePart =
      digits.slice(-6);
  }


  timePart =
    timePart.padStart(6, "0");


  return {
    dayOffset,

    hour:
      Number(
        timePart.slice(0, 2)
      ),

    minute:
      Number(
        timePart.slice(2, 4)
      ),

    second:
      Number(
        timePart.slice(4, 6)
      )
  };
}


function hafasDateTime(
  dateString,
  timeString
) {
  const date =
    parseHafasDate(dateString);

  const time =
    parseHafasTime(timeString);


  if (!time) {
    return null;
  }


  const now = new Date();

  const base =
    date
      ? new Date(
          date.year,
          date.month,
          date.day,
          0,
          0,
          0,
          0
        )
      : new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0
        );


  base.setDate(
    base.getDate() +
    time.dayOffset
  );


  base.setHours(
    time.hour,
    time.minute,
    time.second,
    0
  );


  /*
    Fallback für Fahrten nach Mitternacht,
    falls INSA kein Datum mitsendet.
  */
  if (!date) {
    const sixHoursAgo =
      now.getTime() -
      6 * 60 * 60 * 1000;


    if (
      base.getTime() <
      sixHoursAgo
    ) {
      base.setDate(
        base.getDate() + 1
      );
    }
  }


  return base;
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
      realtimeDate.getTime() -
      plannedDate.getTime()
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
    typeof productIndex === "number" &&
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
   ABFAHRTSDATEN AUFBEREITEN
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
      journey.dTimeR
    );


  return {
    id:
      journey.jid ||
      [
        getLineName(
          journey,
          products
        ),
        realtimeRaw,
        journey.dirTxt
      ].join("-"),

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


/* =========================================================
   ABFAHRTEN LADEN
========================================================= */

async function loadDepartures() {
  const status =
    document.getElementById(
      "status"
    );

  const departures =
    document.getElementById(
      "departures"
    );


  if (
    !status ||
    !departures
  ) {
    return;
  }


  if (
    !currentStop?.lid
  ) {
    status.textContent =
      "Keine Haltestelle ausgewählt.";

    departures.innerHTML = "";

    return;
  }


  status.textContent =
    "Aktualisiere …";


  try {
    const data = await hafas([
      {
        meth: "StationBoard",

        req: {
          type: "DEP",

          stbLoc: {
            lid: currentStop.lid
          },

          dirLoc: null,

          maxJny: 40,

          date:
            currentHafasDate(),

          time:
            currentHafasTime(),

          dur: 120,

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


    const journeys =
      result.jnyL || [];


    const products =
      result.common?.prodL || [];


    let list =
      journeys.map(
        journey =>
          parseDeparture(
            journey,
            products
          )
      );


    list = uniqueBy(
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


    list = list.filter(
      item => {
        if (!item.realtimeDate) {
          return true;
        }


        return (
          item.realtimeDate
            .getTime() >
          Date.now() -
          90 * 1000
        );
      }
    );


    list.sort(
      (a, b) => {
        const aTime =
          a.realtimeDate
            ?.getTime() ??
          Number.MAX_SAFE_INTEGER;


        const bTime =
          b.realtimeDate
            ?.getTime() ??
          Number.MAX_SAFE_INTEGER;


        return aTime - bTime;
      }
    );


    renderDepartures(list);


    status.textContent =
      "Zu
