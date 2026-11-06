// Start und Steuerung (Controller): Laden anstoßen, Zustand halten, Hash-Routing, Statusbereich.
// Datenfluss in eine Richtung (Konzept 8): Daten laden → auswerten → Ansicht rendern.
// Der Regel-Editor ändert einen Entwurf; „Prüfen und anwenden“ übernimmt ihn als Regelsatz und wertet neu aus.

import { katalogFuerFeld, pruefeAlle, rueckmeldungText, schwerpunktVerteilung, verteilung } from "./auswertung.js";
import * as ansichten from "./ansichten.js";
import { aktualisiereEditor, verlasseEditor, zeigeEditor } from "./editor.js";
import { regelsaetzeGleich, verworfenMeldung } from "./editorlogik.js";
import { ladeExposes, ladeRegelsatz } from "./laden.js";
import { pruefeAngabenformat } from "./schema.js";
import { bindeImport, exportiere, importMeldung, kopiereInZwischenablage } from "./speicher.js";

const ziel = document.querySelector("#ansicht");
const statusmeldung = document.querySelector("#statusmeldung");

// Einzige Quelle des Anwendungszustands; der Regel-Editor liest und schreibt hier direkt (K-13).
const zustand = {
  regelsatz: null,      // angewendeter Regelsatz (zu Beginn der Standard aus regeln.json)
  standard: null,       // Standard aus regeln.json, Vergleichsbasis für „Geändert“
  entwurf: null,        // Arbeitsstand des Regel-Editors (nur gültige Werte); null = wie der angewendete Regelsatz
  hoechsteRegelNummer: 0, // höchste je vergebene Regelnummer, damit IDs nie wiederverwendet werden (K-1)
  datenhinweise: [],    // Angaben in exposes.json mit unerwartetem Format (S-1 b)
  schwerpunkte: null,   // Verteilung der Theorieschwerpunkte (A-31)
  // Bearbeitete Rückmeldungen je Exposé (A-30): exposeId → { text, vorlage }. „vorlage“ ist der erzeugte Text
  // zum Zeitpunkt der Bearbeitung. Entscheidung: Bearbeitungen bleiben bis zum Neuladen der Seite erhalten,
  // auch beim Wechsel des Exposés und nach „Prüfen und anwenden“ – sie gehen also nie beim bloßen Neuzeichnen
  // verloren. Hat sich die Vorlage inzwischen geändert, sagt die Ansicht das (kein stilles Überschreiben).
  rueckmeldungen: new Map(),
  ansicht: null,        // aktuelle Ansicht (für die Meldung beim Verlassen des Editors)
  gesichert: null,      // zuletzt exportierter oder importierter Regelsatz (liegt also als Datei vor)
  exposeDatei: null,    // Inhalt von exposes.json
  pruefungen: null,     // Map exposeId → Prüfung
  anzahl: null,         // Anzahl Exposés je Gesamtstatus
  fehler: { regeln: null, exposes: null },
  filter: "alle",
};

// ---------- Statusbereich (A-24) ----------

let meldungsTakt = null;
// Schreibt eine Meldung in den dauerhaft vorhandenen Statusbereich, ohne den Fokus zu verschieben.
// Erst leeren, dann kurz verzögert setzen, damit auch eine gleichlautende Meldung erneut angesagt wird.
function melde(text) {
  clearTimeout(meldungsTakt);
  statusmeldung.textContent = "";
  meldungsTakt = setTimeout(() => { statusmeldung.textContent = text; }, 60);
}

// ---------- Auswertung ----------

function neuAuswerten() {
  zustand.pruefungen = pruefeAlle(zustand.exposeDatei.exposes, zustand.regelsatz);
  zustand.anzahl = verteilung(zustand.pruefungen);
  // Das erwartete Format steht im Feldkatalog des Regelsatzes, deshalb wird es mit ihm geprüft.
  zustand.datenhinweise = pruefeAngabenformat(zustand.exposeDatei, zustand.regelsatz.felder);
  // Katalog des Schwerpunktfelds aus dem angewendeten Regelsatz (Katalogänderungen wirken also mit).
  const katalog = katalogFuerFeld(zustand.regelsatz, "mitglieder[].schwerpunkte") ?? zustand.regelsatz.kataloge.schwerpunkte;
  zustand.schwerpunkte = katalog
    ? schwerpunktVerteilung(zustand.exposeDatei.exposes, katalog, zustand.regelsatz.felder)
    : null;
}

// ---------- Routing: nur Hashes, die mit "#/" beginnen (Konzept 6.2) ----------

