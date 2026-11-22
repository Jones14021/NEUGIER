# Tagespodcasts

NEUGIER erstellt Tagespodcasts auf dem Server. Der konfigurierte KI-Assistent schreibt einen Dialog auf Deutsch; Google Cloud Text-to-Speech vertont ihn. Die Stimmen sind als KI-Stimmen gekennzeichnet. Die Wiedergabe läuft beim Navigieren in der App weiter; auf Android ist Hintergrundwiedergabe und Mediensteuerung über die Media Session API möglich. Browser, Bildschirmsperre und Energiesparmodus können dies einschränken. Audio wird nicht offline gespeichert.

Zuschauer und Mitarbeiter starten einen verfügbaren Podcast in der Reiseübersicht, Mitarbeiter und Admins zusätzlich auf der Tagesseite. Nur Admins können einen Podcast über die Schaltfläche mit dem Aktualisierungssymbol neu erzeugen oder das Sprachmodell ändern. Eine laufende ältere Aufnahme bleibt während der Erzeugung verfügbar.

**Datenschutz:** Alle Podcast-Hörer erhalten dieselbe Aufnahme. Daher enthält der Kontext nur Reisename, Region, Tagesdatum, Tagestitel und Namen und Arten der Hauptrouten-Stopps. Tagesrouten-Stopps, Notizen, Buchungen, Termine, Kommentare und Ausgaben werden nicht übermittelt. Die verwendeten Inhalte werden an den eingestellten KI-Anbieter und der erzeugte Text an Google gesendet; bei aktiver Websuche können Suchanfragen zusätzlich an den Suchanbieter gehen. Vor der Aktivierung Nutzungsbedingungen und Datenschutz prüfen.

## Google Cloud einrichten

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt auswählen und ein Abrechnungskonto verknüpfen. Die **Cloud Text-to-Speech API** aktivieren; für den Gemini-Modellzugriff gegebenenfalls auch die **Vertex AI API** aktivieren.
2. Ein Dienstkonto für NEUGIER anlegen. Laut [Google-Dokumentation](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts) benötigt es `aiplatform.endpoints.predict`, enthalten in `roles/aiplatform.user`. Für das Abrechnungsprojekt kann außerdem `serviceusage.services.use` nötig sein, enthalten in `roles/serviceusage.serviceUsageConsumer`. Rollen nur für dieses Konto vergeben. Bestehende Maps-API-Keys oder das Copilot-Abo ersetzen die Google-Cloud-Authentifizierung nicht.
3. [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) bereitstellen. Für externe Server ist [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) gegenüber langlebigen Schlüsseln vorzuziehen. Falls ein Dienstkontoschlüssel erforderlich ist, diesen geheim halten, nicht ins Repository übernehmen und nur für den Server lesbar bereitstellen. Ein Beispiel für Docker Compose ist eine geschützte Datei `./data/secrets/tts.json`; `./data` ist als `/data` in den App-Container eingebunden. Für Workload Identity Federation müssen die in der Konfigurationsdatei referenzierten externen Zugangsdaten ebenfalls im Container verfügbar sein.
4. In `.env` die Werte setzen. Der Pfad muss **im Container** gültig und vom Serverprozess lesbar sein:

```dotenv
PODCAST_ENABLED=true
GOOGLE_CLOUD_PROJECT=deine-projekt-id
GOOGLE_APPLICATION_CREDENTIALS=/data/secrets/tts.json
```

5. In **Admin → KI-Assistent** einen funktionierenden KI-Anbieter und dessen Zugangsdaten für die Skripterzeugung konfigurieren. Optional Websuche aktivieren. Dann die App mit der aktualisierten Konfiguration neu starten. Beim ersten Start mit `PODCAST_ENABLED=true` werden alle vorhandenen Tage automatisch vorgemerkt: Das kann sofort API-Kosten verursachen. Ohne diese Variable oder bei `false` startet die automatische Erzeugung nicht; vorhandene Aufnahmen bleiben abspielbar.

