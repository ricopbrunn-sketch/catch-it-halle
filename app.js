const AID = "hf7mcf9bv3nv8g5f";
const URL = "https://frosty-leaf-0fc9.ricopbrunn.workers.dev";

let stop = { name: "Marktplatz", id: null };
let favorites = JSON.parse(localStorage.getItem("fav") || "[]");
let deferredPrompt;

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

async function hafas(svcReqL) {
  const response = await fetch(URL, {
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
    throw new Error("HTTP " + response.status);
  }

  const data = await response.json();

  if (!data.svcResL || !data.svcResL.length) {
    throw new Error("Keine INSA-Antwort");
  }

  return data;
}

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
          field: "S"
        },
        maxLoc: 15
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
  if (!value || value.length < 4) return "--:--";

  return value.slice(0, 2) + ":" + value.slice(2, 4);
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
