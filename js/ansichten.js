// Ansichten (View): erzeugen aus Regelsatz, Exposés und Prüfergebnissen semantisches HTML und SVG.
// Kein Zustand außer der laufenden PDF-Vorschau; Ereignisse verarbeitet main.js (Controller).

import { AMPEL_TEXT, GESAMTSTATUS, anzeigeMitKatalog, begruendung, ergebnisText, sortiereErgebnisse } from "./auswertung.js";
import { istPdfPfad, ladePdf } from "./laden.js";
import { anzahlText, datumAnzeigen, elementBezeichnung, istIsoDatumZeit, istLeer, wertAmPfad, wertAnzeigen, zahlAnzeigen } from "./werte.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- DOM-Hilfen ----------

// Erzeugt ein Element: el("p", { class: "x" }, "Text", kindElement). null/false/undefined werden übersprungen.
export function el(tag, attribute = {}, ...kinder) {
  const knoten = document.createElement(tag);
  setzeAttribute(knoten, attribute);
  knoten.append(...kinder.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return knoten;
}

function svg(tag, attribute = {}, ...kinder) {
  const knoten = document.createElementNS(SVG_NS, tag);
  setzeAttribute(knoten, attribute);
  knoten.append(...kinder.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return knoten;
}

function setzeAttribute(knoten, attribute) {
  for (const [name, wert] of Object.entries(attribute)) {
    if (wert === null || wert === undefined || wert === false) continue;
    knoten.setAttribute(name, wert === true ? "" : String(wert));
  }
}

// Statussymbol aus dem Sprite in index.html; immer aria-hidden, der Text steht daneben (A-09).
export function symbol(name, klasse = "symbol") {
  return svg("svg", { class: klasse, "aria-hidden": "true", focusable: "false" }, svg("use", { href: `#symbol-${name}` }));
}

// Status als Symbol + Text + Farbe (dreifach kodiert, Konzept 6.1).
function statusAnzeige(status, text, plakette = false) {
  return el("span", { class: `status status-${status}${plakette ? " status-plakette" : ""}` }, symbol(status), el("span", {}, text));
}

// <time datetime> nur mit gültigem ISO-Wert; ein Wert im falschen Format erscheint als Text (S-1 b).
function zeitAnzeige(iso, { zweizeilig = true } = {}) {
  if (istLeer(iso)) return el("span", { class: "nicht-angegeben" }, "nicht angegeben");
  if (!istIsoDatumZeit(iso)) return el("span", { class: "nicht-pruefbar" }, `${wertAnzeigen(iso)} (Format ungültig)`);
  if (!zweizeilig) return el("time", { datetime: iso }, datumAnzeigen(iso));
  const datum = datumAnzeigen(iso.slice(0, 10));
  const uhrzeit = iso.length > 10 ? `${iso.slice(11, 16)} Uhr` : null;
  return el("time", { datetime: iso }, datum, uhrzeit && el("span", { class: "uhrzeit" }, uhrzeit));
}

function ansichtKopf(titel, einleitung) {
  return el("div", { class: "ansicht-kopf" },
    el("h1", { tabindex: "-1" }, titel),
    einleitung && el("p", { class: "einleitung" }, einleitung));
}

// ---------- Kopf und Fuß ----------

// Kopf und Fuß; kennzeichen = { text, art } aus main.js („Standard“, „Geändert“, „Geändert – nicht exportiert“).
export function zeigeRahmen(regelsatz, exposeDatei, kennzeichen = null) {
  const info = document.querySelector("#regelsatz-info");
  if (regelsatz) {
    info.replaceChildren("Regelsatz:", el("strong", {}, regelsatz.name),
      el("span", { class: `marke-kennzeichen marke-${kennzeichen?.art ?? "standard"}` }, kennzeichen?.text ?? "Standard"));
    info.hidden = false;
    document.querySelector("#fuss-regelsatz").textContent =
      `Regelsatz „${regelsatz.name}“, Stand ${datumAnzeigen(regelsatz.stand)}. Quelle: ${regelsatz.quelle}.`;
  } else {
    info.hidden = true;
    document.querySelector("#fuss-regelsatz").textContent = "";
  }
  document.querySelector("#fuss-herkunft").textContent =
    exposeDatei ? `Datenherkunft: ${exposeDatei.meta.herkunft}` : "";
}

export function markiereNavigation(ansicht) {
  for (const link of document.querySelectorAll(".hauptnavigation a")) {
    const ziel = link.dataset.ansicht;
    if (ziel === ansicht) link.setAttribute("aria-current", "page");
    else if (ziel === "liste" && ansicht === "detail") link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

// Ein Scrollbereich braucht nur dann einen Tab-Stopp, wenn er tatsächlich scrollt (sonst ein überflüssiger
// Halt in der Fokusreihenfolge). Aufruf nach jedem Rendern und bei Größenänderung des Fensters.
export function aktualisiereScrollbereiche(ziel) {
  for (const bereich of ziel.querySelectorAll(".tabelle-rahmen")) {
    if (bereich.scrollWidth > bereich.clientWidth) bereich.setAttribute("tabindex", "0");
    else bereich.removeAttribute("tabindex");
  }
}

// ---------- Laden und Fehler ----------

export function zeigeLaden(ziel) {
  ziel.replaceChildren(el("p", { class: "laden" }, "Regeln und Exposés werden geladen …"));
}

// Meldungsbox für Ladefehler: was passiert ist, wo, was man tun kann (Konzept 6.6).
function fehlerBox(fehler, beiErneutLaden, importAnbieten) {
  const titel = fehler.titel ?? "Beim Laden ist ein unerwarteter Fehler aufgetreten.";
  const liste = fehler.fehlerliste ?? [];
  const gezeigt = liste.slice(0, 10);
  return el("section", { class: "meldung meldung-fehler", role: "alert", "aria-labelledby": "fehler-titel" },
    el("h2", { class: "meldung-titel", id: "fehler-titel" }, symbol("verletzt"), el("span", {}, titel)),
    fehler.text && el("p", {}, fehler.text),
    gezeigt.length > 0 && el("ul", { class: "fehlerliste", "aria-label": "Gefundene Fehler" },
      gezeigt.map((f) => el("li", {}, f)),
      liste.length > 10 && el("li", {}, `… und ${liste.length - 10} weitere`)),
    el("p", {}, fehler.hilfe ?? "Bitte die Seite neu laden. Details stehen in der Browser-Konsole."),
    el("div", { class: "meldung-aktionen" },
      beiErneutLaden && knopf("Erneut laden", beiErneutLaden)),
    importAnbieten && importBereich(importAnbieten));
}

// F-1: Ist regeln.json nicht ladbar, lässt sich ein Regelsatz aus einer Datei importieren.
function importBereich(importAnbieten) {
  const platz = el("div", { class: "meldung-import" },
    el("h3", {}, "Oder: Regelsatz aus einer Datei importieren"),
    el("p", { class: "leise" }, "Zum Beispiel eine früher exportierte Datei. Sie wird vor der Übernahme vollständig geprüft."));
  importAnbieten(platz);
  return platz;
}

function knopf(text, beiKlick, klasse = "knopf") {
  const k = el("button", { type: "button", class: klasse }, text);
  k.addEventListener("click", beiKlick);
  return k;
}

export function zeigeLadefehler(ziel, titel, fehlerListe, beiErneutLaden, importAnbieten = null) {
  ziel.replaceChildren(ansichtKopf(titel), ...fehlerListe.map((f, i) => {
    const box = fehlerBox(f, i === 0 ? beiErneutLaden : null, f.datei === "regeln.json" ? importAnbieten : null);
    if (i > 0) box.classList.add("abstand-oben");
    // IDs eindeutig halten, wenn beide Dateien fehlerhaft sind.
    box.setAttribute("aria-labelledby", `fehler-titel-${i}`);
    box.querySelector(".meldung-titel").id = `fehler-titel-${i}`;
    return box;
  }));
}

export function zeigeNichtGefunden(ziel, titel, text) {
  ziel.replaceChildren(
    ansichtKopf(titel),
    el("section", { class: "meldung", "aria-labelledby": "nicht-gefunden" },
      el("h2", { class: "meldung-titel", id: "nicht-gefunden" }, text),
      el("p", {}, el("a", { href: "#/liste" }, "Zur Übersicht"))));
}

// ---------- Übersicht ----------

const FILTER = [
  { wert: "alle", text: "Alle" },
  { wert: "verletzt", text: AMPEL_TEXT.verletzt },
  { wert: "hinweis", text: AMPEL_TEXT.hinweis },
  { wert: "ok", text: AMPEL_TEXT.ok },
];

// Sortierung der Übersicht: Verstöße zuerst, dann Hinweise, dann der Rest; innerhalb nach ID.
export function sortiereExposes(exposes, pruefungen) {
  const rang = (e) => GESAMTSTATUS.indexOf(pruefungen.get(e.id).gesamt);
  return [...exposes].sort((a, b) => rang(a) - rang(b) || a.id.localeCompare(b.id, "de", { numeric: true }));
}

export function filtereExposes(sortiert, pruefungen, filter) {
  return filter === "alle" ? sortiert : sortiert.filter((e) => pruefungen.get(e.id).gesamt === filter);
}

// Eigenständige SVG-Grafik der Statusverteilung (A-12): Balkenbreiten in Prozent, damit die Schrift
// bei jeder Breite gleich groß bleibt; Zahlen stehen zusätzlich als Text an jedem Balken.
function statusGrafik(anzahl, gesamt) {
  const zeilenHoehe = 54;
  const hoehe = GESAMTSTATUS.length * zeilenHoehe;
  const beschreibung = GESAMTSTATUS.map((s) => `${AMPEL_TEXT[s]}: ${anzahl[s]}`).join(", ");
  const zeilen = GESAMTSTATUS.map((status, i) => {
    const y = i * zeilenHoehe;
    const anteil = gesamt > 0 ? (anzahl[status] / gesamt) * 100 : 0;
    const zeichen = symbol(status, `zeichen-${status}`);
    setzeAttribute(zeichen, { x: 0, y: y + 2, width: 18, height: 18 });
    return svg("g", {},
      zeichen,
      svg("text", { x: 28, y: y + 16 }, AMPEL_TEXT[status]),
      svg("text", { x: "100%", y: y + 16, "text-anchor": "end" },
        svg("tspan", { class: "grafik-zahl" }, String(anzahl[status])),
        svg("tspan", { class: "grafik-anteil", dx: 6 }, `${Math.round(anteil)} %`)),
      svg("rect", { class: "balken-spur", x: 0, y: y + 26, width: "100%", height: 10, rx: 5 }),
      anzahl[status] > 0 && svg("rect", { class: `balken-${status}`, x: 0, y: y + 26, width: `${anteil}%`, height: 10, rx: 5 }));
  });
  return svg("svg", {
    class: "grafik-svg", role: "img", width: "100%", height: hoehe,
    "aria-labelledby": "grafik-titel grafik-beschreibung",
  },
  svg("title", { id: "grafik-titel" }, "Gesamtstatus der Exposés"),
  svg("desc", { id: "grafik-beschreibung" }, `${gesamt} Exposés. ${beschreibung}.`),
  zeilen);
}

// ---------- Ausbaustufe A-31: Verteilung der Theorieschwerpunkte ----------

// Bricht einen Text an Wortgrenzen in Zeilen von höchstens `max` Zeichen. SVG-Text bricht nicht selbst um;
// feste Zeilen halten die Beschriftung auch bei 320 px Breite innerhalb der Grafik (Reflow, WCAG 1.4.10).
export function umbrechen(text, max) {
  const zeilen = [];
  for (const wort of text.split(" ")) {
    const letzte = zeilen.at(-1);
    if (letzte !== undefined && `${letzte} ${wort}`.length <= max) zeilen[zeilen.length - 1] = `${letzte} ${wort}`;
    else zeilen.push(wort);
  }
  return zeilen;
}

// Eigenständige SVG-Grafik: ein Balken je Katalogeintrag. Die Balken sind auf den größten Wert skaliert;
// Nummer, Bezeichnung und Anzahl stehen als Text an jedem Balken, die Grafik braucht also keine Farbe zum Lesen.
function schwerpunktGrafik(verteilung) {
  const maximum = Math.max(1, ...verteilung.eintraege.map((e) => e.anzahl));
  let y = 0;
  const zeilen = verteilung.eintraege.map((eintrag) => {
    // Nummer vor die erste Zeile setzen, statt sie mit umzubrechen (sonst stünde „7 –“ allein in einer Zeile).
    const beschriftung = umbrechen(eintrag.text, 28);
    beschriftung[0] = `${eintrag.wert} – ${beschriftung[0]}`;
    const oben = y;
    const balkenY = oben + beschriftung.length * 18 + 6;
    y = balkenY + 10 + 18;
    return svg("g", {},
      svg("text", { x: 0, y: oben + 14 },
        beschriftung.map((teil, i) => svg("tspan", { x: 0, dy: i === 0 ? 0 : 18 }, teil))),
      svg("text", { x: "100%", y: oben + 14, "text-anchor": "end", class: "grafik-zahl" }, String(eintrag.anzahl)),
      svg("rect", { class: "balken-spur", x: 0, y: balkenY, width: "100%", height: 10, rx: 5 }),
      eintrag.anzahl > 0 && svg("rect", { class: "balken-schwerpunkt", x: 0, y: balkenY, width: `${(eintrag.anzahl / maximum) * 100}%`, height: 10, rx: 5 }));
  });
  const haeufigste = verteilung.eintraege.filter((e) => e.anzahl === maximum && maximum > 0).map((e) => e.wert);
  return svg("svg", {
    class: "grafik-svg", role: "img", width: "100%", height: y,
    "aria-labelledby": "schwerpunkte-grafik-titel schwerpunkte-grafik-beschreibung",
  },
  svg("title", { id: "schwerpunkte-grafik-titel" }, "Personen je Theorieschwerpunkt"),
  svg("desc", { id: "schwerpunkte-grafik-beschreibung" },
    `${verteilung.personenGueltig} Personen mit gültigem Schwerpunkt auf ${verteilung.eintraege.length} Schwerpunkte verteilt; ` +
    `am häufigsten: ${haeufigste.length > 0 ? `Nummer ${haeufigste.join(", ")} mit je ${maximum}` : "keiner"}. Alle Werte stehen in der Tabelle unter der Grafik.`),
  zeilen);
}

function sonderfallText(verteilung) {
  const { ohne, mehrere, unbekannt } = verteilung.sonderfaelle;
  const liste = (faelle, art) => faelle.map((f) => `${f.person} (${f.expose}${f.werte.length ? `: ${f.werte.map(wertAnzeigen).join(", ")}` : ""}) ${art}`);
  const teile = [...liste(ohne, "ohne Schwerpunkt"), ...liste(mehrere, "mit mehreren Schwerpunkten"), ...liste(unbekannt, "mit einem Schwerpunkt außerhalb des Katalogs")];
  if (teile.length === 0) return "Alle Personen haben genau einen Schwerpunkt aus dem Katalog angegeben.";
  return `Nicht im Diagramm: ${teile.join("; ")}.`;
}

// Textalternative: Die Grafik hat einen kurzen Namen und eine Zusammenfassung (role="img", title, desc).
// Die vollständigen Werte stehen zusätzlich in einer echten Datentabelle in <details>. Entscheidung:
// sichtbar aufklappbar statt visuell versteckt – so nützt die Tabelle auch Sehenden (genaue Zahlen,
// Vergrößerung) und ist mit Tabellennavigation des Screenreaders lesbar.
function schwerpunktAbschnitt(verteilung) {
  const tabelle = el("table", { class: "tabelle tabelle-kompakt" },
    el("caption", {}, "Personen je Theorieschwerpunkt"),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col" }, "Nr."),
      el("th", { scope: "col" }, "Theorieschwerpunkt"),
      el("th", { scope: "col", class: "rechts" }, "Personen"))),
    el("tbody", {}, verteilung.eintraege.map((e) => el("tr", {},
      el("td", { class: "zahl" }, String(e.wert)),
      el("th", { scope: "row" }, e.text),
      el("td", { class: "zahl rechts" }, String(e.anzahl))))),
    el("tfoot", {}, el("tr", {},
      el("td", {}, ""),
      el("th", { scope: "row" }, "Summe"),
      el("td", { class: "zahl rechts" }, String(verteilung.personenGueltig)))));

  return el("section", { class: "karte abstand-oben-gross", "aria-labelledby": "schwerpunkte-titel" },
    el("div", { class: "karte-kopf" },
      el("h2", { id: "schwerpunkte-titel" }, "Theorieschwerpunkte"),
      el("span", { class: "leise zahl" }, `${verteilung.personenGueltig} von ${verteilung.personen} Personen`)),
    el("div", { class: "karte-inhalt schwerpunkte" },
      el("figure", { class: "grafik" },
        schwerpunktGrafik(verteilung),
        el("figcaption", {}, "Anzahl Personen je Schwerpunkt über alle Exposés. Gezählt wird, wer genau einen Schwerpunkt aus dem Katalog angegeben hat.")),
      el("p", { class: "karte-fussnote" }, sonderfallText(verteilung)),
      el("details", { class: "werte-klappe" },
        el("summary", {}, "Werte als Tabelle"),
        el("div", { class: "tabelle-rahmen" }, tabelle))));
}

function legende() {
  const eintraege = [
    ["verletzt", "Verstoß", "Eine Vorgabe ist nicht erfüllt."],
    ["hinweis", "Hinweis", "Auffällig, aber keine feste Vorgabe – bitte ansehen."],
    ["ok", "Erfüllt", "Die Angabe entspricht der Vorgabe."],
    ["inaktiv", "Entfällt / nicht prüfbar", "Regel gilt hier nicht oder die Angabe fehlt; zählt nicht für den Status."],
  ];
  return el("section", { class: "karte", "aria-labelledby": "legende-titel" },
    el("div", { class: "karte-kopf" }, el("h2", { id: "legende-titel" }, "So lesen Sie die Ergebnisse")),
    el("div", { class: "karte-inhalt legende" },
      el("ul", { class: "legende-liste" },
        eintraege.map(([status, text, erklaerung]) =>
          el("li", {}, statusAnzeige(status, text), el("span", { class: "leise" }, erklaerung)))),
      el("p", { class: "karte-fussnote" },
        "Geprüft werden nur die erfassten Angaben, nicht der Inhalt der PDF-Datei. Der Gesamtstatus richtet sich nach dem schlechtesten Einzelergebnis.")));
}

function mitgliederZelle(expose, regelsatz) {
  const listenFeld = regelsatz.felder.find((f) => f.pfad === "mitglieder");
  const mitglieder = expose.mitglieder;
  if (!Array.isArray(mitglieder) || mitglieder.length === 0) return el("span", { class: "nicht-angegeben" }, "keine Angabe");
  return el("ul", { class: "mitglieder-liste" }, mitglieder.map((m, i) => {
    const name = elementBezeichnung(listenFeld, m, i);
    const ohneName = istLeer(m?.name);
    return el("li", { class: ohneName ? "ohne-name" : null }, name);
  }));
}

// „nicht prüfbar“ steht mit dabei, ändert aber den Gesamtstatus nicht (S-1 a).
function auffaelligkeitenText(zaehler) {
  const teile = [];
  if (zaehler.verletzt > 0) teile.push(anzahlText(zaehler.verletzt, "Verstoß", "Verstöße"));
  if (zaehler.hinweis > 0) teile.push(anzahlText(zaehler.hinweis, "Hinweis", "Hinweise"));
  const nichtPruefbar = zaehler.nichtPruefbar > 0 && el("span", { class: "nicht-pruefbar" }, `${zaehler.nichtPruefbar} nicht prüfbar`);
  if (teile.length === 0) return nichtPruefbar || el("span", { class: "leise" }, "keine");
  return [teile.join(", "), nichtPruefbar && [", ", nichtPruefbar]];
}

// Datenhinweis (S-1 b): Angaben im falschen Format machen Regeln „nicht prüfbar“ – das soll auffallen.
function datenhinweisBox(datenhinweise) {
  if (!datenhinweise?.length) return null;
  const n = datenhinweise.length;
  return el("section", { class: "meldung meldung-hinweis", "aria-labelledby": "datenhinweis-titel" },
    el("h2", { class: "meldung-titel", id: "datenhinweis-titel" }, symbol("hinweis"),
      el("span", {}, n === 1 ? "1 Angabe in exposes.json hat ein unerwartetes Format" : `${n} Angaben in exposes.json haben ein unerwartetes Format`)),
    el("p", {}, "Die betroffenen Regeln gelten dort als „nicht prüfbar“ und zählen nicht für den Status. Bitte die Angaben in der Datei korrigieren."),
    el("ul", { class: "fehlerliste" }, datenhinweise.slice(0, 10).map((t) => el("li", {}, t)),
      n > 10 && el("li", {}, `… und ${n - 10} weitere`)));
}

export function zeigeUebersicht(ziel, { regelsatz, exposes, pruefungen, anzahl, filter, datenhinweise, schwerpunkte }) {
  const sortiert = sortiereExposes(exposes, pruefungen);
  const aktive = regelsatz.regeln.filter((r) => r.aktiv).length;

  const grafik = el("section", { class: "karte", "aria-labelledby": "grafik-ueberschrift" },
    el("div", { class: "karte-kopf" },
      el("h2", { id: "grafik-ueberschrift" }, "Statusverteilung"),
      el("span", { class: "leise zahl" }, `${exposes.length} Exposés`)),
    el("div", { class: "karte-inhalt karte-inhalt-fuellend" },
      el("figure", { class: "grafik" },
        statusGrafik(anzahl, exposes.length),
        el("figcaption", { class: "visuell-versteckt" }, `Gesamtstatus von ${exposes.length} Exposés, Stand der aktuellen Regeln.`)),
      el("p", { class: "karte-fussnote" },
        `${anzahl.verletzt + anzahl.hinweis} von ${exposes.length} Exposés mit Auffälligkeiten. `,
        "Die Grafik aktualisiert sich, sobald sich Regeln ändern.")));

  const filterFeld = el("fieldset", { class: "filter" },
    el("legend", {}, "Anzeigen"),
    el("div", { class: "filter-optionen" }, FILTER.map(({ wert, text }) => {
      const id = `filter-${wert}`;
      const zahl = wert === "alle" ? exposes.length : anzahl[wert];
      return el("div", { class: "filter-option" },
        el("input", { type: "radio", name: "filter", id, value: wert, checked: wert === filter }),
        el("label", { for: id },
          wert !== "alle" && symbol(wert),
          text,
          el("span", { class: "filter-anzahl" }, el("span", { class: "visuell-versteckt" }, "("), String(zahl), el("span", { class: "visuell-versteckt" }, ")"))));
    })));

  const zeilen = sortiert.map((expose) => {
    const pruefung = pruefungen.get(expose.id);
    return el("tr", { "data-status": pruefung.gesamt },
      el("td", {}, statusAnzeige(pruefung.gesamt, AMPEL_TEXT[pruefung.gesamt], true)),
      el("th", { scope: "row" },
        el("span", { class: "zeilen-id" }, expose.id),
        el("a", { class: "titel-link", href: `#/expose/${encodeURIComponent(expose.id)}` }, expose.titel || "(ohne Titel)")),
      el("td", {}, mitgliederZelle(expose, regelsatz)),
      el("td", { class: "spalte-eingang zahl" }, zeitAnzeige(expose.eingang)),
      el("td", {}, auffaelligkeitenText(pruefung.zaehler)));
  });

  const tabelle = el("table", { class: "tabelle" },
    el("caption", { id: "tabelle-beschriftung" }),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col", class: "spalte-status" }, "Status"),
      el("th", { scope: "col", class: "spalte-titel" }, "Exposé"),
      el("th", { scope: "col", class: "spalte-mitglieder" }, "Mitglieder"),
      el("th", { scope: "col", class: "spalte-eingang" }, "Eingang"),
      el("th", { scope: "col", class: "spalte-auffaellig" }, "Auffälligkeiten"))),
    el("tbody", {}, zeilen,
      el("tr", { class: "leer-zeile", hidden: true }, el("td", { colspan: 5 }, "Keine Exposés mit diesem Status."))));

  ziel.replaceChildren(...[
    ansichtKopf("Übersicht", `${exposes.length} Exposés, geprüft gegen ${aktive} aktive Regeln. Verstöße stehen oben.`),
    datenhinweisBox(datenhinweise),
    el("div", { class: "uebersicht-raster" }, grafik, legende()),
    filterFeld,
    // Scrollbereich ist per Tastatur erreichbar und benannt, falls die Tabelle breiter als der Bildschirm ist.
    el("div", { class: "tabelle-rahmen", role: "region", "aria-labelledby": "tabelle-beschriftung" }, tabelle),
    schwerpunkte && schwerpunktAbschnitt(schwerpunkte),
  ].filter(Boolean)); // replaceChildren fügt null sonst als Text „null“ ein

  return wendeFilterAn(ziel, filter, anzahl);
}

