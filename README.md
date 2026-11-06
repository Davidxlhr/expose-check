# Exposé-Check

Prototyp eines konfigurierbaren Prüfassistenten für die formale Sichtung von Projekt-Exposés.
Die Anwendung prüft Exposé-Angaben gegen anpassbare Regeln und zeigt das Ergebnis je Exposé als Ampelstatus mit Begründung.
Sie zeigt Auffälligkeiten an. Bewertung und Entscheidung bleiben bei der Lehrperson.

Entstanden im Rahmen einer Seminararbeit im Modul Web Technologie (WS 2026).

- Reines HTML, CSS und JavaScript (ES-Module) – kein Framework, kein Backend, kein Build-Prozess
- Regeln (`data/regeln.json`) und Exposé-Angaben (`data/exposes.json`) werden per `fetch` geladen
- Alle Exposé-Daten und PDFs sind synthetisch erzeugte Testdaten; alle Personen sind erfunden

## Funktionen

- **Übersicht:** Tabelle aller Exposés mit Gesamtstatus (Symbol, Text und Farbe), Filter nach Status und
  eine SVG-Grafik der Statusverteilung.
- **Detailansicht:** Ergebnis je Regel mit Begründung im Format „Soll: … · Ist: …“, Quelle der Vorgabe,
  erfasste Angaben und PDF-Vorschau.
- **Regel-Editor:** Bezeichnung, Ergebnis bei Nichterfüllung, aktiv/inaktiv und die Parameter jeder Regel
  ändern; Regeln entfernen; neue Regeln der Typen Pflichtfeld und Anzahl hinzufügen; Katalogeinträge pflegen.
  Eingaben werden mit der Constraint Validation des Browsers und eigenen deutschen Meldungen geprüft.
  Die Vorschau zeigt sofort, wie sich eine Änderung auswirkt; „Prüfen und anwenden“ übernimmt sie.
- **Export und Import:** Der angewendete Regelsatz lässt sich als JSON-Datei herunterladen (`regeln-JJJJ-MM-TT.json`)
  und später wieder importieren, z. B. als Sicherung oder für ein anderes Semester. Eine Importdatei (höchstens
  200 KB) wird vollständig geprüft; bei Fehlern bleibt der bisherige Regelsatz unverändert und die Fehler werden
  mit ihrer Stelle angezeigt. „Auf Standard zurücksetzen“ lädt `regeln.json` neu.
- **Rückmeldung entwerfen:** In der Detailansicht steht ein bearbeitbarer Textvorschlag mit allen Verstößen und
  Hinweisen des Exposés (nur Formales, keine inhaltliche Bewertung). Er lässt sich in die Zwischenablage kopieren;
  eigene Änderungen bleiben bis zum Neuladen der Seite erhalten.
- **Theorieschwerpunkte:** Eine SVG-Grafik in der Übersicht zeigt, wie viele Personen welchen Schwerpunkt
  gewählt haben, mit allen Werten zusätzlich als Tabelle. Personen ohne, mit mehreren oder mit unbekanntem
  Schwerpunkt werden darunter einzeln genannt.
- **Fehlerfälle:** Fehlende oder ungültige JSON-Dateien und ein fehlerhafter Regelsatz führen zu einer
  verständlichen Meldung statt zu einer leeren Seite. Ist `regeln.json` nicht ladbar, kann ein Regelsatz aus
  einer Datei importiert werden.

## Aufbau

```
index.html         Grundgerüst, Statusbereich, <template>-Bausteine des Regel-Editors
css/stil.css       Gestaltung (hell/dunkel), Statusfarben und -symbole, Fokus, Fehlerzustand
js/main.js         Start, Zustand, Hash-Routing (#/liste, #/expose/E-01, #/regeln)
js/laden.js        Laden per fetch mit Fehlerbehandlung, PDF-Vorschau über eine Blob-URL
js/schema.js       Schemaprüfung des Regelsatzes, Feldschranken (einzige Quelle für Prüfung und Formular)
js/regeltypen.js   die sieben Regeltypen (pflichtfeld, anzahl, katalog, eindeutig, frist, umfang, muster)
js/auswertung.js   Prüf-Engine: Bedingungen, Ergebnisse, Gesamtstatus
js/werte.js        Pfade und Formatierung
js/ansichten.js    Übersicht, Detailansicht, SVG-Grafik
js/editor.js       Regel-Editor (Formular, Validierung, Fehlerübersicht, Hinzufügen/Entfernen)
js/editorlogik.js  Logik des Editors ohne DOM (neue Regeln, IDs, Meldungen)
js/speicher.js     Export und Import des Regelsatzes
data/              regeln.json, exposes.json
pdf/               synthetische Exposé-PDFs (nur Vorschau, der Inhalt wird nicht ausgewertet)
```

## Starten

- **Online:** https://stackblitz.com/github/Davidxlhr/expose-check – StackBlitz installiert den statischen
  Server aus der `package.json` und startet ihn automatisch.
- **Lokal:** im Projektordner einen einfachen Webserver starten und die angezeigte Adresse im Browser öffnen:
  - `python3 -m http.server` (dann http://localhost:8000) oder
  - `npm install && npm start` (dann http://localhost:8080)

Ein Öffnen der `index.html` per Doppelklick (`file://`) funktioniert nicht, weil Browser Module und
`fetch` nur über HTTP laden.

Unterstützt werden aktuelle Versionen von Chrome, Firefox und Safari (das Regex-Flag `v` setzt aktuelle
Browser voraus).

**Bleibt StackBlitz bei „Mounting environment“ hängen?** Manche Browser-Erweiterungen (z. B. Krypto-Wallets)
stören die StackBlitz-Umgebung. Den Link dann in einem privaten Fenster öffnen; dort sind Erweiterungen
standardmäßig deaktiviert. Am zuverlässigsten läuft StackBlitz in Chromium-basierten Browsern.

Der Regelsatz wird nicht im Browser gespeichert: Nach dem Neuladen der Seite gilt wieder `regeln.json`.
Eigene Regelsätze sichert man über den Export.

> Projektstand: Kernfunktionen vollständig (Prüfung, Übersicht, Detailansicht, Regel-Editor, Export/Import),
> dazu die Rückmeldungsvorlage und die Grafik der Theorieschwerpunkte.
