# Catch it Halle – Live-Karte

Diese Version nutzt deinen bestehenden Cloudflare-Worker:

`https://frosty-leaf-0fc9.ricopbrunn.workers.dev`

## Funktionen
- OpenStreetMap / Leaflet
- Haltestellen im Raum Halle (Saale)
- Haltestellensuche
- Tram-/Bus-Filter
- Live-Abfahrten per INSA/HAFAS
- Auto-Refresh alle 30 Sekunden
- Mobile Bottom-Sheet

## Einbau
Die drei Dateien `index.html`, `style.css` und `app.js` können direkt in dein GitHub-Pages-Repository kopiert werden.

## Wichtig
Die öffentlichen Echtzeitquellen stellen nicht verlässlich echte GPS-Positionen aller HAVAG-Fahrzeuge bereit.
Darum zeigt diese Version keine erfundenen Fahrzeugpositionen. Sobald der Worker/HAFAS-Endpunkt
für eine Fahrt echte Koordinaten liefert, kann darauf ein Fahrzeug-Layer aufgebaut werden.
