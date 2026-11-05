// Logik des Regel-Editors ohne DOM-Zugriff (mit Node testbar): Regeln aus Formulardaten erzeugen,
// neue Regeln und IDs, Katalogeinträge, eigene Prüfungen, deutsche Meldungen je ValidityState,
// Vorschautexte. Das Formular selbst baut editor.js.

import { AMPEL_TEXT, GESAMTSTATUS, anzeigeMitKatalog } from "./auswertung.js";
import { REGELTYPEN, kompiliereMuster } from "./regeltypen.js";

// Formularfelder, die zur Regel selbst gehören; alle übrigen sind Parameter des Regeltyps.
const REGEL_SCHLUESSEL = ["bezeichnung", "stufe", "aktiv", "quelle"];

// ---------- Regeln ----------

// Nummer einer Regel-ID: „R-19“ → 19 (0, wenn das Format nicht passt).
export function regelNummer(id) {
  return Number(/^R-(\d+)$/.exec(id)?.[1] ?? 0);
}

// Nächste Regel-ID: höchste Nummer + 1, mindestens zweistellig („R-19“). „bisherHoechste“ ist die höchste
// je vergebene Nummer; so wird eine ID auch nach dem Entfernen nicht erneut vergeben (Konzept 2.5).
export function naechsteRegelId(regeln, bisherHoechste = 0) {
  const hoechste = regeln.reduce((max, r) => Math.max(max, regelNummer(r.id)), bisherHoechste);
  return `R-${String(hoechste + 1).padStart(2, "0")}`;
}

// Neue Regel mit sinnvollen Standardwerten; hinzufügbar sind pflichtfeld und anzahl (Konzept A-14).
export function neueRegel(typ, regelsatz, bisherHoechste = 0) {
  const regeltyp = REGELTYPEN[typ];
  if (!regeltyp?.hinzufuegbar) throw new Error(`Regeln vom Typ „${typ}“ lassen sich hier nicht hinzufügen.`);
  return {
    id: naechsteRegelId(regelsatz.regeln, bisherHoechste),
    bezeichnung: `Neue Regel: ${regeltyp.bezeichnung}`,
    typ,
    aktiv: true,
    stufe: "verletzt",
    quelle: "Eigene Ergänzung im Regel-Editor",
    parameter: regeltyp.standardParameter(regelsatz),
  };
}

// Erzeugt aus den Formulardaten eines Regelblocks die neue Regel. `daten` enthält bereits typgerechte
// Werte (Zahl, Wahrheitswert, Text). ID, Typ und Bedingung bleiben unverändert (im Editor nicht änderbar),
// ebenso Parameter ohne Formularfeld (z. B. umfang.messung).
// Eine leere Quelle wird als „keine Quelle“ gespeichert (der Schlüssel ist optional), damit ein Regelsatz
// ohne Quellenangabe durch das bloße Öffnen im Editor nicht als geändert gilt (K-2).
export function regelAusFormulardaten(bisher, daten) {
  const regel = structuredClone(bisher);
  for (const [name, wert] of Object.entries(daten)) {
    if (name === "quelle" && wert.trim() === "") delete regel.quelle;
    else if (REGEL_SCHLUESSEL.includes(name)) regel[name] = wert;
    else regel.parameter[name] = wert;
  }
  return regel;
}

export function entferneRegel(regelsatz, id) {
  return { ...regelsatz, regeln: regelsatz.regeln.filter((r) => r.id !== id) };
}

// ---------- Kataloge ----------

export function katalogArt(katalog) {
  return typeof katalog.werte[0]?.wert === "number" ? "zahl" : "text";
}

// Vorschlag für einen neuen Eintrag: bei Zahlenkatalogen die nächste Zahl, sonst leer.
export function neuerKatalogeintrag(katalog) {
  if (katalogArt(katalog) === "zahl") {
    const hoechste = katalog.werte.reduce((max, w) => Math.max(max, w.wert), 0);
    return { wert: hoechste + 1, text: "" };
  }
  return { wert: "", text: "" };
}