function leseRoute() {
  const hash = location.hash;
  if (hash === "" || hash === "#") return { ansicht: "liste" };
  if (!hash.startsWith("#/")) return null; // seiteninterne Sprungmarke, z. B. #inhalt
  const [teil, kennung] = hash.slice(2).split("/");
  if (teil === "" || teil === "liste") return { ansicht: "liste" };
  if (teil === "expose" && kennung) return { ansicht: "detail", id: decodeURIComponent(kennung) };
  if (teil === "regeln") return { ansicht: "regeln" };
  return { ansicht: "unbekannt" };
}

function setzeTitel(teil) {
  document.title = teil ? `${teil} – Exposé-Check` : "Exposé-Check";
}

// Liefert die Ladefehler, die eine Ansicht verhindern.
function blockierendeFehler(ansicht) {
  const { regeln, exposes } = zustand.fehler;
  if (ansicht === "regeln") return [regeln].filter(Boolean);
  return [regeln, exposes].filter(Boolean);
}

function zeige(route, { fokus }) {
  zustand.ansicht = route.ansicht;
  ansichten.vorschauFreigeben();
  ansichten.markiereNavigation(route.ansicht);

  const fehler = blockierendeFehler(route.ansicht);
  if (fehler.length > 0) {
    const titel = route.ansicht === "regeln" ? "Regeln bearbeiten" : "Übersicht";
    // F-1: Ist regeln.json nicht ladbar, bietet die Meldung den Import einer Regelsatz-Datei an.
    // „Erneut laden“ setzt danach den Fokus auf die Überschrift der neuen Ansicht (K-10).
    ansichten.zeigeLadefehler(ziel, titel, fehler, () => starte({ fokus: true }),
      (platz) => bindeImport(platz, "import-ladefehler", { beiErfolg: beiImport, melde }));
    setzeTitel(titel);
  } else if (route.ansicht === "liste") {
    ansichten.zeigeUebersicht(ziel, { ...zustand, exposes: zustand.exposeDatei.exposes });
    setzeTitel("Übersicht");
  } else if (route.ansicht === "detail") {
    zeigeDetail(route.id);
  } else if (route.ansicht === "regeln") {
    // Ohne exposes.json (F-2) bleibt der Editor nutzbar, nur die Vorschau entfällt.
    zeigeEditor(ziel, zustand, {
      kennzeichen,
      melde,
      beiAnwenden,
      beiZuruecksetzen,
      beiExport,
      beiImport,
    });
    setzeTitel("Regeln bearbeiten");
  } else {
    ansichten.zeigeNichtGefunden(ziel, "Seite nicht gefunden", `Die Adresse „${location.hash}“ gibt es nicht.`);
    setzeTitel("Seite nicht gefunden");
  }

  ansichten.aktualisiereScrollbereiche(ziel);

  // Nach einem Ansichtswechsel den Fokus auf die Hauptüberschrift setzen (Fokusreihenfolge, A-17).
  if (fokus) {
    ziel.querySelector("h1")?.focus();
    window.scrollTo(0, 0);
  }
}

function zeigeDetail(id) {
  const exposes = zustand.exposeDatei.exposes;
  const expose = exposes.find((e) => e.id === id);
  if (!expose) {
    // F-9: unbekannte Exposé-ID in der Route
    ansichten.zeigeNichtGefunden(ziel, "Exposé nicht gefunden", `Exposé ${id} nicht gefunden.`);
    setzeTitel("Exposé nicht gefunden");
    return;
  }
  // Blättern in der Reihenfolge der Übersicht, mit dem aktuellen Filter, sofern das Exposé darin liegt.
  const sortiert = ansichten.sortiereExposes(exposes, zustand.pruefungen);
  const gefiltert = ansichten.filtereExposes(sortiert, zustand.pruefungen, zustand.filter);
  const reihe = gefiltert.some((e) => e.id === id) ? gefiltert : sortiert;
  const stelle = reihe.findIndex((e) => e.id === id);

  const pruefung = zustand.pruefungen.get(id);
  const vorlage = rueckmeldungText(expose, pruefung, zustand.regelsatz);
  const bearbeitet = zustand.rueckmeldungen.get(id);
  ansichten.zeigeDetail(ziel, {
    expose,
    pruefung,
    regelsatz: zustand.regelsatz,
    vorheriges: reihe[stelle - 1] ?? null,
    naechstes: reihe[stelle + 1] ?? null,
    rueckmeldung: { text: bearbeitet?.text ?? vorlage, vorlage, veraltet: Boolean(bearbeitet) && bearbeitet.vorlage !== vorlage },
    rueckmeldungAktionen: {
      beiEingabe: (text) => {
        if (text === vorlage) zustand.rueckmeldungen.delete(id);
        else zustand.rueckmeldungen.set(id, { text, vorlage });
      },
      beiNeuErzeugen: () => {
        zustand.rueckmeldungen.delete(id);
        melde("Rückmeldung aus den aktuellen Prüfergebnissen neu erzeugt.");
      },
      beiKopieren: async (text) => {
        const ergebnis = await kopiereInZwischenablage(text);
        melde(ergebnis.ok
          ? "Rückmeldung in die Zwischenablage kopiert."
          : `Kopieren nicht möglich. ${ergebnis.grund} Bitte den Text im Feld markieren (Strg+A bzw. Cmd+A) und mit Strg+C bzw. Cmd+C kopieren.`);
      },
    },
  });
  setzeTitel(`${expose.id}: ${expose.titel}`);
}