// Blendet Zeilen nach Status ein/aus und aktualisiert die Beschriftung (A-10). Liefert die Zeilenzahlen.
export function wendeFilterAn(ziel, filter, anzahl) {
  const zeilen = [...ziel.querySelectorAll("tbody tr[data-status]")];
  let sichtbar = 0;
  for (const zeile of zeilen) {
    zeile.hidden = filter !== "alle" && zeile.dataset.status !== filter;
    if (!zeile.hidden) sichtbar += 1;
  }
  ziel.querySelector(".leer-zeile").hidden = sichtbar > 0;
  const gesamt = zeilen.length;
  const beschriftung = filter === "alle"
    ? `${gesamt} Exposés, davon ${anzahl.verletzt} mit Verstößen (Filter: alle)`
    : `${sichtbar} von ${gesamt} Exposés angezeigt (Filter: ${AMPEL_TEXT[filter]})`;
  ziel.querySelector("#tabelle-beschriftung").textContent = beschriftung;
  return { sichtbar, gesamt };
}

// ---------- Detailansicht ----------

const GRUPPEN = [
  { ergebnis: "verletzt", titel: "Verstöße" },
  { ergebnis: "hinweis", titel: "Hinweise" },
  { ergebnis: "ok", titel: "Erfüllt" },
  { ergebnis: "inaktiv", titel: "Entfällt oder nicht prüfbar" },
];