// Positionen der Einträge, deren Wert bereits weiter oben vorkommt (der erste bleibt gültig).
export function doppelteWerte(werte) {
  const gesehen = new Set();
  const doppelt = new Set();
  werte.forEach((wert, i) => {
    if (wert === "" || wert === null || Number.isNaN(wert)) return;
    if (gesehen.has(wert)) doppelt.add(i);
    gesehen.add(wert);
  });
  return doppelt;
}

// ---------- eigene Prüfungen (setCustomValidity, Konzept 7.3) ----------

export function minMaxMeldung(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= max) return "";
  return "Der Höchstwert muss mindestens so groß sein wie der Mindestwert.";
}

// Muster muss sich wie das HTML-Attribut pattern mit Flag v kompilieren lassen (WHATWG HTML, pattern).
export function musterMeldung(muster) {
  if (muster === "") return ""; // das Fehlen meldet required
  try {
    kompiliereMuster(muster);
    return "";
  } catch {
    return "Ungültiges Muster. In eckigen Klammern Sonderzeichen wie - mit \\ maskieren.";
  }
}

export function doppelMeldung(wert) {
  return `Der Wert ${wert} steht in diesem Katalog schon weiter oben.`;
}

// Nur Leerzeichen gelten für den Browser als ausgefüllt, für die Schemaprüfung (trim) aber als leer.
export function leerzeichenMeldung(wert, label) {
  return wert !== "" && wert.trim() === "" ? `Bitte ${label} angeben.` : "";
}

// ---------- Meldungen je ValidityState (Konzept 7.4) ----------