Das Modell `gemini-3.1-flash-tts-preview` nutzt derzeit den globalen Cloud-TTS-Endpunkt. Laut [Google](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#available_regions) ist es dort Preview und nicht am EU-Endpunkt verfügbar; `global` garantiert keine EU-Datenresidenz. NEUGIER verwendet auch bei anderen Modellnamen den globalen Endpunkt. Bei einer verbindlichen EU-Vorgabe diese Implementierung nicht verwenden, bevor eine passende regionale Anbindung eingerichtet ist.

## Bedienung und Modellwahl

Unter **Admin → KI-Assistent** stehen Gemini 3.1 Flash TTS Preview, Gemini 2.5 Flash TTS, Gemini 2.5 Flash Lite TTS Preview und Gemini 2.5 Pro TTS zur Auswahl. Alternativ kann ein Modellname manuell eingegeben werden. Google muss das Modell am globalen Cloud-TTS-Endpunkt und im gewählten Projekt unterstützen; eine andere API oder ein Modell mit anderem Anfrageformat wird durch die Eingabe allein nicht kompatibel.

Beim Speichern einer Modelländerung fragt die App, ob bestehende Aufnahmen behalten oder neu erzeugt werden sollen. Bei „behalten“ gilt das neue Modell für spätere Aufträge; bei „neu erzeugen“ werden vorhandene Aufnahmen serverseitig neu vorgemerkt. Abbrechen verwirft den Speichervorgang. `gemini-2.5-flash-lite-preview-tts` unterstützt nur Einzelsprecher: NEUGIER synthetisiert die Dialogbeiträge dort getrennt und fügt sie mit FFmpeg zusammen. Unbekannte manuelle Modelle werden als Multi-Speaker-Modell angesprochen.

Der Standard-Podcast-Prompt wurde beim Upgrade einmalig hart auf die aktuelle Zwei-Sprecher-Vorgabe gesetzt. Danach lässt er sich weiterhin im Adminbereich ändern. Ein leeres Feld verwendet den Standard. Der Skript-Prompt und der separate serverseitige TTS-Stil-Prompt sind unterschiedliche Einstellungen; letzterer steuert Ton, Tempo, Betonung und Aussprache. Tags wie `[laughing]`, `[sigh]`, `[uhm]`, `[short pause]` und `[whispering]` sind Google-Preview-Funktionen und können unzuverlässig sein oder gesprochen werden. Aussprache, besonders von Māori-Ortsnamen, und Fakten vor dem Vertrauen in den Podcast prüfen. Recherchequellen werden getrennt vom gesprochenen Text gespeichert; Google garantiert keine Fehlerfreiheit.

## Erzeugung und Speicherung

Ein Server-Worker bearbeitet jeweils einen Auftrag. Er erzeugt beim Start und nach Änderungen am freigegebenen Tageskontext oder Podcast-Prompt neue Aufnahmen. Änderungen nur an privaten Daten oder anderen Tagesrouten-Stopps verändern den Kontext nicht. Modelländerungen allein ersetzen bestehende Aufnahmen nur nach Bestätigung. Der Admin-Knopf erzwingt die Erzeugung eines Tages. Während eines Auftrags erneute Änderungen verdrängen das alte Ergebnis; ein alter Auftrag darf eine neuere Anforderung nicht veröffentlichen.

Aufträge und MP3-Daten liegen in der SQLite-Datenbank unter `DATA_DIR`; das Admin-Datenbankbackup enthält deshalb auch Podcasts und kann entsprechend größer werden. Die Wiederherstellung akzeptiert bis zu 1 GiB und benötigt zusätzlich temporären Speicherplatz. Nach einem Neustart werden unterbrochene Aufträge fortgesetzt. Fehler werden bis zu dreimal mit wachsendem Abstand versucht; danach kann ein Admin den Tag erneut anstoßen. Längere Texte werden unterhalb des Google-Limits von 4.000 UTF-8-Bytes pro Anfrage aufgeteilt und mit FFmpeg zusammengefügt. Im Docker-Image und der Nix-Shell ist FFmpeg enthalten.

Audio wird nur über authentifizierte API-Endpunkte ausgeliefert, mit HTTP-Range-Unterstützung für Seek und `Cache-Control: private, no-store`. Der Service Worker speichert Podcast-Antworten nicht. Beim Abmelden oder Wechsel der Reise wird der Player beendet.

## Kosten und Fehlersuche

Laut [Google-Preisliste](https://cloud.google.com/text-to-speech/pricing), Stand 22. November 2026, kostet Gemini 3.1 Flash TTS Preview 1 USD pro Million Eingabetokens und 20 USD pro Million Audiotokens; es gibt dafür kein kostenloses Kontingent. Google rechnet 25 Audiotokens pro Sekunde: Fünf Minuten kosten etwa 0,15 USD für die Audioausgabe, zuzüglich Eingabetokens, Skripterstellung, Websuche und Wiederholungen. Preise und Quoten vor Nutzung prüfen und ein Budget mit Warnungen setzen.

Fehlerdetails sind für Admins über den Podcast-Status sichtbar. Bei fehlender Wiedergabe prüfen: Ist `PODCAST_ENABLED=true` gesetzt und der Container neu gestartet? Sind KI-Zugangsdaten, Google-Projekt, Billing, APIs, IAM-Rollen und ADC im Container gültig? Unterstützt das ausgewählte Modell den globalen TTS-Endpunkt? Bei `403` Berechtigungen und Projekt prüfen, bei `429` Quoten, bei `400` Modell und dessen unterstützte Parameter. FFmpeg wird für mehrteilige Ausgaben benötigt. Alte Aufnahmen bleiben bei einem Fehler erhalten und sind als ältere Aufnahme markiert.