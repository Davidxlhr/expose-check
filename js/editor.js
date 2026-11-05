// Regel-Editor (Konzept 7, Theorie-Element Schwerpunkt 6): Aufbau aus <template>-Bausteinen,
// Constraint Validation mit eigenen deutschen Meldungen, Fehlerübersicht mit Sprunglinks,
// dynamisch hinzufügbare Regeln und Katalogeinträge, Live-Vorschau im <output>.
// Die Logik ohne DOM-Bezug liegt in editorlogik.js; angewendet wird über Rückrufe aus main.js.

import { pruefeAlle, verteilung } from "./auswertung.js";
import { el, symbol } from "./ansichten.js";
import * as logik from "./editorlogik.js";
import { REGELTYPEN } from "./regeltypen.js";
import { SCHRANKEN, pruefeRegelsatz } from "./schema.js";
import { bindeImport } from "./speicher.js";

let form = null;
let entwurf = null;        // Arbeitsstand: enthält nur gültige Werte (Konzept 7.6)
let optionen = null;       // { angewendet, exposes, kennzeichen, melde, beiAenderung, beiAnwenden, beiZuruecksetzen, beiExport, beiImport }
let anzahlAngewendet = null;
let eintragZaehler = 0;    // für eindeutige IDs neuer Katalogzeilen

// ---------- Aufbau ----------

export function zeigeEditor(ziel, opts) {
  optionen = opts;
  entwurf = structuredClone(opts.entwurf ?? opts.angewendet);
  anzahlAngewendet = opts.exposes ? verteilung(pruefeAlle(opts.exposes, opts.angewendet)) : null;

  ziel.replaceChildren(vorlage("vorlage-editor"));
  form = ziel.querySelector("#regel-editor");

  const kopf = form.querySelector('[data-block="kopf"]');
  verdrahte(kopf, "regelsatz");
  setzeWerte(kopf, { name: entwurf.name, stand: entwurf.stand });

  form.querySelector("[data-regel-liste]").append(...entwurf.regeln.map(regelBlock));

  form.querySelector("#neuer-regeltyp").append(...Object.entries(REGELTYPEN)
    .filter(([, typ]) => typ.hinzufuegbar)
    .map(([name, typ]) => el("option", { value: name }, `${typ.bezeichnung} – ${typ.beschreibung}`)));

  form.querySelector("[data-katalog-liste]").append(
    ...Object.entries(entwurf.kataloge).map(([id, katalog]) => katalogBlock(id, katalog)));

  // Ereignisdelegation: ein Satz Listener am form, auch für später hinzugefügte Felder (Konzept 7.5).
  // focusout statt blur, weil blur nicht blubbert (UI Events, Tabelle der Fokusereignisse).
  form.addEventListener("input", beiEingabe);
  form.addEventListener("change", beiAenderung);
  form.addEventListener("focusout", beiVerlassen);
  form.addEventListener("submit", beiAbsenden);
  // Klicks auch außerhalb des form: Einleitung, Sprungnavigation und Abschnitt „Regelsatz verwalten“.
  ziel.querySelectorAll(".ansicht-kopf, .regel-nav, #regel-editor, .verwaltung").forEach((bereich) => bereich.addEventListener("click", beiKlick));
  beobachteLeiste(form.querySelector(".editor-leiste"));
  bindeImport(ziel.querySelector("[data-import-platz]"), "import", { beiErfolg: optionen.beiImport, melde: optionen.melde });

  aktualisiereAnzeigen();
}

// Die klebende Leiste darf fokussierte Felder nicht verdecken (WCAG 2.2, 2.4.11 Focus Not Obscured):
// Ihre Höhe geht als scroll-padding-bottom an die Seite, das beim Fokussieren berücksichtigt wird.
let leistenBeobachter = null;
function beobachteLeiste(leiste) {
  leistenBeobachter?.disconnect();
  leistenBeobachter = new ResizeObserver(() => {
    document.documentElement.style.setProperty("--leiste-hoehe", `${Math.ceil(leiste.getBoundingClientRect().height)}px`);
  });
  leistenBeobachter.observe(leiste);
}

function vorlage(id) {
  return document.getElementById(id).content.cloneNode(true);
}

