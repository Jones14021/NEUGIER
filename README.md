# NEUGIER
Neues entdecken. Unterwegs gemeinsam Ideen erleben. Reisen.

Selbst gehosteter Reisehelfer für Routenplanung vor und während der Reise: Gesamtreise-Karte mit Übernachtungszielen,
Tagesansicht mit allen Stopps und Navigation per Google Maps, Live-Zusammenarbeit, Versionshistorie, KI-Assistent mit
Routen-Diff, Ausgaben (Splid-Export), Erinnerungen und Excel-Import mit Merge.

Architektur: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) · Einrichtung und API-Keys: [docs/ENTWICKLER.md](docs/ENTWICKLER.md)

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

## Deployment mit Tailscale

```sh
git clone … && cd NEUGIER
cp .env.example .env && nano .env
docker compose up -d --build
```

Mit einem Tailscale-Auth-Key in `.env` registriert der Sidecar `neugier` und richtet Tailscale Serve automatisch ein. Die App ist dann unter `https://neugier.<tailnet>.ts.net` innerhalb des Tailnets erreichbar; lokal bleibt `http://localhost:8080` verfügbar. Einrichtung, Google OAuth und Host-Umzug: [docs/ENTWICKLER.md](docs/ENTWICKLER.md#tailscale-und-feste-https-adresse).
Update: `git pull && docker compose up -d --build`. Backup: Ordner `data/` sichern (oder JSON-Export in der App).

Admins können die vollständige SQLite-Datenbank auch unter **Admin → Datenbank-Backup** herunterladen und wiederherstellen. Hochgeladene Fotos und `.env` sind separat zu sichern; Hinweise zur Wiederherstellung stehen in der Entwickleranleitung.

## Konfiguration (`.env`)

| Variable | Zweck |
|---|---|
| `TS_AUTHKEY` | Tailscale-Auth-Key für die erstmalige Registrierung des Sidecars als `neugier` |
| `TS_EXTRA_ARGS` | Optional zusätzliche Tailscale-Argumente, z. B. ein OAuth-Tag |
| `GOOGLE_CLIENT_ID` | „Anmelden mit Google“. OAuth-Client (Webanwendung), autorisierte JS-Quelle = Tailscale-URL |
| `ADMIN_EMAILS` | Kommagetrennt, werden automatisch Admin |
| `GOOGLE_MAPS_API_KEY` | Maps JavaScript API (Browser) |
| `GOOGLE_MAPS_SERVER_KEY` | Routes API + Places API (New) (Server); Fallback: `GOOGLE_MAPS_API_KEY` |
| `GOOGLE_MAPS_MAP_ID` | Optional eigene Map-ID (Advanced Markers) |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` | KI-Assistent: GitHub Copilot oder OpenAI-kompatible API; auch im Admin-Dashboard setzbar |
| `LLM_BASE_URL` / `LLM_WEB_SEARCH` / `TAVILY_API_KEY` | Basis-URL und optionale Websuche; Details in der Entwickleranleitung |

In der Google Cloud Console aktivieren: *Maps JavaScript API*, *Routes API*, *Places API (New)*.

## Funktionen

* **Gesamtreise**: Karte mit Vollbild, zoombasierten Pins, Hauptroute und Tageskarten
* **Tag / Heute**: Stopps, Fahrzeiten mit zusätzlichem Zeitpuffer, Navigation, Google-Maps-Supermarktsuche und Tage bis zur nächsten geplanten Dusche
* **Hauptroute vs. Tagesroute** pro Stopp; Cafés, Wanderungen, Duschen erscheinen nicht auf der Gesamtkarte
* **Duschen getrennt vom Campen** geplant
* **Live-Collab** (WebSocket) mit Präsenz, **Versionshistorie** mit Rollback (Batch oder einzelner Stopp)
* **Rollen**: Zuschauer / Mitarbeiter / Admin, Admin-Dashboard
* **Kommentare** an Tagen und Stopps, von Mitarbeitern bearbeitbar; Zuschauer lesen nur
* **Todos**: Aufgaben aus Tagen, Stopps und Kommentaren anlegen und gemeinsam erledigen
* **Standort teilen**: Mitarbeiter können GPS freigeben; Zuschauer sehen die letzte aktuelle Position oder das geplante Tagesziel
* **Ausgaben**: wer hat gezahlt + Preis, Aufteilung, Export für Splid
* **Erinnerungen**: Text + Fotos, getrennt von der Planung
* **KI-Assistent** mit kompletter Reise als Kontext; Vorschläge als Diff (Liste + Karte) zum Annehmen/Ablehnen/Ändern
* **Import** Excel/JSON inkl. Re-Import mit 3-Wege-Merge und Konflikt-UI; **Export** JSON
* **Android-Teilen**: Google-Maps-Links in der installierten PWA als Idee oder Tagesstopp übernehmen
* **PWA-Updates**: Neue Versionen werden nach dem Download automatisch aktiviert; lokal gespeicherte Offline-Änderungen bleiben erhalten
