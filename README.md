# Exposé-Check

Prototyp eines konfigurierbaren Prüfassistenten für die formale Sichtung von Projekt-Exposés.
Die Anwendung prüft Exposé-Angaben gegen anpassbare Regeln und zeigt das Ergebnis je Exposé als Ampelstatus mit Begründung.

Entstanden im Rahmen einer Seminararbeit im Modul Web Technologie (WS 2026).

- Reines HTML, CSS und JavaScript – kein Backend, kein Build-Prozess
- Regeln und Exposé-Daten liegen als JSON-Dateien vor und werden per `fetch` geladen
- Alle Exposé-Daten sind synthetisch erzeugte Testdaten

## Starten

- **Online:** https://stackblitz.com/github/Davidxlhr/expose-check – StackBlitz installiert den statischen
  Server aus der `package.json` und startet ihn automatisch.
- **Lokal:** im Projektordner einen einfachen Webserver starten und die angezeigte Adresse im Browser öffnen:
  - `python3 -m http.server` (dann http://localhost:8000) oder
  - `npm install && npm start` (dann http://localhost:8080)

Ein Öffnen der `index.html` per Doppelklick (`file://`) funktioniert nicht, weil Browser Module und
`fetch` nur über HTTP laden.

**Bleibt StackBlitz bei „Mounting environment“ hängen?** Manche Browser-Erweiterungen (z. B. Krypto-Wallets)
stören die StackBlitz-Umgebung. Den Link dann in einem privaten Fenster öffnen; dort sind Erweiterungen
standardmäßig deaktiviert. Am zuverlässigsten läuft StackBlitz in Chromium-basierten Browsern.

> Projektstand: in Entwicklung