// Vergibt IDs nach dem Muster <präfix>-<feld>, verknüpft label/for und aria-describedby
// (Hilfe + Fehler) und setzt die Schranken aus SCHRANKEN (einzige Quelle, Konzept 7.6).
function verdrahte(wurzel, praefix) {
  for (const feld of wurzel.querySelectorAll("[data-feld]")) {
    const schluessel = feld.dataset.feld;
    feld.id = `${praefix}-${schluessel}`;
    feld.name = feld.dataset.name ?? schluessel;
    wurzel.querySelector(`label[data-fuer="${schluessel}"]`)?.setAttribute("for", feld.id);
    const beschreibung = [];
    const hilfe = wurzel.querySelector(`[data-hilfe="${schluessel}"]`);
    if (hilfe) { hilfe.id = `${feld.id}-hilfe`; beschreibung.push(hilfe.id); }
    const fehler = wurzel.querySelector(`[data-fehler="${schluessel}"]`);
    if (fehler) { fehler.id = `${feld.id}-fehler`; beschreibung.push(fehler.id); }
    if (beschreibung.length > 0) feld.setAttribute("aria-describedby", beschreibung.join(" "));
    if (feld.dataset.schranke) setzeSchranke(feld, SCHRANKEN[feld.dataset.schranke]);
  }
}

function setzeSchranke(feld, schranke) {
  if (schranke.required) feld.required = true;
  if (schranke.maxlength !== undefined) feld.maxLength = schranke.maxlength;
  if (schranke.min !== undefined) feld.min = String(schranke.min);
  if (schranke.max !== undefined) feld.max = String(schranke.max);
  if (schranke.step !== undefined) feld.step = String(schranke.step);
}

function schluesselVon(feld) {
  return feld.dataset.name ?? feld.dataset.feld;
}

function setzeWerte(wurzel, werte) {
  for (const feld of wurzel.querySelectorAll("[data-feld]")) {
    const wert = werte[schluesselVon(feld)];
    if (feld.type === "checkbox") feld.checked = Boolean(wert);
    else if (feld.type === "radio") feld.checked = feld.value === wert;
    else feld.value = wert === undefined || wert === null ? "" : String(wert);
  }
}

// Typgerechter Wert eines Felds: Zahl bei number, Wahrheitswert bei checkbox, sonst Text.
function leseWert(feld) {
  if (feld.type === "checkbox") return feld.checked;
  if (feld.type === "number") return feld.valueAsNumber;
  return feld.value;
}

function blockDaten(block) {
  const daten = {};
  for (const feld of block.querySelectorAll("[data-feld]")) {
    if (feld.type === "radio") {
      if (feld.checked) daten[schluesselVon(feld)] = feld.value;
    } else {
      daten[schluesselVon(feld)] = leseWert(feld);
    }
  }
  return daten;
}

function fuelleAuswahl(auswahl, eintraege, gewaehlt) {
  auswahl.replaceChildren(...eintraege.map(({ wert, text }) => el("option", { value: wert }, text)));
  if (gewaehlt !== undefined) auswahl.value = gewaehlt;
}

// ID-Präfix der Felder einer Regel: R-16 → r16 (Konzept 7.2: „r16-stichtag“).
function praefixVon(regel) {
  return regel.id.replace("-", "").toLowerCase();
}

function regelBlock(regel) {
  const block = vorlage("vorlage-regel").firstElementChild;
  const typ = REGELTYPEN[regel.typ];
  const praefix = praefixVon(regel);
  block.dataset.regelId = regel.id;
  block.dataset.kennung = regel.id;
  block.querySelector("template[data-parameter]").replaceWith(vorlage(typ.formular));
  verdrahte(block, praefix);
  // Radiogruppe „Ergebnis bei Nichterfüllung“: je Regel eigener Name, sonst wäre es eine Gruppe über alle Regeln.
  for (const radio of block.querySelectorAll('input[type="radio"]')) radio.name = `${praefix}-stufe`;

  for (const auswahl of block.querySelectorAll("select[data-optionen]")) {
    const quelle = {
      felder: () => logik.feldOptionen(entwurf, typ.feldDatentypen),
      listen: () => logik.feldOptionen(entwurf, ["liste"], { ohneUnterfelder: true }),
      merkmale: () => logik.merkmalOptionen(entwurf, regel.parameter.liste),
      kataloge: () => Object.entries(entwurf.kataloge).map(([id, k]) => ({ wert: id, text: k.bezeichnung })),
    }[auswahl.dataset.optionen];
    fuelleAuswahl(auswahl, quelle());
  }
  setzeWerte(block, { ...regel.parameter, bezeichnung: regel.bezeichnung, stufe: regel.stufe, aktiv: regel.aktiv, quelle: regel.quelle ?? "" });
  for (const text of block.querySelectorAll("[data-regel-id-text]")) text.textContent = regel.id;
  block.querySelector("[data-typ-text]").textContent = `Typ: ${typ.bezeichnung} – ${typ.beschreibung}`;
  const bedingung = logik.bedingungText(regel, entwurf);
  if (bedingung) {
    const absatz = block.querySelector("[data-bedingung]");
    absatz.textContent = bedingung;
    absatz.hidden = false;
  }
  aktualisiereRegelTexte(block, regel);
  return block;
}

