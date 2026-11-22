# Tagespodcasts

NEUGIER erstellt Tagespodcasts auf dem Server. Der konfigurierte KI-Assistent schreibt einen Dialog auf Deutsch; Google Cloud Text-to-Speech vertont ihn. Die Stimmen sind als KI-Stimmen gekennzeichnet. Die Wiedergabe läuft beim Navigieren in der App weiter; auf Android ist Hintergrundwiedergabe und Mediensteuerung über die Media Session API möglich. Browser, Bildschirmsperre und Energiesparmodus können dies einschränken. Audio wird nicht offline gespeichert.

Zuschauer und Mitarbeiter starten einen verfügbaren Podcast in der Reiseübersicht, Mitarbeiter und Admins zusätzlich auf der Tagesseite. Nur Admins können einen Podcast über die Schaltfläche mit dem Aktualisierungssymbol neu erzeugen oder das Sprachmodell ändern. Eine laufende ältere Aufnahme bleibt während der Erzeugung verfügbar.

**Datenschutz:** Alle Podcast-Hörer erhalten dieselbe Aufnahme. Daher enthält der Kontext nur Reisename, Region, Tagesdatum, Tagestitel und Namen und Arten der Hauptrouten-Stopps. Tagesrouten-Stopps, Notizen, Buchungen, Termine, Kommentare und Ausgaben werden nicht übermittelt. Die verwendeten Inhalte werden an den eingestellten KI-Anbieter und der erzeugte Text an Google gesendet; bei aktiver Websuche können Suchanfragen zusätzlich an den Suchanbieter gehen. Vor der Aktivierung Nutzungsbedingungen und Datenschutz prüfen.

## Google Cloud einrichten

Diese Anleitung richtet beide Wege im selben Projekt ein: **Gemini 3.8 Flash TTS** über die Agent Platform API und **Gemini 3.1 Flash TTS Preview** über Cloud Text-to-Speech. Das Standardmodell ist 3.8. Für beide verwendet NEUGIER dieselbe Dienstkonto-Authentifizierung aus `.env`. Ein bestehender Google-Maps-Key oder ein Copilot-Abonnement ersetzt diese Zugangsdaten nicht.

**Kosten und Datenschutz:** Beide Modelle sind kostenpflichtig. Der kurze Test erzeugt einen echten API-Aufruf; beim Aktivieren des Workers können sofort Aufträge für alle vorhandenen Tage entstehen. Die Texte werden an Google übertragen. Vorher Preise, Budget und Datenschutzbedingungen prüfen.

### 1. Projekt und Abrechnung

