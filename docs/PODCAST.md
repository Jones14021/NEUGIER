# Tagespodcasts: Recherche und Entwurf

Stand: 22. November 2026. Dies ist ein Entwurf; Podcast-Erzeugung und Wiedergabe sind noch nicht implementiert. Die Vorgabe für den Podcast-Text kann bereits unter **Admin → KI-Assistent** bearbeitet werden.

## Empfehlung

Den vorhandenen KI-Anbieter zunächst ein strukturiertes Skript mit Quellen erzeugen lassen und anschließend einen austauschbaren serverseitigen Text-to-Speech-Anbieter für die Vertonung verwenden. Für einen ersten Prototyp würde ich Google Cloud Text-to-Speech mit einer deutschen Neural2- oder Studio-Stimme vergleichen: Das Projekt nutzt bereits Google Cloud, es gibt deutsche Stimmen und ein Node.js-SDK. Für längere Beiträge ist Azure Speech Batch Synthesis eine gut dokumentierte Alternative. Die tatsächliche Sprachqualität, Aussprache von Māori-Ortsnamen, Kosten und Latenz sollten mit denselben drei repräsentativen Tagen verglichen werden, bevor ein Anbieter festgelegt wird.

Die bestehende Copilot-Integration liefert Text; ein Copilot-Abonnement allein ist kein zugesagter Text-to-Speech-Zugang. Für die Stimme sind separate Zugangsdaten, Berechtigungen und gegebenenfalls ein eigener Abrechnungsvertrag erforderlich.

## Ablauf

1. Der Server erstellt beim Start und nach relevanten Änderungen einen Auftrag pro betroffenen Tag; nach einer Änderung der globalen Podcast-Vorgabe werden alle betroffenen Tage neu vorgemerkt. Der erste Abruf durch einen Client soll nicht die Generierung auslösen.
2. Der Auftrag liest einen festen, auf Zuschauerfreigabe geprüften Schnappschuss des Tages und seiner sortierten Stopps. Das LLM erstellt ein Skript und getrennte Quellenangaben. Recherche nur mit aktivierter und unterstützter Websuche; unsichere Behauptungen kennzeichnen, keine erfundenen Quellen.
3. Ein TTS-Adapter synthetisiert die Sprache. Lange Texte bei Bedarf an Satzgrenzen aufteilen; Reihenfolge und Aussprache erhalten und Ausgaben mit einem geeigneten Audio-Werkzeug wie FFmpeg zusammenfügen. Dateien im temporären Pfad schreiben und erst nach vollständiger Prüfung atomar veröffentlichen.
4. SQLite hält Fingerprint, Status, Quellenschnappschuss, Anbieter-/Stimmenmetadaten, Dauer, Dateipfad, Fehler und Zeitstempel. Audio liegt unter einem privaten Verzeichnis in `DATA_DIR`, nicht im öffentlich bereitgestellten Upload-Verzeichnis. Das bestehende Datenbank-Backup sichert Dateien nicht mit: Audio separat sichern oder als regenerierbaren Cache behandeln.
5. Ein authentifizierter Endpunkt liefert Metadaten und Audio für `viewer` und höher. Dateizugriff auf Trip und Tag prüfen; keine erratbaren öffentlichen Dateinamen. HTTP-Range-Requests und korrektes `audio/mpeg` ermöglichen Seek und robustes Streaming. Player mit Wiedergabe/Pause, Fortschritt, Dauer, Geschwindigkeit, Lade- und Fehlerzustand; AI-Stimme deutlich kennzeichnen.

## Wann neu erzeugen?

Den Fingerprint aus einer kanonischen JSON-Darstellung der **inhaltlichen** Tagesstopps in ihrer Reihenfolge und der globalen Podcast-Vorgabe bilden. Keine `updatedAt`-Felder, Karten-Cache-Zeitstempel, Kommentare, Ausgaben, andere Tage, Klicks oder Wiedergaben einbeziehen. Ein Stopp-Hinzufügen, Entfernen, Umordnen oder eine inhaltliche Änderung sowie eine geänderte Vorgabe erzeugen einen neuen Fingerprint; unveränderte Daten verwenden dieselbe Audiodatei. Beim Abschluss eines Auftrags den aktuellen Fingerprint erneut prüfen, damit ein alter Auftrag kein inzwischen geändertes Ergebnis veröffentlicht.

Offene Produktentscheidung: Datum, Tagestitel und Reiseregion beeinflussen das Skript ebenfalls. Sollen Änderungen daran ebenfalls neu erzeugen, müssen diese Werte Bestandteil des Fingerprints sein. Bei strikt ausschließlich Stopp-/Vorgaben-Änderungen bleiben solche Informationen dagegen bis zur nächsten entsprechenden Änderung möglicherweise veraltet. Änderungen an Stimme oder Modell sollten bestehende Dateien nicht ungefragt regenerieren; eine ausdrückliche Administratoraktion kann eine neue Version anstoßen.