function aktualisiereRegelTexte(block, regel) {
  block.querySelector("[data-legende-text]").textContent = regel.bezeichnung;
  block.classList.toggle("regel-aus", !regel.aktiv);
}

function katalogBlock(id, katalog) {
  const block = vorlage("vorlage-katalog-block").firstElementChild;
  block.dataset.katalogId = id;
  block.dataset.kennung = katalog.bezeichnung;
  block.classList.toggle("text-katalog", logik.katalogArt(katalog) === "text");
  block.querySelector("[data-katalog-name]").textContent = katalog.bezeichnung;
  const nutzer = entwurf.regeln.filter((r) => r.typ === "katalog" && r.parameter.katalog === id).map((r) => r.id);
  block.querySelector("[data-katalog-info]").textContent =
    `${logik.katalogArt(katalog) === "zahl" ? "Zahlenwerte" : "Textwerte"} · verwendet von ${nutzer.length > 0 ? nutzer.join(", ") : "keiner Regel"}`;
  block.querySelector("[data-katalog-zusatz]").textContent = ` zu „${katalog.bezeichnung}“`;
  block.querySelector("[data-eintraege]").append(...katalog.werte.map((eintrag) => eintragZeile(katalog, eintrag)));
  nummeriereEintraege(block);
  return block;
}

function eintragZeile(katalog, eintrag) {
  const zeile = vorlage("vorlage-katalogeintrag").firstElementChild;
  const wertFeld = zeile.querySelector('[data-feld="wert"]');
  // Zahlenkataloge erfassen den Wert als Zahl (Konzept 7.5), Textkataloge als Text.
  if (logik.katalogArt(katalog) === "zahl") {
    wertFeld.type = "number";
    wertFeld.inputMode = "numeric";
    wertFeld.dataset.schranke = "katalogWertZahl";
  } else {
    wertFeld.type = "text";
    wertFeld.dataset.schranke = "katalogWertText";
  }
  eintragZaehler += 1;
  verdrahte(zeile, `k${eintragZaehler}`);
  setzeWerte(zeile, eintrag);
  return zeile;
}

// Zugängliche Namen mit Position, damit „Wert“, „Text“ und „Entfernen“ je Zeile unterscheidbar sind.
function nummeriereEintraege(block) {
  const name = block.dataset.kennung;
  block.querySelectorAll("[data-eintrag]").forEach((zeile, i) => {
    zeile.dataset.kennung = `${name}, Eintrag ${i + 1}`;
    for (const zusatz of zeile.querySelectorAll("[data-eintrag-zusatz]")) zusatz.textContent = ` – ${name}, Eintrag ${i + 1}`;
  });
}

function zeilenWerte(block) {
  return [...block.querySelectorAll("[data-eintrag]")].map((zeile) => ({
    wert: leseWert(zeile.querySelector('[data-feld="wert"]')),
    text: zeile.querySelector('[data-feld="text"]').value,
  }));
}

// ---------- Prüfung (Konzept 7.3, 7.4) ----------

function istFeld(ziel) {
  return ziel instanceof HTMLElement && ziel.matches("input[data-feld], select[data-feld]");
}

// Text des Labels ohne visuell versteckte Zusätze.
function labelText(feld) {
  const label = feld.labels?.[0];
  if (!label) return feld.name;
  const kopie = label.cloneNode(true);
  kopie.querySelectorAll(".visuell-versteckt").forEach((t) => t.remove());
  return kopie.textContent.trim();
}