1. [Google Cloud Console](https://console.cloud.google.com/) öffnen und anmelden. Oben über die Projektauswahl ein vorhandenes Projekt wählen oder **Neues Projekt** erstellen.
2. Die **Projekt-ID** notieren, nicht nur den Anzeigenamen oder die Projektnummer. Sie wird für `GOOGLE_CLOUD_PROJECT` benötigt.
3. Unter **Abrechnung** ein Abrechnungskonto mit dem Projekt verknüpfen. Unter **Budgets und Benachrichtigungen** ein Budget mit Warnungen einrichten. Eine Budgetwarnung stoppt die Nutzung nicht automatisch.

### 2. APIs aktivieren

1. In der Console sicherstellen, dass das richtige Projekt ausgewählt ist. Unter **APIs und Dienste → Bibliothek** die **Vertex AI API / Agent Platform API** (`aiplatform.googleapis.com`) suchen und aktivieren. Sie wird für Gemini 3.8 benötigt.
2. In derselben Bibliothek die **Cloud Text-to-Speech API** (`texttospeech.googleapis.com`) aktivieren. Sie wird für Gemini 3.1 benötigt.
3. Falls das Aktivieren verweigert wird, muss ein Projektadministrator die APIs freischalten. Die API-Verfügbarkeit kann sich je nach Projekt und Google-Angebot ändern.

### 3. Dienstkonto und Rollen

1. Unter **IAM und Verwaltung → Dienstkonten → Dienstkonto erstellen** ein Konto wie `neugier-podcast` anlegen.
2. Beim Erstellen oder anschließend unter **IAM** diesem Dienstkonto für das Projekt die Rolle **Agent Platform User / Vertex AI User** (`roles/aiplatform.user`) geben. Sie enthält `aiplatform.endpoints.predict`, das für die Modelle benötigt wird.
3. Falls das Abrechnungsprojekt nicht verwendet werden darf, zusätzlich **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`) auf dem verwendeten Projekt vergeben. Änderungen an Projektrollen erfordern entsprechende Administratorrechte.
4. Die E-Mail-Adresse des Dienstkontos notieren, etwa `neugier-podcast@PROJEKT-ID.iam.gserviceaccount.com`.

### 4. Schlüssel erstellen und schützen

1. Das Dienstkonto öffnen, den Tab **Schlüssel** wählen und **Schlüssel hinzufügen → Neuen Schlüssel erstellen → JSON** auswählen. Google lädt dabei einmalig eine JSON-Datei herunter. Falls eine Organisationsrichtlinie die Schlüsselerstellung verbietet, muss ein Administrator eine zulässige Authentifizierung einrichten; die Sperre nicht eigenmächtig umgehen.
2. Die Datei enthält `client_email` und `private_key`. Die Werte im nächsten Schritt direkt in `.env` übernehmen. NEUGIER benötigt danach **keine separate JSON-Datei**. Die heruntergeladene Datei anschließend nach den eigenen Sicherheitsrichtlinien entfernen oder getrennt sicher verwahren; sie lässt sich nicht erneut herunterladen.
3. Der private Schlüssel ist ein langlebiges Geheimnis. `.env` nicht committen, teilen, in Screenshots zeigen oder in Logs ausgeben. Die Datei ist durch `.gitignore` und `.dockerignore` ausgeschlossen. Nach dem Anlegen im nächsten Schritt den Dateizugriff einschränken.

Auch Container- und Host-Administratoren können Umgebungsvariablen auslesen. Bei Verdacht auf Offenlegung den Schlüssel in Google Cloud widerrufen und ersetzen. Für höhere Sicherheitsanforderungen empfiehlt Google [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) statt langlebiger Schlüssel; der bestehende ADC-Fallback bleibt dafür verfügbar, wenn die beiden `GOOGLE_TTS_*`-Zugangsdaten leer sind.

### 5. `.env` ausfüllen

Im Projektverzeichnis `.env` bearbeiten. Nur falls die Datei noch nicht existiert, zunächst `.env.example` nach `.env` kopieren. Diese Werte ergänzen, ohne bereits vorhandene Einstellungen zu überschreiben:

```dotenv
PODCAST_ENABLED=false
GOOGLE_CLOUD_PROJECT=deine-projekt-id
GOOGLE_TTS_CLIENT_EMAIL=neugier-podcast@deine-projekt-id.iam.gserviceaccount.com
GOOGLE_TTS_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nDEIN-SCHLUESSEL\n-----END PRIVATE KEY-----\n'
GOOGLE_TTS_AGENT_LOCATION=global
```

`GOOGLE_TTS_PRIVATE_KEY` muss den **vollständigen** Wert aus dem JSON-Feld `private_key` enthalten, einschließlich BEGIN/END-Zeilen. Die Zeichen `\n` bleiben als zwei Zeichen innerhalb **einer Zeile** stehen; die App wandelt sie in Zeilenumbrüche um. Das Beispiel enthält keinen gültigen Schlüssel. Keine zusätzlichen JSON-Anführungszeichen oder Kommata übernehmen. Bei lokal gesetzten gleichnamigen Umgebungsvariablen haben diese beim Beispielskript Vorrang vor `.env`.

Auf Linux den Zugriff auf die nun vorhandene Datei einschränken:

```bash
chmod 600 .env
```

Für 3.8 sind `global`, `eu` und `us` möglich; `eu` verwendet den EU-Multiregions-Endpunkt. Gemini 3.1 Preview wird unabhängig davon über den globalen Cloud-TTS-Endpunkt aufgerufen und ist laut [Google](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#available_regions) nicht über den EU-Endpunkt dieses Dienstes verfügbar. `global` garantiert keine EU-Datenresidenz. Bei verbindlichen regionalen Anforderungen die geltenden Google-Bedingungen vor Nutzung prüfen.

### 6. Beide Modelle unabhängig testen

Das Bash-Skript im Projektverzeichnis verwendet denselben TTS-Code wie die App, liest `.env` und schreibt einen kurzen vorgegebenen Dialog als MP3. Es benötigt **Node.js 24**, installierte Projektabhängigkeiten und **FFmpeg**. Falls Node 24 nicht im Pfad liegt, verwendet das Skript automatisch `nix-shell`. Im Projektverzeichnis:

```bash
./podcast-example.sh 3.8
./podcast-example.sh 3.1
```

Falls die Projektabhängigkeiten noch nicht installiert sind, zuvor `nix-shell --run 'npm install'` ausführen.

Die Ausgaben heißen `podcast-beispiel-3.8.mp3` und `podcast-beispiel-3.1.mp3` und lassen sich mit einem Audioplayer öffnen. Die Dateien werden nicht überschrieben; bei einem erneuten Test einen anderen Ausgabepfad als zweites Argument angeben, z. B. `./podcast-example.sh 3.8 /tmp/podcast-test.mp3`. Die generierten Standarddateien sind von Git ausgeschlossen. Für den Test ist `PODCAST_ENABLED=true` **nicht** nötig; es werden keine Reisedaten, kein LLM und keine Datenbank verwendet.

Alternativ mit Docker Compose, nachdem das Image mit `docker compose build neugier` aktualisiert wurde:

```bash
docker compose run --rm --no-deps neugier ./podcast-example.sh 3.8 /data/podcast-beispiel-3.8.mp3
docker compose run --rm --no-deps neugier ./podcast-example.sh 3.1 /data/podcast-beispiel-3.1.mp3
```

Die Dateien liegen dann auf dem Host unter `./data/`. Diese Einmal-Container starten keinen Podcast-Worker. Bei einem Fehler keine gültige MP3 erwarten; Fehlermeldung, API-Aktivierung und Dienstkontorollen prüfen.

### 7. App aktivieren

1. In **Admin → KI-Assistent** einen funktionierenden KI-Anbieter und dessen Zugangsdaten für die Skripterzeugung einrichten. Optional Websuche aktivieren.
2. In `.env` `PODCAST_ENABLED=true` setzen und den App-Container mit der aktualisierten Konfiguration neu erstellen. Die Tests oben haben bereits bestätigt, dass die beiden TTS-Wege mit den eingetragenen Zugangsdaten aufrufbar sind.
3. In **Admin → KI-Assistent → Podcast-Sprachmodell** `Gemini 3.8 Flash TTS` prüfen oder `Gemini 3.1 Flash TTS (Preview)` auswählen. Beim erstmaligen Upgrade wird die gespeicherte Modellwahl einmalig auf 3.8 gesetzt; vorhandene Audioaufnahmen werden dadurch nicht automatisch ersetzt. Danach bleibt eine selbst gewählte Modelländerung erhalten.

Beim Start mit `PODCAST_ENABLED=true` werden Tage ohne aktuelle Aufnahme automatisch vorgemerkt. Ohne diese Variable oder bei `false` startet die automatische Erzeugung nicht; vorhandene Aufnahmen bleiben abspielbar.

## Bedienung und Modellwahl

Unter **Admin → KI-Assistent** stehen Gemini 3.8 Flash und Flash Lite über Agent Platform sowie Gemini 3.1 Flash Preview und die 2.5-TTS-Modelle über Cloud Text-to-Speech zur Auswahl. Alternativ kann ein Modellname manuell eingegeben werden. Namen mit Präfix `gemini-3.8-` werden über Agent Platform aufgerufen, andere Namen über Cloud Text-to-Speech. Google muss das Modell am jeweiligen Endpunkt und im gewählten Projekt unterstützen; ein Modell mit anderem Anfrageformat wird durch die Eingabe allein nicht kompatibel.

Beim Speichern einer Modelländerung fragt die App, ob bestehende Aufnahmen behalten oder neu erzeugt werden sollen. Bei „behalten“ gilt das neue Modell für spätere Aufträge; bei „neu erzeugen“ werden vorhandene Aufnahmen serverseitig neu vorgemerkt. Abbrechen verwirft den Speichervorgang. `gemini-2.5-flash-lite-preview-tts` unterstützt nur Einzelsprecher: NEUGIER synthetisiert die Dialogbeiträge dort getrennt und fügt sie mit FFmpeg zusammen. Unbekannte manuelle Modelle werden als Multi-Speaker-Modell angesprochen.

Der Standard-Podcast-Prompt wurde beim Upgrade einmalig hart auf die aktuelle Zwei-Sprecher-Vorgabe gesetzt. Danach lässt er sich weiterhin im Adminbereich ändern. Ein leeres Feld verwendet den Standard. Der Skript-Prompt und die serverseitigen TTS-Stilvorgaben sind unterschiedlich. Für 3.8 überträgt NEUGIER die Sprecherbeiträge einzeln mit Stilmetadaten und wandelt die bekannten Tags in das 3.8-Format um; für 3.1 nutzt es die Google-Cloud-TTS-Tags. Die Wirkung kann unzuverlässig sein. Aussprache, besonders von Māori-Ortsnamen, und Fakten vor dem Vertrauen in den Podcast prüfen. Recherchequellen werden getrennt vom gesprochenen Text gespeichert; Google garantiert keine Fehlerfreiheit.

## Erzeugung und Speicherung

Ein Server-Worker bearbeitet jeweils einen Auftrag. Er erzeugt beim Start und nach Änderungen am freigegebenen Tageskontext oder Podcast-Prompt neue Aufnahmen. Änderungen nur an privaten Daten oder anderen Tagesrouten-Stopps verändern den Kontext nicht. Modelländerungen allein ersetzen bestehende Aufnahmen nur nach Bestätigung. Der Admin-Knopf erzwingt die Erzeugung eines Tages. Während eines Auftrags erneute Änderungen verdrängen das alte Ergebnis; ein alter Auftrag darf eine neuere Anforderung nicht veröffentlichen.

Aufträge und MP3-Daten liegen in der SQLite-Datenbank unter `DATA_DIR`; das Admin-Datenbankbackup enthält deshalb auch Podcasts und kann entsprechend größer werden. Die Wiederherstellung akzeptiert bis zu 1 GiB und benötigt zusätzlich temporären Speicherplatz. Nach einem Neustart werden unterbrochene Aufträge fortgesetzt. Fehler werden bis zu dreimal mit wachsendem Abstand versucht; danach kann ein Admin den Tag erneut anstoßen. Texte werden in Abschnitte von höchstens 3.800 UTF-8-Bytes aufgeteilt. Gemini 3.8 liefert WAV, das NEUGIER mit FFmpeg nach MP3 umwandelt; 3.1 liefert MP3. Mehrere Abschnitte werden mit FFmpeg zusammengefügt. Im Docker-Image und der Nix-Shell ist FFmpeg enthalten.

Audio wird nur über authentifizierte API-Endpunkte ausgeliefert, mit HTTP-Range-Unterstützung für Seek und `Cache-Control: private, no-store`. Der Service Worker speichert Podcast-Antworten nicht. Beim Abmelden oder Wechsel der Reise wird der Player beendet.

## Kosten und Fehlersuche

Laut [Google-Preisliste](https://cloud.google.com/text-to-speech/pricing), Stand 22. November 2026, kostet Gemini 3.1 Flash TTS Preview 1 USD pro Million Eingabetokens und 20 USD pro Million Audiotokens; es gibt dafür kein kostenloses Kontingent. Google rechnet 25 Audiotokens pro Sekunde: Fünf Minuten kosten etwa 0,15 USD für die Audioausgabe. Für 3.8 gelten eigene, zeitabhängige Preise. Hinzu kommen Eingabetokens, Skripterstellung, Websuche und Wiederholungen. Preise und Quoten vor Nutzung prüfen und ein Budget mit Warnungen setzen.

Fehlerdetails sind für Admins über den Podcast-Status sichtbar. Bei fehlender Wiedergabe prüfen: Ist `PODCAST_ENABLED=true` gesetzt und der Container neu erstellt? Sind KI-Zugangsdaten, Google-Projekt, Billing, APIs und IAM-Rollen gültig? Sind Dienstkonto-E-Mail und privater Schlüssel vollständig und ohne zusätzliche JSON-Anführungszeichen in `.env`? Unterstützt das Modell den jeweiligen Endpunkt? Bei `403` Berechtigungen und Projekt prüfen, bei `429` Quoten, bei `400` Modell und dessen unterstützte Parameter. FFmpeg wird für 3.8 und mehrteilige Ausgaben benötigt. Alte Aufnahmen bleiben bei einem Fehler erhalten und sind als ältere Aufnahme markiert.