Bei mehreren gleichzeitigen Änderungen Aufträge entprellen; für `(tripId, dayId, fingerprint)` nur einen Auftrag zulassen. Ein langlebiger SQLite-Jobstatus mit Lease, begrenzter Parallelität und Retry-Backoff übersteht Neustarts. Für die aktuelle Einzelcontainer-Installation reicht ein kleiner Worker im Serverprozess; eine zusätzliche Queue wie BullMQ/Redis wäre erst bei mehreren Worker-Instanzen sinnvoll. Nicht erfolgreicher Lauf behält die letzte fertige Version und zeigt sie als veraltet an. API- und Speicherkosten begrenzen; Status `queued`, `generating`, `ready`, `stale`, `failed` anzeigen.

## Berechtigungen und Offline-Nutzung

Die aktuelle Zuschauerrolle sieht bewusst keine Tagesplanung und kann die vorhandene Tagesansicht nicht öffnen. Für Podcasts braucht sie daher entweder eine eingeschränkte Tagesansicht oder einen Player in der Übersicht. Eine einzige, für alle Rollen abspielbare Audiodatei darf keine privaten Tagesnotizen, Buchungsdetails oder nur für Mitarbeiter sichtbaren Stopps verraten. Vor der Implementierung festlegen, welche Inhalte ausdrücklich für Zuschauer freigegeben sind; der Generator muss ausschließlich diese freigegebenen Daten und sichere Kontextinformationen verwenden.

Private Audioendpunkte dürfen nicht durch den generischen Service-Worker-API-Cache zwischen Konten geteilt werden. Offline-Abspielen wäre eine separate, explizite Download-Funktion mit nutzerbezogenem Cache, Größenbegrenzung und Löschmöglichkeit. Ohne diese Funktion spielt der Client bei bestehender Verbindung die fertige Datei vom Server ab. Niemals Keys oder vollständige private Reisedaten unnötig an Dritte übertragen; Anbieter, Region, Aufbewahrung und Datenschutz prüfen.

## Anbieter

| Option | Stärken | Zu prüfen |
| --- | --- | --- |
| [Google Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/voices) | Deutsche Neural2-/Studio-Stimmen, Node-SDK, vorhandene Cloud-Umgebung. | Eigene IAM-Zugangsdaten; [Long Audio](https://docs.cloud.google.com/text-to-speech/docs/create-audio-text-long-audio-synthesis) ist Preview und schreibt in einen Cloud-Storage-Bucket. Chirp 3 HD unterstützt laut Dokumentation kein SSML. |
| [Azure Speech Batch](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/batch-synthesis) | Allgemein verfügbar, asynchron, SSML, längere Beiträge; Ergebnis herunterladen und lokal speichern. | Azure-Ressource und Zugangsdaten; Anbieter nennt ungefähr 10–20 Sekunden Median und 120 Sekunden für 95 % der Ergebnisse. |
| [ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) | Ausgeprägte Stimmen, MP3-Ausgabe, Kontext zwischen Textabschnitten. | Separate Kosten und Datenschutzbedingungen; Funktionen und Formate hängen vom Tarif ab, Zero-Retention laut API-Dokumentation nur für Enterprise. |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | Lokale Synthese ohne TTS-Cloud; als separater Dienst oder Prozess denkbar. | CPU/RAM und Sprachqualität auf der Zielhardware messen; aktuelle Implementierung GPL-3.0, Stimmen haben eigene Lizenzen. |
| [OpenAI Audio](https://developers.openai.com/api/docs/guides/text-to-speech) | Deutsche Texte und MP3 unterstützt, einfache Integration. | Die dokumentierten Speech-Modelle `gpt-4o-mini-tts`, `tts-1` und `tts-1-hd` sollen am **6. Januar 2027** abgeschaltet werden; der empfohlene Nachfolger nutzt die Realtime-API statt desselben Speech-Endpunkts. Nicht auf die auslaufenden Modelle als langfristige Basis bauen. |

Kosten separat für Skript/Recherche, TTS-Zeichen, eventuelle Cloud-Speicherung und Netzwerk berechnen. Beispiel: 37 Tage × 4.500 Zeichen = 166.500 TTS-Zeichen pro vollständigem Durchlauf; multipliziert mit dem aktuellen Zeichenpreis des gewählten Tarifs. Änderungen und Retries erhöhen die Kosten. Bei 48 kbit/s benötigt ein fünfminütiger Beitrag ungefähr 1,8 MB Audio. Preise, Quoten und Datenresidenz vor der Umsetzung beim jeweiligen Anbieter prüfen.

## Testfälle vor Umsetzung

- Gleichzeitige Nutzer erhalten für denselben Fingerprint genau einen Auftrag und dieselbe fertige Datei.
- Änderungen an Stopps oder Vorgabe erzeugen nur die betroffenen neuen Versionen; irrelevante Änderungen und erneutes Abspielen nicht.
- Ein während der Generierung veränderter Tag kann kein veraltetes Ergebnis als aktuell veröffentlichen; Neustart und Fehler sind wiederaufnehmbar.
- Zuschauer dürfen freigegebene Audios hören, aber keine privaten Planungsdaten, Dateipfade oder fremde Reisen abrufen.
- Lange Texte, unterschiedliche Sprachen und Namen, Quellen, Zeitüberschreitungen, HTTP-Range-Requests und mobile Wiedergabe testen.