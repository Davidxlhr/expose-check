// Start und Steuerung (Controller): Laden anstoßen, Zustand halten, Hash-Routing, Statusbereich.
// Datenfluss in eine Richtung (Konzept 8): Daten laden → auswerten → Ansicht rendern.
// Der Regel-Editor ändert einen Entwurf; „Prüfen und anwenden“ übernimmt ihn als Regelsatz und wertet neu aus.

import { pruefeAlle, verteilung } from "./auswertung.js";
import * as ansichten from "./ansichten.js";
import { zeigeEditor } from "./editor.js";
import { regelsaetzeGleich } from "./editorlogik.js";
import { ladeExposes, ladeRegelsatz } from "./laden.js";

const ziel = document.querySelector("#ansicht");
const statusmeldung = document.querySelector("#statusmeldung");

const zustand = {
  regelsatz: null,      // angewendeter Regelsatz (zu Beginn der Standard aus regeln.json)
  standard: null,       // Standard aus regeln.json, Vergleichsbasis für „Geändert“
  entwurf: null,        // nicht angewendeter Stand des Regel-Editors (bleibt beim Ansichtswechsel erhalten)
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
  ansichten.vorschauFreigeben();
  ansichten.markiereNavigation(route.ansicht);

  const fehler = blockierendeFehler(route.ansicht);
  if (fehler.length > 0) {
    const titel = route.ansicht === "regeln" ? "Regeln bearbeiten" : "Übersicht";
    ansichten.zeigeLadefehler(ziel, titel, fehler, starte);
    setzeTitel(titel);
  } else if (route.ansicht === "liste") {
    ansichten.zeigeUebersicht(ziel, { ...zustand, exposes: zustand.exposeDatei.exposes });
    setzeTitel("Übersicht");
  } else if (route.ansicht === "detail") {
    zeigeDetail(route.id);
  } else if (route.ansicht === "regeln") {
    zeigeEditor(ziel, {
      angewendet: zustand.regelsatz,
      standard: zustand.standard,
      entwurf: zustand.entwurf,
      exposes: zustand.exposeDatei?.exposes ?? null, // F-2: Editor bleibt ohne Exposés nutzbar
      melde,
      beiAenderung: (entwurf) => { zustand.entwurf = entwurf; },
      beiAnwenden,
      beiZuruecksetzen,
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

  ansichten.zeigeDetail(ziel, {
    expose,
    pruefung: zustand.pruefungen.get(id),
    regelsatz: zustand.regelsatz,
    vorheriges: reihe[stelle - 1] ?? null,
    naechstes: reihe[stelle + 1] ?? null,
  });
  setzeTitel(`${expose.id}: ${expose.titel}`);
}

// ---------- Regel-Editor: Anwenden und Zurücksetzen ----------

function rahmen() {
  const geaendert = Boolean(zustand.regelsatz && zustand.standard) && !regelsaetzeGleich(zustand.regelsatz, zustand.standard);
  ansichten.zeigeRahmen(zustand.regelsatz, zustand.exposeDatei, { geaendert });
}

// „Prüfen und anwenden“ war erfolgreich: neuer Regelsatz, neue Auswertung, Kopfzeile (A-13).
function beiAnwenden(regelsatz) {
  zustand.regelsatz = regelsatz;
  zustand.entwurf = null;
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

// ---------- Ereignisse ----------

window.addEventListener("hashchange", () => {
  const route = leseRoute();
  if (route) zeige(route, { fokus: true });
});

// Filter der Übersicht: wirkt sofort, ohne Absenden-Knopf (A-10). Ereignisdelegation am Ansichtsbereich.
ziel.addEventListener("change", (ereignis) => {
  if (ereignis.target.name !== "filter") return;
  zustand.filter = ereignis.target.value;
  const { sichtbar, gesamt } = ansichten.wendeFilterAn(ziel, zustand.filter, zustand.anzahl);
  melde(`${sichtbar} von ${gesamt} Exposés angezeigt.`);
});

window.addEventListener("resize", () => ansichten.aktualisiereScrollbereiche(ziel));

// ---------- Start ----------

async function starte() {
  // Das Skript läuft, also wurde die Seite über einen Webserver geöffnet (F-8).
  document.querySelector("#hinweis-webserver").hidden = true;
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
  if (zustand.regelsatz && zustand.exposeDatei) neuAuswerten();
  rahmen();
  zeige(leseRoute() ?? { ansicht: "liste" }, { fokus: false });

  if (zustand.pruefungen) {
    const aktive = zustand.regelsatz.regeln.filter((r) => r.aktiv).length;
    melde(`${zustand.exposeDatei.exposes.length} Exposés gegen ${aktive} aktive Regeln geprüft.`);
  } else {
    melde("Laden fehlgeschlagen. Details stehen in der Meldung auf der Seite.");
  }
}

starte();