// Begründung mit hervorgehobenen Marken; der Textinhalt bleibt „Soll: … · Ist: …“ (A-08).
function begruendungAnzeige(ergebnis) {
  if (ergebnis.ergebnis === "inaktiv") return el("p", { class: "begruendung leise" }, begruendung(ergebnis));
  return el("p", { class: "begruendung" },
    el("b", {}, "Soll:"), ` ${ergebnis.soll} · `, el("b", {}, "Ist:"), ` ${ergebnis.ist}`,
    ergebnis.grund && ` – ${ergebnis.grund}`);
}

function ergebnisEintrag(ergebnis, regel) {
  const status = ergebnis.ergebnis;
  return el("li", { class: `ergebnis status-rahmen-${status}` },
    el("div", { class: "ergebnis-status" }, statusAnzeige(status, ergebnisText(ergebnis))),
    el("div", { class: "ergebnis-text" },
      el("p", { class: "ergebnis-titel" }, regel.bezeichnung, el("span", { class: "regel-id" }, regel.id)),
      begruendungAnzeige(ergebnis),
      regel.quelle && el("p", { class: "quelle" }, `Quelle: ${regel.quelle}`)));
}

function ergebnisListe(pruefung, regelsatz) {
  const regeln = new Map(regelsatz.regeln.map((r) => [r.id, r]));
  const sortiert = sortiereErgebnisse(pruefung.ergebnisse);
  return GRUPPEN.map(({ ergebnis, titel }) => {
    const eintraege = sortiert.filter((e) => e.ergebnis === ergebnis);
    if (eintraege.length === 0) return null;
    const id = `gruppe-${ergebnis}`;
    return el("section", { class: "ergebnis-gruppe", "aria-labelledby": id },
      el("h3", { class: "gruppen-titel", id }, `${titel} (${eintraege.length})`),
      // Erfüllte und entfallende Regeln kompakt als Liste, Abweichungen als hervorgehobene Einträge.
      el("ul", { class: ergebnis === "verletzt" || ergebnis === "hinweis" ? "ergebnis-liste" : "ergebnis-liste kompakt" },
        eintraege.map((e) => ergebnisEintrag(e, regeln.get(e.regelId)))));
  });
}