// Eigene Prüfungen per setCustomValidity für alle Felder eines Bausteins neu setzen bzw. mit "" löschen.
function eigenePruefungen(block) {
  if (!block) return;
  const min = block.querySelector('[data-feld="min"]');
  const doppelt = block.dataset.block === "katalog"
    ? logik.doppelteWerte(zeilenWerte(block).map((z) => z.wert)) : new Set();
  const wertFelder = [...block.querySelectorAll('[data-feld="wert"]')];

  for (const feld of block.querySelectorAll("[data-feld]")) {
    let meldung = "";
    if (feld.type === "text" && feld.required) meldung = logik.leerzeichenMeldung(feld.value, logik.kurzLabel(labelText(feld)));
    if (!meldung && feld.dataset.feld === "muster") meldung = logik.musterMeldung(feld.value);
    if (!meldung && feld.dataset.feld === "max" && min) meldung = logik.minMaxMeldung(min.valueAsNumber, feld.valueAsNumber);
    if (!meldung && feld.dataset.feld === "wert" && doppelt.has(wertFelder.indexOf(feld))) meldung = logik.doppelMeldung(leseWert(feld));
    feld.setCustomValidity(meldung);
    feld.dataset.eigeneMeldung = meldung;
  }
}

// Felder, deren Gültigkeit von einem anderen Feld abhängt (min ↔ max, Werte eines Katalogs).
function verbundeneFelder(feld) {
  const block = feld.closest("[data-block]");
  if (feld.dataset.feld === "min" || feld.dataset.feld === "max") return [...block.querySelectorAll('[data-feld="min"], [data-feld="max"]')];
  if (feld.dataset.feld === "wert") return [...block.querySelectorAll('[data-feld="wert"]')];
  return [feld];
}

function meldungFuer(feld) {
  return logik.feldmeldung(feld.validity, {
    typ: feld.type,
    label: labelText(feld),
    min: feld.min,
    max: feld.max,
    maxlength: feld.maxLength,
    eigeneMeldung: feld.dataset.eigeneMeldung ?? "",
  });
}

function zeigeFeldstatus(feld) {
  const meldung = meldungFuer(feld);
  if (meldung) zeigeFehler(feld, meldung);
  else versteckeFehler(feld);
}

// Meldung am Feld: Text im verknüpften Absatz (aria-describedby) und aria-invalid zur selben Zeit,
// damit Optik ([aria-invalid="true"]) und Ansage synchron bleiben.
function zeigeFehler(feld, meldung) {
  const absatz = document.getElementById(`${feld.id}-fehler`);
  if (absatz) {
    absatz.replaceChildren(symbol("verletzt"), el("span", {}, meldung));
    absatz.hidden = false;
  }
  feld.setAttribute("aria-invalid", "true");
}

// Beim Ausblenden erst den Text leeren: Per aria-describedby referenzierter Inhalt geht auch versteckt
// in die Beschreibung ein (Accessible Name Computation, Schritt „Hidden Not Referenced“).
function versteckeFehler(feld) {
  const absatz = document.getElementById(`${feld.id}-fehler`);
  if (absatz) {
    absatz.textContent = "";
    absatz.hidden = true;
  }
  feld.removeAttribute("aria-invalid");
}

// Ein Baustein gilt als gültig, wenn jedes seiner Felder gültig ist. fieldset.checkValidity() hilft hier
// nicht: fieldset ist kein Kandidat für Constraint Validation und liefert immer true (MDN).
function blockGueltig(block) {
  return [...block.elements].every((feld) => !feld.willValidate || feld.validity.valid);
}

// ---------- Übernahme in den Entwurf ----------

// Übernimmt einen Baustein in den Entwurf – nur, wenn alle seine Felder gültig sind.
// Sonst bleibt der letzte gültige Stand (Konzept 7.6: „Ungültige Werte werden nicht übernommen“).
function uebernehme(block) {
  if (!block || !block.dataset.block || !blockGueltig(block)) return false;
  if (block.dataset.block === "regel") {
    const stelle = entwurf.regeln.findIndex((r) => r.id === block.dataset.regelId);
    entwurf.regeln[stelle] = logik.regelAusFormulardaten(entwurf.regeln[stelle], blockDaten(block));
    aktualisiereRegelTexte(block, entwurf.regeln[stelle]);
  } else if (block.dataset.block === "kopf") {
    Object.assign(entwurf, blockDaten(block));
  } else if (block.dataset.block === "katalog") {
    entwurf.kataloge[block.dataset.katalogId].werte = zeilenWerte(block);
  }
  return true;
}