// Feldbezeichnung für Meldungen: ohne Zusatz in Klammern („Stichtag (einschließlich)“ → „Stichtag“).
export function kurzLabel(label) {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Liefert die deutsche Meldung für einen ValidityState (oder ein Objekt mit denselben Merkmalen).
// Reihenfolge: badInput vor valueMissing, weil ein unvollständiges Datum zugleich als leer gelten kann.
// typeMismatch gilt nur für email/url und kommt hier nicht vor.
export function feldmeldung(validity, { typ, label, min, max, maxlength, eigeneMeldung = "" }) {
  if (validity.valid) return "";
  const name = kurzLabel(label);
  if (validity.badInput) {
    if (typ === "date") return "Bitte ein vollständiges Datum eingeben.";
    if (typ === "time") return "Bitte eine vollständige Uhrzeit (Stunden und Minuten) eingeben.";
    return "Bitte eine Zahl eingeben.";
  }
  if (validity.valueMissing) return `Bitte ${name} angeben.`;
  if (validity.rangeUnderflow) return `${name} muss mindestens ${min} sein.`;
  if (validity.rangeOverflow) return `${name} darf höchstens ${max} sein.`;
  if (validity.stepMismatch) return "Bitte eine ganze Zahl eingeben.";
  if (validity.tooLong) return `Höchstens ${maxlength} Zeichen.`;
  if (validity.customError) return eigeneMeldung;
  return `${name} ist ungültig.`;
}

// ---------- Anzeige ----------

// Feldauswahl aus dem Feldkatalog, gefiltert nach Datentyp; Unterfelder mit Listenpräfix.
export function feldOptionen(regelsatz, datentypen = null, { ohneUnterfelder = false } = {}) {
  return regelsatz.felder
    .filter((f) => !datentypen || datentypen.includes(f.datentyp))
    .filter((f) => !ohneUnterfelder || !f.pfad.includes("[]"))
    .map((f) => ({ wert: f.pfad, text: feldBezeichnung(regelsatz, f.pfad) }));
}

// Unterfelder einer Liste für das Merkmal von „eindeutig“ (Werte ohne Listenpräfix).
export function merkmalOptionen(regelsatz, liste) {
  return regelsatz.felder
    .filter((f) => f.pfad.startsWith(`${liste}[].`))
    .map((f) => ({ wert: f.pfad.slice(liste.length + 3), text: f.bezeichnung }));
}

export function feldBezeichnung(regelsatz, pfad) {
  const feld = regelsatz.felder.find((f) => f.pfad === pfad);
  if (!feld) return pfad;
  if (!pfad.includes("[]")) return feld.bezeichnung;
  const liste = regelsatz.felder.find((f) => f.pfad === pfad.slice(0, pfad.indexOf("[]")));
  return `${liste?.bezeichnung ?? ""} › ${feld.bezeichnung}`;
}

export function bedingungText(regel, regelsatz) {
  if (!regel.wenn) return null;
  return `Gilt nur bei ${anzeigeMitKatalog(regelsatz, regel.wenn.feld, regel.wenn.gleich)} ` +
    `(${feldBezeichnung(regelsatz, regel.wenn.feld)}). Die Bedingung lässt sich hier nicht ändern.`;
}

// Teile der Live-Vorschau: je Gesamtstatus Anzahl und Vergleich mit dem angewendeten Stand.
export function vorschauTeile(neu, angewendet) {
  return GESAMTSTATUS.map((status) => ({
    status,
    text: `${neu[status]} ${status === "ok" ? "ohne Auffälligkeiten" : AMPEL_TEXT[status]}`,
    vorher: angewendet && angewendet[status] !== neu[status] ? angewendet[status] : null,
  }));
}

// Inhaltlicher Vergleich zweier Regelsätze, unabhängig von der Reihenfolge der Schlüssel
// (z. B. wenn eine Quelle entfernt und wieder eingetragen wurde) und mit leerer Quelle = keine Quelle.
export function regelsaetzeGleich(a, b) {
  return stabil(normalisiere(a)) === stabil(normalisiere(b));
}

function normalisiere(regelsatz) {
  if (!regelsatz?.regeln) return regelsatz;
  return { ...regelsatz, regeln: regelsatz.regeln.map(({ quelle, ...rest }) => (quelle ? { ...rest, quelle } : rest)) };
}

function stabil(wert) {
  if (Array.isArray(wert)) return `[${wert.map(stabil).join(",")}]`;
  if (wert && typeof wert === "object") {
    return `{${Object.keys(wert).sort().map((k) => `${JSON.stringify(k)}:${stabil(wert[k])}`).join(",")}}`;
  }
  return JSON.stringify(wert);
}

export function regelMeldung(regel, aktion) {
  return `Regel ${regel.id} (${REGELTYPEN[regel.typ].bezeichnung}) ${aktion}.`;
}

export function eintragMeldung(katalog, wert, aktion) {
  return `Eintrag ${wert === "" ? "(leer)" : wert} ${aktion === "hinzugefügt" ? "zu" : "aus"} „${katalog.bezeichnung}“ ${aktion}.`;
}

// Meldung für einen neuen Katalogeintrag (K-4): Bei Zahlenkatalogen ist der Wert vorbelegt,
// bei Textkatalogen sind Wert und Text leer.
export function neuerEintragMeldung(katalog, eintrag) {
  return katalogArt(katalog) === "zahl" && eintrag.wert !== ""
    ? `Eintrag ${eintrag.wert} zu „${katalog.bezeichnung}“ hinzugefügt. Bitte den Text ergänzen.`
    : `Neuer Eintrag in „${katalog.bezeichnung}“ hinzugefügt. Bitte Wert und Text ergänzen.`;
}

// Info-Zeile eines Katalogs; wird nach jeder Änderung neu berechnet, damit sie nach dem Entfernen oder
// Ändern einer Katalog-Regel nicht veraltet (K-3).
export function katalogInfo(id, katalog, regeln) {
  const nutzer = regeln.filter((r) => r.typ === "katalog" && r.parameter.katalog === id).map((r) => r.id);
  return `${katalogArt(katalog) === "zahl" ? "Zahlenwerte" : "Textwerte"} · verwendet von ${nutzer.length > 0 ? nutzer.join(", ") : "keiner Regel"}`;
}

export function nichtAngewendetMeldung(n) {
  return `Nicht angewendet: ${fehlerzahlText(n)}.`;
}

export function verworfenMeldung(n) {
  return n === 1 ? "1 ungültige Eingabe wurde verworfen." : `${n} ungültige Eingaben wurden verworfen.`;
}

export function fehlerzahlText(n) {
  return n === 1 ? "1 Eingabe muss korrigiert werden" : `${n} Eingaben müssen korrigiert werden`;
}