// „Angaben im Datensatz“ als Beschreibungsliste, Bezeichnungen aus dem Feldkatalog (felder).
function angabenListe(expose, regelsatz) {
  const felder = regelsatz.felder;
  const wertKnoten = (pfad, wert) => istLeer(wert)
    ? el("span", { class: "nicht-angegeben" }, "nicht angegeben")
    : anzeigeMitKatalog(regelsatz, pfad, wert);

  const zeilen = [];
  for (const feld of felder) {
    if (feld.pfad.includes("[]")) continue; // Unterfelder erscheinen bei ihrer Liste
    const wert = wertAmPfad(expose, feld.pfad);
    let inhalt;
    if (feld.datentyp === "liste" && Array.isArray(wert) && wert.length > 0) {
      const unterfelder = felder.filter((f) => f.pfad.startsWith(`${feld.pfad}[].`) && f.pfad !== `${feld.pfad}[].${feld.elementName}`);
      inhalt = el("ul", { class: "person-liste" }, wert.map((element, i) => el("li", {},
        el("span", { class: istLeer(element?.[feld.elementName]) ? "person-name ohne-name" : "person-name" }, elementBezeichnung(feld, element, i)),
        el("span", { class: "person-angaben" }, unterfelder.map((u, j) => {
          const unterPfad = u.pfad.slice(feld.pfad.length + 3);
          const unterWert = wertAmPfad(element, unterPfad);
          const text = istLeer(unterWert) ? "nicht angegeben"
            : Array.isArray(unterWert) ? unterWert.map((w) => anzeigeMitKatalogNummer(regelsatz, u.pfad, w)).join("; ")
              : wertAnzeigen(unterWert);
          return `${j > 0 ? " · " : ""}${u.bezeichnung}: ${text}`;
        })))));
    } else if (feld.datentyp === "datum" && typeof wert === "string") {
      inhalt = datumAnzeigen(wert);
    } else if (feld.datentyp === "zahl" && typeof wert === "number") {
      inhalt = zahlAnzeigen(wert);
    } else {
      inhalt = wertKnoten(feld.pfad, wert);
    }
    zeilen.push(el("dt", {}, feld.bezeichnung), el("dd", {}, inhalt));
  }
  return el("dl", { class: "angaben" }, zeilen);
}