function nachAenderung() {
  optionen.beiAenderung(entwurf);
  aktualisiereAnzeigen();
}

// ---------- Ereignisse ----------

// input: Eine angezeigte Meldung verschwindet, sobald das Feld wieder gültig ist.
// Neue Meldungen erscheinen erst bei change/focusout, nicht schon beim Tippen.
function beiEingabe(ereignis) {
  const feld = ereignis.target;
  if (!istFeld(feld)) return;
  eigenePruefungen(feld.closest("[data-block]"));
  for (const f of verbundeneFelder(feld)) {
    if (f.getAttribute("aria-invalid") === "true" && f.validity.valid) versteckeFehler(f);
  }
}

function beiAenderung(ereignis) {
  const feld = ereignis.target;
  if (!istFeld(feld)) return;
  const block = feld.closest("[data-block]");
  // Abhängige Auswahl: Liste gewechselt → Merkmale neu befüllen (Konzept 7.5).
  if (feld.dataset.feld === "liste") {
    fuelleAuswahl(block.querySelector('[data-feld="merkmal"]'), logik.merkmalOptionen(entwurf, feld.value));
  }
  eigenePruefungen(block);
  for (const f of verbundeneFelder(feld)) {
    if (f === feld || f.getAttribute("aria-invalid") === "true" || !f.validity.valid) zeigeFeldstatus(f);
  }
  if (uebernehme(block)) nachAenderung();
}

function beiVerlassen(ereignis) {
  const feld = ereignis.target;
  if (!istFeld(feld)) return;
  eigenePruefungen(feld.closest("[data-block]"));
  zeigeFeldstatus(feld);
}

function beiKlick(ereignis) {
  const sprung = ereignis.target.closest("a[data-sprung]");
  if (sprung) {
    ereignis.preventDefault(); // Hash bleibt #/regeln, der Router sieht nichts (Konzept 6.2)
    springeZuFeld(sprung.dataset.sprung);
    return;
  }
  const knopf = ereignis.target.closest("button[data-aktion]");
  if (!knopf) return;
  const aktionen = {
    "regel-hinzufuegen": regelHinzufuegen,
    "regel-entfernen": regelEntfernen,
    "eintrag-hinzufuegen": eintragHinzufuegen,
    "eintrag-entfernen": eintragEntfernen,
    zuruecksetzen: () => optionen.beiZuruecksetzen(),
    exportieren: () => optionen.beiExport({ ungueltig: zaehleUngueltige(), offen: hatOffeneAenderungen() }),
  };
  aktionen[knopf.dataset.aktion]?.(knopf);
}

// Sprunglink der Fehlerübersicht (Muster „Error summary“, GOV.UK Frontend, error-summary.mjs):
// Erst Legende oder Label sichtbar machen, dann das Feld ohne erneutes Scrollen fokussieren.
function springeZuFeld(id) {
  const feld = document.getElementById(id);
  if (!feld) return;
  legendeOderLabel(feld).scrollIntoView({ block: "start" });
  feld.focus({ preventScroll: true });
}

// Wie GOV.UK: die Legende des umgebenden fieldset, sofern das Feld danach noch in der oberen
// Bildschirmhälfte liegt (so bleibt sichtbar, zu welcher Regel es gehört), sonst das Label.
function legendeOderLabel(feld) {
  const legende = feld.closest("fieldset")?.querySelector(":scope > legend");
  if (legende) {
    const abstand = feld.getBoundingClientRect().bottom - legende.getBoundingClientRect().top;
    if (abstand < window.innerHeight / 2) return legende;
  }
  return feld.labels?.[0] ?? feld;
}

function beiAbsenden(ereignis) {
  ereignis.preventDefault(); // Die Daten gehen an kein Ziel, sie werden im Browser verarbeitet (F. 222)
  const bloecke = [...form.querySelectorAll("[data-block]")];
  bloecke.forEach(eigenePruefungen);
  const felder = [...form.elements].filter((f) => f.dataset?.feld && f.willValidate);
  felder.forEach(zeigeFeldstatus);
  const ungueltig = felder.filter((f) => !f.validity.valid);
  if (ungueltig.length > 0) {
    zeigeFehleruebersicht(ungueltig);
    return;
  }
  versteckeFehleruebersicht();
  bloecke.forEach(uebernehme);

  // Sicherheitsnetz: dieselbe Schemaprüfung wie beim Laden von regeln.json.
  const schemafehler = pruefeRegelsatz(entwurf, REGELTYPEN);
  if (schemafehler.length > 0) {
    console.error(schemafehler);
    optionen.melde(`Nicht angewendet: ${schemafehler[0]}`);
    return;
  }
  optionen.angewendet = structuredClone(entwurf);
  anzahlAngewendet = optionen.exposes ? verteilung(pruefeAlle(optionen.exposes, entwurf)) : null;
  optionen.beiAnwenden(structuredClone(entwurf));
  aktualisiereAnzeigen();
}

