# Entwickleranleitung

## Start

Node.js 24 wird benötigt. Lokal `npm install` und `npm run dev` ausführen oder mit Docker `docker compose -f docker-compose.dev.yml up` starten. Die produktionsähnliche Variante startet mit `docker compose up -d --build` auf `http://localhost:8080`. Die Konfiguration kann in einer aus `.env.example` kopierten `.env` hinterlegt werden; Änderungen an ihr erfordern einen Neustart des Containers.

## Tailscale und feste HTTPS-Adresse

Die normale Compose-Konfiguration startet neben NEUGIER den offiziellen Tailscale-Container. Sie benötigt Docker Compose ab Version 2.17. Er meldet sich als `neugier` an und richtet automatisch **Tailscale Serve** auf HTTPS-Port 443 ein; der Proxy erreicht die App über `127.0.0.1:8080` im gemeinsamen Container-Netzwerk. Es ist weder Tailscale auf dem Host noch eine Portfreigabe im Router nötig. Der Sidecar verwendet Userspace-Networking und benötigt weder `/dev/net/tun` noch zusätzliche Netzwerk-Capabilities. `http://localhost:8080` auf dem Docker-Host bleibt unabhängig davon verfügbar.

### 1. Tailnet vorbereiten

1. In der [Tailscale-Admin-Konsole](https://console.tailscale.com/admin/dns) unter **DNS** MagicDNS und **HTTPS Certificates** aktivieren. Der Tailnet-DNS-Name steht auf derselben Seite. Zertifikatsnamen werden im öffentlichen Certificate-Transparency-Protokoll sichtbar; der Dienst selbst bleibt innerhalb des Tailnets.
2. Auf den Geräten, die NEUGIER verwenden sollen, Tailscale installieren und sie mit demselben Tailnet verbinden. [Access Controls](https://console.tailscale.com/admin/acls) müssen diesen Geräten Zugriff auf `neugier` erlauben.
3. Unter [Machines](https://console.tailscale.com/admin/machines) prüfen, dass der Name `neugier` nicht bereits von einem anderen Gerät verwendet wird. Bei einem Konflikt vergibt Tailscale möglicherweise `neugier-1`; das wäre eine andere Google-Origin.

### 2. Auth-Key erstellen und eintragen

1. Unter [Settings → Keys](https://console.tailscale.com/admin/settings/keys) einen Auth-Key erstellen. **Ephemeral deaktivieren**, damit das Gerät beim Stoppen nicht automatisch entfernt wird. Für eine einmalige Erstregistrierung genügt ein nicht wiederverwendbarer Key. Falls Device Approval aktiv ist, das Gerät anschließend in der Admin-Konsole freigeben oder einen entsprechend vorab autorisierten Key verwenden.
2. Falls noch keine `.env` existiert, `cp .env.example .env` ausführen. In `.env` eintragen:

	```dotenv
	TS_AUTHKEY=tskey-auth-DEIN-KEY
	```

	Den tatsächlichen Schlüssel direkt in der Datei eingeben, nicht in Chat, Git oder Screenshots. `.env` ist von Git und dem Docker-Build ausgeschlossen; Dateizugriff auf vertrauenswürdige Personen beschränken. Container-Umgebungsvariablen sind für Docker-Administratoren sichtbar.
3. Im Projektverzeichnis `docker compose up -d --build` ausführen. `docker compose logs tailscale` zeigt Anmelde- oder Serve-Fehler. Ohne Key und ohne bereits gespeicherten Gerätestatus kann die erstmalige Anmeldung nicht automatisch erfolgen; die App selbst bleibt lokal erreichbar.
4. Unter **Machines** das Gerät `neugier` und seinen vollständigen DNS-Namen prüfen. Alternativ `docker compose exec tailscale tailscale status --self` und `docker compose exec tailscale tailscale serve status` ausführen. Öffne auf einem Tailnet-Gerät die angezeigte HTTPS-Adresse, typischerweise `https://neugier.<tailnet>.ts.net`.

Die Registrierung liegt dauerhaft in `tailscale-state/`, nicht im App-Datenbank-Backup. `TS_AUTH_ONCE=true` verwendet diese Identität bei Container-Neustarts erneut; ein abgelaufener Auth-Key verhindert daher nicht automatisch einen normalen Neustart. Nach erfolgreicher Anmeldung kann der einmalige `TS_AUTHKEY` aus `.env` entfernt werden. Bei Geräte- oder Schlüsselablauf, Widerruf, verlorener Identität oder fehlender Freigabe ist eine erneute Autorisierung erforderlich.

Optional kann statt eines Auth-Keys ein [OAuth-Client-Secret](https://tailscale.com/kb/1215/oauth-clients#register-new-nodes-using-oauth-credentials) mit `auth_keys`-Berechtigung verwendet werden. Dazu das Secret mit `?ephemeral=false` als `TS_AUTHKEY` und einen dafür erlaubten Tag als `TS_EXTRA_ARGS=--advertise-tags=tag:neugier` setzen. Den Tag zuvor im Tailnet und beim OAuth-Client konfigurieren.

### 3. Google-Login und Karten für diese Adresse einrichten

1. In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) ein Projekt auswählen und den OAuth-Zustimmungsbildschirm konfigurieren. Solange die App im Testmodus ist, die Google-Konten der Mitreisenden als Testnutzer hinzufügen.
2. Einen OAuth-Client vom Typ **Webanwendung** erstellen. Unter **Autorisierte JavaScript-Quellen** die vollständige Tailscale-Origin ohne Pfad und ohne abschließenden Schrägstrich eintragen, beispielsweise `https://neugier.mein-tailnet.ts.net`. Optional `http://localhost:8080` für lokalen Zugriff ergänzen. Die tatsächliche Origin aus Schritt 2 verwenden; `https://neugier` allein reicht für HTTPS nicht aus.
3. Die Client-ID in `.env` als `GOOGLE_CLIENT_ID` setzen, `DEV_LOGIN=false` belassen und die eigene Google-Adresse unter `ADMIN_EMAILS` eintragen. Anschließend `docker compose up -d --build` ausführen und die Google-Anmeldung über die HTTPS-Adresse testen.
4. Für den Browser-Maps-Key unter **Anwendungseinschränkungen → Websites** den passenden Referrer eintragen, z. B. `https://neugier.mein-tailnet.ts.net/*`; für lokale Tests bei Bedarf zusätzlich `http://localhost:8080/*`. Die APIs und separaten Server-Key wie im nächsten Abschnitt konfigurieren.

**Wichtig:** Ohne `GOOGLE_CLIENT_ID` ist der Dev-Login ohne Passwort aktiv, selbst wenn `DEV_LOGIN=false` gesetzt ist. Tailscale ersetzt keine App-Authentifizierung: Jeder Tailnet-Nutzer mit Zugriff könnte sich dann mit einer beliebigen E-Mail als Admin ausgeben. Vor der Freigabe Google-Login und passende Tailscale-Access-Controls einrichten. Serve ist nur im Tailnet erreichbar; diese Konfiguration aktiviert ausdrücklich **kein Funnel**.

### 4. Feste Adresse erhalten und umziehen

Die Origin bleibt beim Neustart und beim Umzug auf einen anderen Host gleich, solange dasselbe Tailnet, derselbe DNS-Name und die erhaltene Geräteidentität verwendet werden. `tailscale-state/` enthält private Schlüssel: geschützt und getrennt vom App-Container sichern; der Ordner ist von Git und dem Docker-Build ausgeschlossen. Auch `data/` und die benötigten `.env`-Werte separat sichern.

Für einen Umzug zuerst die gesamte Anwendung mit `docker compose stop` stoppen, damit auch die SQLite-Dateien konsistent sind. Beispiel für ein Archiv, falls Docker die Verzeichnisse als root angelegt hat:

```sh
sudo tar -C "$PWD" -czf "$HOME/neugier-umzug.tar.gz" data tailscale-state
sudo chmod 600 "$HOME/neugier-umzug.tar.gz"
```

Das Archiv enthält private Schlüssel und Reisedaten; es ist **nicht verschlüsselt**. Es nur geschützt übertragen und aufbewahren. Auf dem neuen Host das Repository bereitstellen, das Archiv im Projektverzeichnis mit `sudo tar -xzf "$HOME/neugier-umzug.tar.gz" -C "$PWD"` auspacken, die benötigten `.env`-Werte separat sicher übertragen und `docker compose up -d --build` starten. **Dieselbe Tailscale-Identität nie gleichzeitig auf zwei Hosts betreiben.** Anschließend den tatsächlichen DNS-Namen und die HTTPS-Verbindung prüfen. Wenn statt der gespeicherten Identität ein neues Gerät registriert wird oder `neugier` bereits belegt ist, kann sich der Name ändern; dann den Konflikt in der Tailscale-Admin-Konsole lösen und die tatsächlich angezeigte Origin in Google prüfen. Tailnet-Wechsel oder Änderung des Tailnet-DNS-Namens ändern die Origin ebenfalls.

### Fehlerdiagnose

* Sidecar startet nicht oder meldet `invalid key`: Key prüfen, bei Bedarf neu erstellen und `docker compose up -d` erneut ausführen. Den Schlüssel nicht in Logs oder Support-Anfragen veröffentlichen.
* Gerät erscheint, aber ist nicht erreichbar: Gerätefreigabe, Access Controls, MagicDNS, HTTPS und Tailscale-Verbindung des Clients prüfen; `docker compose logs tailscale` und `docker compose exec tailscale tailscale serve status` helfen bei der Diagnose.
* Google meldet `origin_mismatch`: Die vollständige Origin aus der Adresszeile muss exakt im OAuth-Client stehen. Google-Einstellungen können etwas Zeit zur Übernahme benötigen.
* Der Proxy zeigt 502: `docker compose ps` und `docker compose logs neugier` prüfen. Der Serve-Proxy erwartet die App auf Port 8080; `PORT` nicht abweichend setzen, ohne auch `tailscale/serve.json` und die Portzuordnung anzupassen.

## Google-Anmeldung und Karten

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt und gegebenenfalls ein Abrechnungskonto einrichten.
2. Unter [APIs und Dienste](https://console.cloud.google.com/apis/library) die Maps JavaScript API, Routes API und Places API (New) aktivieren. Im Bereich [Zugangsdaten](https://console.cloud.google.com/apis/credentials) API-Keys erstellen.
3. `GOOGLE_MAPS_API_KEY` für die Maps JavaScript API auf die verwendeten HTTP-Referrer und APIs beschränken. Für `GOOGLE_MAPS_SERVER_KEY` einen separaten Key mit API-Einschränkungen auf Routes API und Places API (New) verwenden. **Diesen Server-Key nicht auf Websites/HTTP-Referrer beschränken:** Die Anfragen kommen vom Server und haben keinen Browser-Referrer. Für einen unabhängig von der ausgehenden IP betreibbaren Server bei Anwendungseinschränkungen **Keine** wählen. Dieser Key kann bei einem Leak von anderen verwendet werden: geheim halten, API-Quotas und Abrechnungswarnungen einrichten und bei Verdacht sofort rotieren. Optional eine `GOOGLE_MAPS_MAP_ID` setzen.
4. Für Google-Login einen OAuth-Client vom Typ Webanwendung erstellen und die tatsächlichen Origins, zum Beispiel `http://localhost:8080` und die Tailscale-URL, als autorisierte JavaScript-Quellen eintragen. Die Client-ID in `GOOGLE_CLIENT_ID` setzen und gegebenenfalls `ADMIN_EMAILS` konfigurieren.

Ohne `GOOGLE_CLIENT_ID` ist der ungeschützte Dev-Login aktiv. Nicht öffentlich betreiben; für den Zugriff über Tailscale Google-Login und geeignete Zugriffskontrollen konfigurieren. Maps- und API-Aufrufe können Kosten verursachen; Quotas und Abrechnung beim Anbieter prüfen.

Wenn Google `API_KEY_HTTP_REFERRER_BLOCKED` oder `Requests from referer <empty> are blocked` für Places oder Routes meldet, ist der Server-Key fälschlich mit einer Website-Einschränkung versehen. Die Anwendungseinschränkung korrigieren, eine eventuelle Google-Übernahmezeit abwarten und NEUGIER neu starten. Fehlende Stopp-Koordinaten werden beim Start mit Places nachgeschlagen; Ergebnisse können ungenau sein und sollten geprüft werden.

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

## Orte von Android teilen

NEUGIER auf Android mit einem unterstützten Browser wie Chrome als App installieren. Danach kann beim Teilen eines Textes oder Google-Maps-Links NEUGIER im Android-Teilen-Menü erscheinen. Der Dialog übernimmt den Ort erst nach Bestätigung als Idee oder Tagesstopp. Die Funktion hängt von Browser und Installation ab; Firefox und iOS unterstützen dieses Share-Target nicht. Google-Maps-Kurzlinks werden nur über erlaubte Google-Hosts aufgelöst. Nicht auflösbare Links bleiben gespeichert und der Ort kann nachträglich im Stopp-Editor gesucht werden.