// Katalogwert mit Nummer und Text, z. B. „6 – Semantisches HTML und Formulare“.
function anzeigeMitKatalogNummer(regelsatz, pfad, wert) {
  const text = anzeigeMitKatalog(regelsatz, pfad, wert);
  return typeof wert === "number" && text !== wertAnzeigen(wert) ? `${wert} – ${text}` : text;
}

function blaetterLink(expose, richtung) {
  if (!expose) return null;
  const links = richtung === "zurueck";
  return el("a", { class: `knopf-link${links ? "" : " rechts"}`, href: `#/expose/${encodeURIComponent(expose.id)}` },
    links && symbol("pfeil-links"),
    el("span", {}, links ? "Vorheriges" : "Nächstes"),
    el("span", { class: "visuell-versteckt" }, ` Exposé: ${expose.titel}`),
    !links && symbol("pfeil-rechts"));
}

// Seiteninterner Sprung ohne Hash-Änderung (Konzept 6.2): Die Route #/expose/… bleibt erhalten.
function sprungZurVorschau() {
  const link = el("a", { href: "#vorschau-titel", class: "knopf-link" }, symbol("dokument"), "Zur PDF-Vorschau");
  link.addEventListener("click", (ereignis) => {
    ereignis.preventDefault();
    const ziel = document.getElementById("vorschau-titel");
    ziel.scrollIntoView({ block: "start" });
    ziel.focus({ preventScroll: true });
  });
  return link;
}