// ---------- Regel-Editor: Anwenden, Zurücksetzen, Export, Import ----------

// Kennzeichen des angewendeten Regelsatzes für Kopf und Editor (Konzept 6.2, 7.1).
function kennzeichen() {
  const { regelsatz, standard, gesichert } = zustand;
  if (standard && regelsaetzeGleich(regelsatz, standard)) return { text: "Standard", art: "standard" };
  if (gesichert && regelsaetzeGleich(regelsatz, gesichert)) {
    // Ohne Standard (regeln.json nicht ladbar, F-1) gibt es nichts, wogegen „geändert“ gälte.
    return standard ? { text: "Geändert", art: "geaendert" } : { text: "Importiert", art: "geaendert" };
  }
  return { text: "Geändert – nicht exportiert", art: "offen" };
}

function rahmen() {
  ansichten.zeigeRahmen(zustand.regelsatz, zustand.exposeDatei, zustand.regelsatz ? kennzeichen() : null);
}

// „Prüfen und anwenden“ war erfolgreich: neuer Regelsatz, neue Auswertung, Kopfzeile (A-13).
function beiAnwenden() {
  zustand.regelsatz = structuredClone(zustand.entwurf);
  rahmen();
  if (!zustand.exposeDatei) {
    melde("Alle Regeln gültig und angewendet.");
    return;
  }
  neuAuswerten();
  const { verletzt, hinweis, ok } = zustand.anzahl;
  melde(`Alle Regeln gültig und angewendet. Ergebnis: ${verletzt} mit Verstößen, ${hinweis} mit Hinweisen, ${ok} ohne Auffälligkeiten.`);
}

// „Auf Standard zurücksetzen“: regeln.json neu laden und alle Änderungen verwerfen (A-18).
async function beiZuruecksetzen() {
  let standard;
  try {
    standard = await ladeRegelsatz();
  } catch (fehler) {
    console.error(fehler);
    melde(`Zurücksetzen nicht möglich: ${fehler.titel ?? fehler.message} Die Änderungen bleiben erhalten.`);
    return;
  }
  zustand.standard = structuredClone(standard);
  zustand.regelsatz = standard;
  zustand.entwurf = null;
  if (zustand.exposeDatei) neuAuswerten();
  rahmen();
  zeige({ ansicht: "regeln" }, { fokus: false });
  // Der Editor wurde neu aufgebaut; der Fokus kehrt auf die Schaltfläche zurück, die die Aktion auslöste.
  ziel.querySelector('[data-aktion="zuruecksetzen"]')?.focus();
  melde("Auf Standard zurückgesetzt: regeln.json neu geladen, alle Änderungen verworfen.");
}

// Export (A-19): exportiert wird der angewendete Regelsatz. Ungültige Eingaben und nicht angewendete
// Änderungen sind nicht enthalten; die Meldung sagt das ausdrücklich.
function beiExport({ ungueltig, offen }) {
  const dateiname = exportiere(zustand.regelsatz);
  zustand.gesichert = structuredClone(zustand.regelsatz);
  rahmen();
  aktualisiereEditor();
  const zusaetze = [];
  if (ungueltig > 0) {
    zusaetze.push(`${ungueltig === 1 ? "1 ungültige Eingabe wurde" : `${ungueltig} ungültige Eingaben wurden`} nicht übernommen.`);
  }
  if (offen) zusaetze.push("Nicht angewendete Änderungen sind nicht enthalten.");
  melde(`Exportiert als „${dateiname}“.${zusaetze.length > 0 ? ` ${zusaetze.join(" ")} Exportiert ist der zuletzt angewendete gültige Stand.` : ""}`);
}