// Für den Export-Hinweis (A-19): ungültige Eingaben zählen, ohne Meldungen anzuzeigen.
function zaehleUngueltige() {
  form.querySelectorAll("[data-block]").forEach(eigenePruefungen);
  return [...form.elements].filter((f) => f.dataset?.feld && f.willValidate && !f.validity.valid).length;
}

function hatOffeneAenderungen() {
  return !logik.regelsaetzeGleich(entwurf, optionen.angewendet);
}

// Nach Aktionen außerhalb des Editors (Export): Kennzeichen neu zeichnen.
export function aktualisiereEditor() {
  if (form?.isConnected) aktualisiereAnzeigen();
}

// ---------- Fehlerübersicht ----------

function zeigeFehleruebersicht(ungueltig) {
  const uebersicht = form.querySelector("#fehleruebersicht");
  uebersicht.querySelector("h2").textContent = logik.fehlerzahlText(ungueltig.length);
  uebersicht.querySelector("ul").replaceChildren(...ungueltig.map((feld) =>
    el("li", {}, el("a", { href: `#${feld.id}`, "data-sprung": feld.id },
      `${feld.closest("[data-kennung]").dataset.kennung}: ${meldungFuer(feld)}`))));
  uebersicht.hidden = false;
  uebersicht.focus(); // tabindex="-1": fokussierbar per Skript, nicht in der Tab-Reihenfolge
}

function versteckeFehleruebersicht() {
  const uebersicht = form.querySelector("#fehleruebersicht");
  uebersicht.hidden = true;
  uebersicht.querySelector("ul").replaceChildren();
}

// Nach dem Entfernen eines Bausteins: Sprunglinks zu nicht mehr vorhandenen Feldern streichen.
function bereinigeFehleruebersicht() {
  const uebersicht = form.querySelector("#fehleruebersicht");
  if (uebersicht.hidden) return;
  for (const link of uebersicht.querySelectorAll("a[data-sprung]")) {
    if (!document.getElementById(link.dataset.sprung)) link.closest("li").remove();
  }
  const rest = uebersicht.querySelectorAll("li").length;
  if (rest === 0) versteckeFehleruebersicht();
  else uebersicht.querySelector("h2").textContent = logik.fehlerzahlText(rest);
}

// ---------- Hinzufügen und Entfernen (Fokus nach WCAG 2.4.3, Meldung nach 4.1.3) ----------

function regelHinzufuegen() {
  const typ = form.querySelector("#neuer-regeltyp").value;
  const regel = logik.neueRegel(typ, entwurf);
  entwurf.regeln.push(regel);
  const block = regelBlock(regel);
  form.querySelector("[data-regel-liste]").append(block);
  block.querySelector('[data-feld="bezeichnung"]').focus(); // erstes Feld des neuen Bausteins
  optionen.melde(logik.regelMeldung(regel, "hinzugefügt"));
  nachAenderung();
}

function regelEntfernen(knopf) {
  const block = knopf.closest('[data-block="regel"]');
  const regel = entwurf.regeln.find((r) => r.id === block.dataset.regelId);
  const vorherige = block.previousElementSibling;
  entwurf = logik.entferneRegel(entwurf, regel.id);
  block.remove();
  bereinigeFehleruebersicht();
  // Fokus auf die vorherige Regel, sonst auf die Auswahl „Regel hinzufügen“ (Konzept 7.5).
  (vorherige?.querySelector('[data-aktion="regel-entfernen"]') ?? form.querySelector("#neuer-regeltyp")).focus();
  optionen.melde(logik.regelMeldung(regel, "entfernt"));
  nachAenderung();
}