function zaehlerText(zaehler) {
  return [
    anzahlText(zaehler.verletzt, "Verstoß", "Verstöße"),
    anzahlText(zaehler.hinweis, "Hinweis", "Hinweise"),
    `${zaehler.ok} erfüllt`,
    zaehler.entfaellt > 0 && `${zaehler.entfaellt} entfällt`,
    zaehler.nichtPruefbar > 0 && `${zaehler.nichtPruefbar} nicht prüfbar`,
  ].filter(Boolean).join(" · ");
}

// ---------- Ausbaustufe A-30: Rückmeldung entwerfen ----------

// rueckmeldung = { text, vorlage, veraltet }; aktionen = { beiEingabe(text), beiNeuErzeugen(), beiKopieren(text) }.
// Eigene Änderungen verwaltet main.js je Exposé; hier wird nur angezeigt und weitergemeldet.
function rueckmeldungAbschnitt(rueckmeldung, aktionen) {
  const feld = el("textarea", {
    id: "rueckmeldung-text", name: "rueckmeldung", rows: 14, spellcheck: "true",
    "aria-describedby": rueckmeldung.veraltet ? "rueckmeldung-hilfe rueckmeldung-veraltet" : "rueckmeldung-hilfe",
  });
  feld.value = rueckmeldung.text;
  feld.addEventListener("input", () => aktionen.beiEingabe(feld.value));
  const veraltet = rueckmeldung.veraltet && el("p", { class: "rueckmeldung-veraltet", id: "rueckmeldung-veraltet" },
    symbol("hinweis"), el("span", {}, "Die Prüfergebnisse haben sich seit Ihrer Bearbeitung geändert. Ihr Text wurde beibehalten; „Vorlage neu erzeugen“ übernimmt den aktuellen Stand."));
  const kopieren = el("button", { type: "button", class: "knopf" }, "In Zwischenablage kopieren");
  // Der Fokus bleibt auf der Schaltfläche; Erfolg oder Fehlschlag meldet der Statusbereich (WCAG 4.1.3).
  kopieren.addEventListener("click", () => aktionen.beiKopieren(feld.value));
  const neu = el("button", { type: "button", class: "knopf knopf-zweit" }, "Vorlage neu erzeugen");
  neu.addEventListener("click", () => {
    feld.value = rueckmeldung.vorlage;
    feld.setAttribute("aria-describedby", "rueckmeldung-hilfe");
    feld.closest("section").querySelector(".rueckmeldung-veraltet")?.remove();
    aktionen.beiNeuErzeugen();
  });
  return el("section", { class: "karte", "aria-labelledby": "rueckmeldung-titel" },
    el("div", { class: "karte-kopf" }, el("h2", { id: "rueckmeldung-titel" }, "Rückmeldung entwerfen")),
    el("div", { class: "karte-inhalt rueckmeldung" },
      el("div", { class: "feldgruppe" },
        el("label", { for: "rueckmeldung-text" }, "Text der Rückmeldung"),
        feld,
        el("p", { class: "hilfe", id: "rueckmeldung-hilfe" },
          "Erzeugt aus den Verstößen und Hinweisen nach dem angewendeten Regelsatz. Sie können den Text vor dem Kopieren anpassen; Ihre Änderungen bleiben für dieses Exposé erhalten, bis die Seite neu geladen wird."),
        veraltet),
      el("div", { class: "editor-aktionen" }, kopieren, neu)));
}

