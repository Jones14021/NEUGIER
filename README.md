# NEUGIER
Neues entdecken. Unterwegs gemeinsam Ideen erleben. Reisen.

Selbst gehosteter Reisehelfer für Routenplanung vor und während der Reise: Gesamtreise-Karte mit Übernachtungszielen,
Tagesansicht mit allen Stopps und Navigation per Google Maps, Live-Zusammenarbeit, Versionshistorie, KI-Assistent mit
Routen-Diff, Ausgaben (Splid-Export), Erinnerungen und Excel-Import mit Merge.

Architektur: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Schnellstart (lokal, Docker)

```sh
cp .env.example .env      # optional ausfüllen
docker compose up -d --build
```

→ http://localhost:8080. Ohne `GOOGLE_CLIENT_ID` erscheint ein Dev-Login (Name + E-Mail). Der **erste Nutzer wird Admin**.
Beim ersten Start wird die Datenbank mit der Neuseeland-Reise aus `Routenplanung.xlsx` befüllt. Daten liegen in `./data`.

### Entwicklung mit Hot-Reload

```sh
docker compose -f docker-compose.dev.yml up
```

→ http://localhost:5173 (Vite) mit API auf 8080. Alternativ ohne Docker: `nix-shell`, dann `npm install && npm run dev`.

## Deployment (Ubuntu + Tailscale)

```sh
git clone … && cd NEUGIER
cp .env.example .env && nano .env
docker compose up -d --build
sudo tailscale serve --bg 8080
```

Die App ist dann unter `https://<host>.<tailnet>.ts.net` erreichbar. Der Container bindet nur an `127.0.0.1`.
Update: `git pull && docker compose up -d --build`. Backup: Ordner `data/` sichern (oder JSON-Export in der App).

## Konfiguration (`.env`)

| Variable | Zweck |
|---|---|
| `GOOGLE_CLIENT_ID` | „Anmelden mit Google“. OAuth-Client (Webanwendung), autorisierte JS-Quelle = Tailscale-URL |
| `ADMIN_EMAILS` | Kommagetrennt, werden automatisch Admin |
| `GOOGLE_MAPS_API_KEY` | Maps JavaScript API (Browser) |
| `GOOGLE_MAPS_SERVER_KEY` | Routes API + Places API (New) (Server); Fallback: `GOOGLE_MAPS_API_KEY` |
| `GOOGLE_MAPS_MAP_ID` | Optional eigene Map-ID (Advanced Markers) |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | KI-Assistent (Standard: GitHub Models, Key = GitHub PAT mit `models:read`). Auch im Admin-Dashboard setzbar |

In der Google Cloud Console aktivieren: *Maps JavaScript API*, *Routes API*, *Places API (New)*.

## Funktionen

* **Gesamtreise**: große Karte, ein Pin pro Tag am Übernachtungsziel, Hauptroute; Tageskarten (mobil wischbar)
* **Tag / Heute**: alle Stopps auf der Karte, Fahrzeiten, Navigation pro Stopp / ganze Tagesroute / „ab hier“
* **Hauptroute vs. Tagesroute** pro Stopp; Cafés, Wanderungen, Duschen erscheinen nicht auf der Gesamtkarte
* **Duschen getrennt vom Campen** geplant
* **Live-Collab** (WebSocket) mit Präsenz, **Versionshistorie** mit Rollback (Batch oder einzelner Stopp)
* **Rollen**: Zuschauer / Mitarbeiter / Admin, Admin-Dashboard
* **Kommentare** an Tagen und Stopps, jederzeit bearbeitbar
* **Ausgaben**: wer hat gezahlt + Preis, Aufteilung, Export für Splid
* **Erinnerungen**: Text + Fotos, getrennt von der Planung
* **KI-Assistent** mit kompletter Reise als Kontext; Vorschläge als Diff (Liste + Karte) zum Annehmen/Ablehnen/Ändern
* **Import** Excel/JSON inkl. Re-Import mit 3-Wege-Merge und Konflikt-UI; **Export** JSON