function eintragHinzufuegen(knopf) {
  const block = knopf.closest('[data-block="katalog"]');
  const katalog = entwurf.kataloge[block.dataset.katalogId];
  // Vorschlag aus den Zeilen im Formular, damit auch noch nicht übernommene Zeilen zählen.
  const eintrag = logik.neuerKatalogeintrag({ ...katalog, werte: zeilenWerte(block).filter((z) => !Number.isNaN(z.wert)) });
  const zeile = eintragZeile(katalog, eintrag);
  block.querySelector("[data-eintraege]").append(zeile);
  nummeriereEintraege(block);
  zeile.querySelector('[data-feld="wert"]').focus();
  optionen.melde(`${logik.eintragMeldung(katalog, eintrag.wert, "hinzugefügt")} Bitte den Text ergänzen.`);
  eigenePruefungen(block);
  if (uebernehme(block)) nachAenderung();
}

function eintragEntfernen(knopf) {
  const block = knopf.closest('[data-block="katalog"]');
  const katalog = entwurf.kataloge[block.dataset.katalogId];
  const zeilen = block.querySelectorAll("[data-eintrag]");
  if (zeilen.length === 1) {
    optionen.melde(`„${katalog.bezeichnung}“ braucht mindestens einen Eintrag. Der letzte Eintrag bleibt erhalten.`);
    return;
  }
  const zeile = knopf.closest("[data-eintrag]");
  const wert = leseWert(zeile.querySelector('[data-feld="wert"]'));
  const vorherige = zeile.previousElementSibling;
  zeile.remove();
  nummeriereEintraege(block);
  bereinigeFehleruebersicht();
  // Doppelte Werte können sich durch das Entfernen auflösen: Meldungen der übrigen Zeilen auffrischen.
  eigenePruefungen(block);
  for (const feld of block.querySelectorAll('[data-feld="wert"][aria-invalid="true"]')) zeigeFeldstatus(feld);
  (vorherige?.querySelector('[data-aktion="eintrag-entfernen"]') ?? block.querySelector('[data-aktion="eintrag-hinzufuegen"]')).focus();
  optionen.melde(logik.eintragMeldung(katalog, Number.isNaN(wert) ? "" : wert, "entfernt"));
  if (uebernehme(block)) nachAenderung();
}

// ---------- Anzeigen: Stand, Regelzahl, Vorschau ----------

function aktualisiereAnzeigen() {
  const aktive = entwurf.regeln.filter((r) => r.aktiv).length;
  form.querySelector("[data-regelzahl]").textContent = `${entwurf.regeln.length} Regeln, davon ${aktive} aktiv`;

  const stand = form.closest("#ansicht").querySelector("[data-stand]");
  const kennzeichen = optionen.kennzeichen();
  // replaceChildren würde false als Text „false“ einfügen; deshalb vorher filtern.
  stand.replaceChildren(...[
    el("span", { class: kennzeichen.art === "standard" ? "kennzeichen" : `kennzeichen kennzeichen-${kennzeichen.art}` },
      `Angewendet: ${kennzeichen.text}`),
    hatOffeneAenderungen() && el("span", { class: "kennzeichen kennzeichen-offen" }, "Nicht angewendete Änderungen"),
  ].filter(Boolean));

  // Sprungnavigation zu den Regeln (seitenintern, ohne Hash-Änderung).
  form.closest("#ansicht").querySelector("[data-regel-nav]").replaceChildren(...entwurf.regeln.map((regel) =>
    el("li", { class: regel.aktiv ? null : "nav-aus" },
      el("a", { href: `#${praefixVon(regel)}-bezeichnung`, "data-sprung": `${praefixVon(regel)}-bezeichnung` },
        el("span", { class: "mono" }, regel.id), " ", regel.bezeichnung))));

  // Live-Vorschau im <output> (Konzept 7.1): Ergebnis einer Berechnung aus den Formularwerten.
  const ausgabe = form.querySelector("#editor-vorschau");
  if (!optionen.exposes) {
    ausgabe.textContent = "Keine Exposé-Daten geladen – keine Vorschau möglich.";
    return;
  }
  const neu = verteilung(pruefeAlle(optionen.exposes, entwurf));
  ausgabe.replaceChildren(
    el("span", { class: "vorschau-titel" }, "Mit diesen Regeln:"),
    ...logik.vorschauTeile(neu, anzahlAngewendet).map((teil) =>
      el("span", { class: `vorschau-teil status-${teil.status}` }, symbol(teil.status),
        el("span", {}, teil.text),
        teil.vorher !== null && el("span", { class: "vorschau-vorher" }, ` (bisher ${teil.vorher})`))));
}
