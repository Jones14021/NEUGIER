# Entwickleranleitung

## Start

Node.js 24 wird benötigt. Lokal `npm install` und `npm run dev` ausführen oder mit Docker `docker compose -f docker-compose.dev.yml up` starten. Die produktionsähnliche Variante startet mit `docker compose up -d --build` auf `http://localhost:8080`. Die Konfiguration kann in einer aus `.env.example` kopierten `.env` hinterlegt werden; Änderungen an ihr erfordern einen Neustart des Containers.

## Google-Anmeldung und Karten

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt und gegebenenfalls ein Abrechnungskonto einrichten.
2. Unter [APIs und Dienste](https://console.cloud.google.com/apis/library) die Maps JavaScript API, Routes API und Places API (New) aktivieren. Im Bereich [Zugangsdaten](https://console.cloud.google.com/apis/credentials) API-Keys erstellen.
3. `GOOGLE_MAPS_API_KEY` für die Maps JavaScript API auf die verwendeten HTTP-Referrer und APIs beschränken. Für `GOOGLE_MAPS_SERVER_KEY` einen separaten, auf Routes und Places beschränkten Server-Key verwenden. Optional eine `GOOGLE_MAPS_MAP_ID` setzen.
4. Für Google-Login einen OAuth-Client vom Typ Webanwendung erstellen und die tatsächlichen Origins, zum Beispiel `http://localhost:8080` und die Tailscale-URL, als autorisierte JavaScript-Quellen eintragen. Die Client-ID in `GOOGLE_CLIENT_ID` setzen und gegebenenfalls `ADMIN_EMAILS` konfigurieren.

Ohne `GOOGLE_CLIENT_ID` ist der ungeschützte Dev-Login aktiv. Nicht öffentlich betreiben; für den Zugriff über Tailscale Google-Login und geeignete Zugriffskontrollen konfigurieren. Maps- und API-Aufrufe können Kosten verursachen; Quotas und Abrechnung beim Anbieter prüfen.

## KI-Assistent mit Websuche

### GitHub Copilot

1. Ein GitHub-Konto mit Zugriff auf Copilot und das [Copilot SDK](https://github.com/github/copilot-sdk) verwenden. Organisationsrichtlinien können den Zugriff einschränken.
2. Unter [Personal access tokens](https://github.com/settings/personal-access-tokens/new) ein Fine-grained Token mit der Kontoberechtigung **Copilot Requests** erstellen. Das Token geheim halten und nur die benötigten Berechtigungen vergeben.
3. In der App unter **Admin → KI-Assistent** den Anbieter GitHub Copilot, Modell `auto`, das Token und Websuche **An** auswählen und speichern. Alternativ `LLM_PROVIDER=copilot`, `LLM_MODEL=auto`, `LLM_API_KEY=<Token>` und `LLM_WEB_SEARCH=on` in `.env` setzen. `COPILOT_GITHUB_TOKEN` ist ein alternativer Umgebungsvariablenname für das Token.
4. Im Chat nach einer aktuellen Information fragen und Quellen und Antwort überprüfen. Der Assistent wird zur automatischen Suche bei aktuellen Fakten aufgefordert; eine Suche bei jeder Antwort ist nicht garantiert.

Die Integration verwendet das Copilot SDK mit den vorgesehenen Web-Tools. Ein erfolgreicher authentifizierter Test dieser Tools und ihrer Quellenangaben steht noch aus; Erreichbarkeit mit einem ungültigen Token allein belegt ihre Funktion nicht. Copilot-Nutzung und Modellwahl unterliegen den Bedingungen, Limits und möglichen Kosten des GitHub-Kontos.

### OpenAI-kompatibler Anbieter

Unter **Admin → KI-Assistent** `OpenAI-kompatible API`, Basis-URL, Modell und API-Key des Anbieters eintragen. Alternativ `LLM_PROVIDER=openai`, `LLM_BASE_URL`, `LLM_MODEL` und `LLM_API_KEY` setzen. Die URL muss einen Chat-Completions-Endpunkt unter `/chat/completions` bereitstellen.

Für die Suche `tavily` wählen und einen [Tavily API-Key](https://app.tavily.com/) im Admin-Bereich oder als `TAVILY_API_KEY` hinterlegen; das Modell muss Tool-Calling unterstützen. `native` verwendet die native Suchoption der API und setzt einen kompatiblen Anbieter und ein geeignetes Modell voraus. `off` deaktiviert die Suche. Anbieter können separate Kosten und Limits berechnen.

Admin-Einstellungen werden in SQLite gespeichert und haben Vorrang vor Umgebungsvariablen. Ein leer gelassenes Schlüsselfeld behält den vorhandenen Wert; derselbe gespeicherte KI-Schlüssel wird für beide Anbieter verwendet und muss beim Wechsel entsprechend ersetzt werden. Die Datenbank und `.env` enthalten gegebenenfalls Zugangsdaten und sind entsprechend zu schützen; sie gehören nicht ins Repository. Reiseinformationen und Chatnachrichten werden zur Beantwortung an den gewählten KI-Anbieter und gegebenenfalls an Suchdienste übertragen.

## Datenbank sichern und wiederherstellen

Admins können unter **Admin → Datenbank-Backup** eine konsistente SQLite-Datei lokal herunterladen und später wieder hochladen. Die Sicherung enthält die gesamte Datenbank einschließlich aller Reisen, Nutzer, Sitzungen, Einstellungen, API-Schlüssel, Importbasen und Historie. Die Datei vertraulich und geschützt aufbewahren. Fotos und andere hochgeladene Dateien liegen getrennt unter `data/uploads/` und müssen separat gesichert werden; `.env` und Copilot-Laufzeitdaten sind ebenfalls nicht enthalten.

Vor einer Wiederherstellung eine aktuelle Sicherung herunterladen, alle Geräte synchronisieren und weitere Bearbeitung während des Vorgangs vermeiden. Ausstehende Offline-Änderungen werden nicht in die Sicherung aufgenommen und können sonst später erneut übertragen werden. Die Wiederherstellung ersetzt die gesamte Datenbank und kann Anmeldungen und Berechtigungen ändern; gegebenenfalls erneut anmelden. Die Datei wird vor dem Einspielen auf Integrität und Schema-Kompatibilität geprüft. Für ein vollständiges Server-Backup zusätzlich den Ordner `data/uploads/` und die benötigte Konfiguration getrennt sichern.