export function zeigeDetail(ziel, { expose, pruefung, regelsatz, vorheriges, naechstes, rueckmeldung, rueckmeldungAktionen }) {
  const arbeitsform = istLeer(expose.arbeitsform) ? null : anzeigeMitKatalog(regelsatz, "arbeitsform", expose.arbeitsform);

  const kopf = el("div", { class: "detail-kopf" },
    el("p", { class: "detail-meta" },
      el("span", { class: "mono" }, expose.id),
      arbeitsform && el("span", {}, arbeitsform),
      !istLeer(expose.eingang) && el("span", {}, "Eingang ", zeitAnzeige(expose.eingang, { zweizeilig: false }))),
    el("h1", { tabindex: "-1" }, expose.titel || "(ohne Titel)"),
    // Auf schmalen Bildschirmen steht die Vorschau unter allen Ergebnissen; der Link führt direkt hin.
    el("p", { class: "nur-schmal" }, sprungZurVorschau()),
    el("div", { class: `gesamtstatus status-${pruefung.gesamt}` },
      statusAnzeige(pruefung.gesamt, AMPEL_TEXT[pruefung.gesamt]),
      el("span", { class: "gesamtstatus-zahlen" }, zaehlerText(pruefung.zaehler))));

  const ergebnisse = el("section", { class: "karte", "aria-labelledby": "ergebnisse-titel" },
    el("div", { class: "karte-kopf" },
      el("h2", { id: "ergebnisse-titel" }, "Prüfergebnisse"),
      el("span", { class: "leise zahl" }, `${pruefung.ergebnisse.length} aktive Regeln`)),
    el("div", { class: "karte-inhalt" }, ergebnisListe(pruefung, regelsatz)));

  const angaben = el("section", { class: "karte", "aria-labelledby": "angaben-titel" },
    el("div", { class: "karte-kopf" }, el("h2", { id: "angaben-titel" }, "Angaben im Datensatz")),
    el("div", { class: "karte-inhalt" }, angabenListe(expose, regelsatz)));

  const flaeche = el("div", { class: "vorschau-flaeche" });
  const vorschau = el("section", { class: "karte vorschau", "aria-labelledby": "vorschau-titel" },
    el("div", { class: "karte-kopf" }, el("h2", { id: "vorschau-titel", tabindex: "-1" }, "Vorschau")),
    el("div", { class: "karte-inhalt" },
      el("figure", { class: "vorschau-figur" },
        flaeche,
        el("figcaption", {},
          "Vorschau – geprüft werden die erfassten Angaben, nicht der PDF-Inhalt.",
          istPdfPfad(expose.pdf) && [" ", el("a", { href: expose.pdf, target: "_blank", rel: "noopener" }, "PDF in neuem Tab öffnen")]))));

  ziel.replaceChildren(
    el("nav", { class: "detail-navigation", "aria-label": "Exposé-Navigation" },
      el("a", { class: "knopf-link", href: "#/liste" }, symbol("pfeil-links"), "Zur Übersicht"),
      el("div", { class: "blaetter" }, blaetterLink(vorheriges, "zurueck"), blaetterLink(naechstes, "vor"))),
    el("article", { "aria-labelledby": "detail-titel" },
      kopf,
      el("div", { class: "detail-raster" },
        el("div", { class: "detail-spalte" }, ergebnisse, rueckmeldungAbschnitt(rueckmeldung, rueckmeldungAktionen), angaben),
        el("div", { class: "detail-spalte" }, vorschau))));
  kopf.querySelector("h1").id = "detail-titel";

  zeigePdfVorschau(flaeche, expose);
}