// Import (A-20): Die Datei ist bereits vollständig geprüft. Der Regelsatz ersetzt den bisherigen,
// ein nicht angewendeter Entwurf wird verworfen. Auch aus der Ladefehler-Meldung (F-1) erreichbar.
function beiImport(regelsatz, dateiname) {
  zustand.regelsatz = regelsatz;
  zustand.gesichert = structuredClone(regelsatz);
  zustand.entwurf = null;
  zustand.fehler.regeln = null;
  if (zustand.exposeDatei) neuAuswerten();
  rahmen();
  const route = leseRoute() ?? { ansicht: "liste" };
  zeige(route, { fokus: false });
  // Fokus: im Editor zurück auf die Dateiauswahl, sonst (Ladefehler-Meldung ist verschwunden) auf die Überschrift.
  (ziel.querySelector("#import-datei") ?? ziel.querySelector("h1"))?.focus();
  melde(importMeldung(regelsatz, dateiname));
}

// ---------- Ereignisse ----------

window.addEventListener("hashchange", () => {
  const route = leseRoute();
  if (!route) return;
  // Wer den Editor mit ungültigen Eingaben verlässt, erfährt, dass sie nicht übernommen wurden (S-3).
  const verworfen = zustand.ansicht === "regeln" && route.ansicht !== "regeln" ? verlasseEditor() : 0;
  zeige(route, { fokus: true });
  if (verworfen > 0) melde(verworfenMeldung(verworfen));
});

// Sprunglink „Zum Inhalt springen“ ohne Hash-Änderung, sonst ginge die Route verloren (K-7).
document.querySelector(".sprunglink").addEventListener("click", (ereignis) => {
  ereignis.preventDefault();
  document.querySelector("#inhalt").focus();
});

// Filter der Übersicht: wirkt sofort, ohne Absenden-Knopf (A-10). Ereignisdelegation am Ansichtsbereich.
ziel.addEventListener("change", (ereignis) => {
  if (ereignis.target.name !== "filter") return;
  zustand.filter = ereignis.target.value;
  const { sichtbar, gesamt } = ansichten.wendeFilterAn(ziel, zustand.filter, zustand.anzahl);
  melde(`${sichtbar} von ${gesamt} Exposés angezeigt.`);
});

window.addEventListener("resize", () => ansichten.aktualisiereScrollbereiche(ziel));

// Letzte Eingabeart für den Fokusrahmen der Filter-Segmente (WebKit-Ausgleich, Begründung in stil.css
// bei .filter-option). Erfasst in der Capture-Phase, also bevor der Fokus wechselt.
document.addEventListener("keydown", () => { document.documentElement.dataset.eingabe = "tastatur"; }, true);
document.addEventListener("pointerdown", () => { document.documentElement.dataset.eingabe = "zeiger"; }, true);

// ---------- Start ----------

// fokus: nach „Erneut laden“ – die auslösende Schaltfläche verschwindet, der Fokus geht auf die neue H1.
async function starte({ fokus = false } = {}) {
  // Das Skript läuft, also wurde die Seite über einen Webserver geöffnet (F-8).
  // Entfernen statt verstecken (K-14): kein zweites, verstecktes h1 im Dokument.
  document.querySelector("#hinweis-webserver")?.remove();
  melde("Regeln und Exposés werden geladen …");
  ansichten.zeigeLaden(ziel);

  // Beide Dateien parallel laden; ein Fehler in der einen verhindert nicht die Anzeige der anderen.
  const [regeln, exposes] = await Promise.allSettled([ladeRegelsatz(), ladeExposes()]);
  zustand.regelsatz = regeln.status === "fulfilled" ? regeln.value : null;
  zustand.exposeDatei = exposes.status === "fulfilled" ? exposes.value : null;
  zustand.fehler.regeln = regeln.status === "rejected" ? regeln.reason : null;
  zustand.fehler.exposes = exposes.status === "rejected" ? exposes.reason : null;
  for (const ergebnis of [regeln, exposes]) {
    if (ergebnis.status === "rejected") console.error(ergebnis.reason); // Details nur in der Konsole
  }

  zustand.standard = zustand.regelsatz ? structuredClone(zustand.regelsatz) : null;
  zustand.entwurf = null;
  zustand.gesichert = null;
  if (zustand.regelsatz && zustand.exposeDatei) neuAuswerten();
  rahmen();
  zeige(leseRoute() ?? { ansicht: "liste" }, { fokus });

  if (zustand.pruefungen) {
    const aktive = zustand.regelsatz.regeln.filter((r) => r.aktiv).length;
    melde(`${zustand.exposeDatei.exposes.length} Exposés gegen ${aktive} aktive Regeln geprüft.`);
  } else {
    melde("Laden fehlgeschlagen. Details stehen in der Meldung auf der Seite.");
  }
}

starte();