// ---------- PDF-Vorschau (A-11, F-6) ----------

let aktuelleBlobUrl = null;
let letzteAnfrage = 0; // verhindert, dass eine langsame ältere Antwort eine neuere Vorschau überschreibt

export function vorschauFreigeben() {
  letzteAnfrage += 1;
  if (aktuelleBlobUrl) {
    URL.revokeObjectURL(aktuelleBlobUrl);
    aktuelleBlobUrl = null;
  }
}

function ersatz(titel, text, link) {
  return el("div", { class: "vorschau-ersatz" },
    symbol("dokument", "dokument-symbol"),
    el("strong", {}, titel),
    text && el("p", {}, text),
    link);
}

async function zeigePdfVorschau(flaeche, expose) {
  vorschauFreigeben();
  const anfrage = letzteAnfrage;

  if (!expose.pdf) {
    const format = istLeer(expose.dateiformat) ? null : String(expose.dateiformat).toUpperCase();
    flaeche.replaceChildren(ersatz("Kein PDF hinterlegt",
      format ? `Eingereicht als ${format}, keine Vorschau möglich.` : "Das Dateiformat ist nicht angegeben."));
    return;
  }

  flaeche.replaceChildren(el("p", { class: "laden laden-mittig" }, "PDF wird geladen …"));
  let blobUrl;
  try {
    blobUrl = await ladePdf(expose.pdf);
  } catch (fehler) {
    if (anfrage !== letzteAnfrage) return; // inzwischen andere Ansicht
    console.error(fehler);
    flaeche.replaceChildren(ersatz("Das PDF konnte nicht geladen werden",
      `Grund: ${fehler.message}.`,
      istPdfPfad(expose.pdf) && el("a", { href: expose.pdf, target: "_blank", rel: "noopener" }, "PDF direkt öffnen")));
    return;
  }
  if (anfrage !== letzteAnfrage) {
    URL.revokeObjectURL(blobUrl); // Antwort kam zu spät
    return;
  }
  aktuelleBlobUrl = blobUrl;
  // Fallback-Inhalt im object: erscheint nur, wenn der Browser das PDF nicht einbetten kann.
  flaeche.replaceChildren(el("object", {
    class: "vorschau-pdf", data: blobUrl, type: "application/pdf", "aria-label": `PDF-Vorschau: ${expose.titel}`,
  }, ersatz("Die PDF-Vorschau kann in diesem Browser nicht angezeigt werden.", null,
    el("a", { href: expose.pdf, target: "_blank", rel: "noopener" }, "PDF öffnen"))));
}
