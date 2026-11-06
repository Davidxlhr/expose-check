// Strenge Schemaprüfung für regeln.json (beim Laden und beim Import) und Grundprüfung für exposes.json.
// Einzige Quelle der Feldschranken: Der Regel-Editor setzt seine Formularattribute (required, maxlength,
// min, max, step) aus SCHRANKEN, die Schemaprüfung nutzt dieselben Werte (Konzept 2.5, 7.6).
// Reines Modul ohne DOM-Zugriff.

import { istIsoDatum, istIsoDatumZeit, istLeer, wertAmPfad, zerlegePfad } from "./werte.js";

export const SCHEMA_VERSION = 1;

// Schranken je Eingabe. Namen entsprechen den Schlüsseln in regeln.json.
export const SCHRANKEN = Object.freeze({
  regelsatzName:      { required: true, maxlength: 120 },
  bezeichnung:        { required: true, maxlength: 80 },
  quelle:             { required: false, maxlength: 300 },
  feldBezeichnung:    { required: true, maxlength: 80 },
  katalogBezeichnung: { required: true, maxlength: 80 },
  katalogText:        { required: true, maxlength: 120 },
  katalogWertText:    { required: true, maxlength: 40 },
  katalogWertZahl:    { required: true, min: 0, step: 1 },
  anzahl:             { required: true, min: 0, step: 1 },
  kulanzTage:         { required: true, min: 0, max: 30, step: 1 },
  umfangMax:          { required: true, min: 0, step: "any" },
  muster:             { required: true, maxlength: 200 },
  musterBeschreibung: { required: true, maxlength: 80 },
});

export const DATENTYPEN = ["text", "zahl", "datum", "liste"];
export const STUFEN = ["verletzt", "hinweis"];

// Höchstens ein "[]" je Pfad, Segmente sind einfache Bezeichner (Konzept 2.5, Pfadsyntax).
const PFAD_MUSTER = /^[A-Za-z_][A-Za-z0-9_]*(\[\])?(\.[A-Za-z_][A-Za-z0-9_]*(\[\])?)*$/;
const REGEL_ID_MUSTER = /^R-\d{2,}$/; // mindestens zweistellig, nach oben offen (K-1)
const KATALOG_ID_MUSTER = /^[a-z][A-Za-z0-9]*$/;
const EXPOSE_ID_MUSTER = /^[A-Za-z0-9_-]{1,40}$/;

// ---------- Bausteine, auch von regeltypen.js (parameterTesten) genutzt ----------

export function typName(wert) {
  if (wert === null) return "null";
  if (Array.isArray(wert)) return "Liste";
  return { string: "Text", number: "Zahl", boolean: "Wahrheitswert", object: "Objekt" }[typeof wert] ?? typeof wert;
}

export function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

// Text prüfen: Pflicht (nicht leer nach trim) und Höchstlänge.
export function pruefeText(wert, pfad, schranke, fehler) {
  if (wert === undefined || wert === null) {
    if (schranke.required) fehler.push(`${pfad}: Angabe fehlt`);
    return;
  }
  if (typeof wert !== "string") return void fehler.push(`${pfad}: Text erwartet, gefunden ${typName(wert)}`);
  if (schranke.required && wert.trim() === "") fehler.push(`${pfad}: darf nicht leer sein`);
  if (schranke.maxlength !== undefined && wert.length > schranke.maxlength) {
    fehler.push(`${pfad}: höchstens ${schranke.maxlength} Zeichen (gefunden ${wert.length})`);
  }
}

// Zahl prüfen: endlich, min/max, bei step 1 ganzzahlig.
export function pruefeZahl(wert, pfad, schranke, fehler) {
  if (wert === undefined || wert === null) {
    if (schranke.required) fehler.push(`${pfad}: Angabe fehlt`);
    return;
  }
  if (typeof wert !== "number" || !Number.isFinite(wert)) {
    return void fehler.push(`${pfad}: Zahl erwartet, gefunden ${typName(wert)}`);
  }
  if (schranke.step === 1 && !Number.isInteger(wert)) fehler.push(`${pfad}: ganze Zahl erwartet`);
  if (schranke.min !== undefined && wert < schranke.min) fehler.push(`${pfad}: mindestens ${schranke.min}`);
  if (schranke.max !== undefined && wert > schranke.max) fehler.push(`${pfad}: höchstens ${schranke.max}`);
}

// Verweis auf einen Eintrag im Feldkatalog (felder), optional mit erlaubten Datentypen.
export function pruefeFeldverweis(wert, pfad, regelsatz, fehler, { datentypen = null, ohneListe = false } = {}) {
  if (typeof wert !== "string" || wert === "") return void fehler.push(`${pfad}: Feldpfad erwartet`);
  const feld = (regelsatz.felder ?? []).find((f) => f.pfad === wert);
  if (!feld) return void fehler.push(`${pfad}: Feld „${wert}“ steht nicht im Feldkatalog (felder)`);
  if (ohneListe && wert.includes("[]")) fehler.push(`${pfad}: Feld „${wert}“ darf kein [] enthalten`);
  if (datentypen && !datentypen.includes(feld.datentyp)) {
    fehler.push(`${pfad}: Feld „${wert}“ hat den Datentyp ${feld.datentyp}, erwartet ${datentypen.join(" oder ")}`);
  }
  return feld;
}

export function pruefeSchluessel(objekt, erlaubt, pfad, fehler) {
  for (const schluessel of Object.keys(objekt)) {
    if (!erlaubt.includes(schluessel)) fehler.push(`${pfad}.${schluessel}: unbekannter Schlüssel`);
  }
}

// ---------- regeln.json ----------

// Prüft einen Regelsatz vollständig. Liefert eine Liste deutscher Fehlermeldungen mit Pfad
// ("regeln[3].parameter.max: Zahl erwartet"). Leere Liste = gültig.
// Die Registry wird übergeben, damit schema.js und regeltypen.js sich nicht gegenseitig importieren.
export function pruefeRegelsatz(daten, regeltypen) {
  const fehler = [];
  if (!istObjekt(daten)) return [`Oberste Ebene: Objekt erwartet, gefunden ${typName(daten)}`];

  if (daten.schemaVersion !== SCHEMA_VERSION) {
    // Ohne passende Version ist der Rest nicht sinnvoll prüfbar.
    return [`schemaVersion: ${SCHEMA_VERSION} erwartet, gefunden ${JSON.stringify(daten.schemaVersion) ?? "nichts"}`];
  }
  pruefeSchluessel(daten, ["schemaVersion", "name", "stand", "quelle", "felder", "kataloge", "regeln"], "Regelsatz", fehler);
  pruefeText(daten.name, "name", SCHRANKEN.regelsatzName, fehler);
  if (!istIsoDatum(daten.stand)) fehler.push("stand: Datum im Format JJJJ-MM-TT erwartet");
  pruefeText(daten.quelle, "quelle", SCHRANKEN.quelle, fehler);

  pruefeFelder(daten, fehler);
  pruefeKataloge(daten, fehler);

  if (!Array.isArray(daten.regeln)) {
    fehler.push("regeln: Liste erwartet");
    return lesbareMeldungen(fehler, daten);
  }
  const ids = new Set();
  daten.regeln.forEach((regel, i) => {
    const pfad = `regeln[${i}]`;
    if (!istObjekt(regel)) return void fehler.push(`${pfad}: Objekt erwartet`);
    pruefeSchluessel(regel, ["id", "bezeichnung", "typ", "aktiv", "stufe", "quelle", "parameter", "wenn"], pfad, fehler);

    if (typeof regel.id !== "string" || !REGEL_ID_MUSTER.test(regel.id)) {
      fehler.push(`${pfad}.id: Format R-01 erwartet`);
    } else if (ids.has(regel.id)) {
      fehler.push(`${pfad}.id: ${regel.id} kommt doppelt vor`);
    } else {
      ids.add(regel.id);
    }
    pruefeText(regel.bezeichnung, `${pfad}.bezeichnung`, SCHRANKEN.bezeichnung, fehler);
    if (typeof regel.aktiv !== "boolean") fehler.push(`${pfad}.aktiv: true oder false erwartet`);
    if (!STUFEN.includes(regel.stufe)) fehler.push(`${pfad}.stufe: „verletzt“ oder „hinweis“ erwartet`);
    pruefeText(regel.quelle, `${pfad}.quelle`, SCHRANKEN.quelle, fehler);

    const typ = regeltypen[regel.typ];
    if (!Object.hasOwn(regeltypen, regel.typ ?? "")) {
      fehler.push(`${pfad}.typ: unbekannter Regeltyp „${regel.typ}“ (bekannt: ${Object.keys(regeltypen).join(", ")})`);
    } else if (!istObjekt(regel.parameter)) {
      fehler.push(`${pfad}.parameter: Objekt erwartet`);
    } else {
      for (const meldung of typ.parameterTesten(regel.parameter, daten)) fehler.push(`${pfad}.parameter.${meldung}`);
    }

    if (regel.wenn !== undefined) pruefeBedingung(regel.wenn, `${pfad}.wenn`, daten, fehler);
  });
  return lesbareMeldungen(fehler, daten);
}

function pruefeFelder(daten, fehler) {
  if (!Array.isArray(daten.felder) || daten.felder.length === 0) {
    return void fehler.push("felder: nicht leere Liste erwartet");
  }
  const pfade = new Set();
  daten.felder.forEach((feld, i) => {
    const pfad = `felder[${i}]`;
    if (!istObjekt(feld)) return void fehler.push(`${pfad}: Objekt erwartet`);
    pruefeSchluessel(feld, ["pfad", "bezeichnung", "datentyp", "elementName", "elementBezeichnung"], pfad, fehler);
    if (typeof feld.pfad !== "string" || !PFAD_MUSTER.test(feld.pfad) || (feld.pfad.match(/\[\]/g) ?? []).length > 1) {
      fehler.push(`${pfad}.pfad: gültiger Pfad erwartet (Punktnotation, höchstens ein [])`);
    } else if (pfade.has(feld.pfad)) {
      fehler.push(`${pfad}.pfad: „${feld.pfad}“ kommt doppelt vor`);
    } else {
      pfade.add(feld.pfad);
    }
    pruefeText(feld.bezeichnung, `${pfad}.bezeichnung`, SCHRANKEN.feldBezeichnung, fehler);
    if (!DATENTYPEN.includes(feld.datentyp)) fehler.push(`${pfad}.datentyp: einer von ${DATENTYPEN.join(", ")} erwartet`);
    for (const schluessel of ["elementName", "elementBezeichnung"]) {
      if (feld[schluessel] !== undefined) pruefeText(feld[schluessel], `${pfad}.${schluessel}`, { required: true, maxlength: 80 }, fehler);
    }
  });
  // Ein Pfad mit "[]" braucht ein Listenfeld für den Teil davor (für Elementbezeichnungen).
  daten.felder.forEach((feld, i) => {
    if (typeof feld?.pfad !== "string" || !feld.pfad.includes("[]")) return;
    const liste = feld.pfad.slice(0, feld.pfad.indexOf("[]"));
    const listenFeld = daten.felder.find((f) => f?.pfad === liste);
    if (!listenFeld || listenFeld.datentyp !== "liste") {
      fehler.push(`felder[${i}].pfad: zu „${feld.pfad}“ fehlt ein Feld „${liste}“ mit Datentyp liste`);
    }
  });
}

function pruefeKataloge(daten, fehler) {
  if (!istObjekt(daten.kataloge)) return void fehler.push("kataloge: Objekt erwartet");
  for (const [id, katalog] of Object.entries(daten.kataloge)) {
    const pfad = `kataloge.${id}`;
    if (!KATALOG_ID_MUSTER.test(id)) fehler.push(`${pfad}: Katalog-ID nur aus Buchstaben und Ziffern, beginnend mit Kleinbuchstaben`);
    if (!istObjekt(katalog)) { fehler.push(`${pfad}: Objekt erwartet`); continue; }
    pruefeSchluessel(katalog, ["bezeichnung", "werte"], pfad, fehler);
    pruefeText(katalog.bezeichnung, `${pfad}.bezeichnung`, SCHRANKEN.katalogBezeichnung, fehler);
    if (!Array.isArray(katalog.werte) || katalog.werte.length === 0) {
      fehler.push(`${pfad}.werte: nicht leere Liste erwartet`);
      continue;
    }
    // Ein Katalog enthält entweder nur Zahlen oder nur Texte (bestimmt das Eingabefeld im Editor).
    const art = typeof katalog.werte[0]?.wert === "number" ? "number" : "string";
    const gesehen = new Set();
    katalog.werte.forEach((eintrag, j) => {
      const epfad = `${pfad}.werte[${j}]`;
      if (!istObjekt(eintrag)) return void fehler.push(`${epfad}: Objekt erwartet`);
      pruefeSchluessel(eintrag, ["wert", "text"], epfad, fehler);
      if (typeof eintrag.wert !== art) {
        fehler.push(`${epfad}.wert: ${art === "number" ? "Zahl" : "Text"} erwartet wie beim ersten Eintrag`);
      } else {
        if (art === "number") pruefeZahl(eintrag.wert, `${epfad}.wert`, SCHRANKEN.katalogWertZahl, fehler);
        else pruefeText(eintrag.wert, `${epfad}.wert`, SCHRANKEN.katalogWertText, fehler);
        if (gesehen.has(eintrag.wert)) fehler.push(`${epfad}.wert: Wert ${JSON.stringify(eintrag.wert)} kommt doppelt vor`);
        gesehen.add(eintrag.wert);
      }
      pruefeText(eintrag.text, `${epfad}.text`, SCHRANKEN.katalogText, fehler);
    });
  }
}

function pruefeBedingung(wenn, pfad, daten, fehler) {
  if (!istObjekt(wenn)) return void fehler.push(`${pfad}: Objekt mit feld und gleich erwartet`);
  pruefeSchluessel(wenn, ["feld", "gleich"], pfad, fehler);
  pruefeFeldverweis(wenn.feld, `${pfad}.feld`, daten, fehler, { ohneListe: true });
  if (!["string", "number", "boolean"].includes(typeof wenn.gleich)) {
    fehler.push(`${pfad}.gleich: Text, Zahl oder Wahrheitswert erwartet`);
  }
}

// ---------- exposes.json ----------

// Grundprüfung der Exposé-Datei. Abgelehnt wird nur, was die App als Ganzes unbrauchbar macht
// (Version, Liste, eindeutige IDs, Herkunft). Fehler in einzelnen Angaben werden nicht hier gemeldet,
// sondern führen bei der Auswertung zu "Nicht prüfbar" (Konzept 6.6, F-4).
export function pruefeExposeDatei(daten) {
  const fehler = [];
  if (!istObjekt(daten)) return [`Oberste Ebene: Objekt erwartet, gefunden ${typName(daten)}`];
  if (daten.schemaVersion !== SCHEMA_VERSION) {
    return [`schemaVersion: ${SCHEMA_VERSION} erwartet, gefunden ${JSON.stringify(daten.schemaVersion) ?? "nichts"}`];
  }
  if (!istObjekt(daten.meta)) fehler.push("meta: Objekt mit Herkunftsangabe erwartet");
  else pruefeText(daten.meta.herkunft, "meta.herkunft", { required: true, maxlength: 500 }, fehler);

  if (!Array.isArray(daten.exposes)) return [...fehler, "exposes: Liste erwartet"];
  const ids = new Set();
  daten.exposes.forEach((expose, i) => {
    const pfad = `exposes[${i}]`;
    if (!istObjekt(expose)) return void fehler.push(`${pfad}: Objekt erwartet`);
    if (typeof expose.id !== "string" || !EXPOSE_ID_MUSTER.test(expose.id)) {
      fehler.push(`${pfad}.id: Kennung aus Buchstaben, Ziffern, - oder _ erwartet`);
    } else if (ids.has(expose.id)) {
      fehler.push(`${pfad}.id: ${expose.id} kommt doppelt vor`);
    } else {
      ids.add(expose.id);
    }
  });
  return fehler;
}

// Formatprüfung der Angaben gegen den Feldkatalog (felder) des Regelsatzes (S-1 b).
// Fehlende Angaben sind kein Formatfehler (das melden Pflichtfeld-Regeln). Ein vorhandener Wert im falschen
// Format (z. B. eingang „07.11.2026“ statt „2026-11-07“) würde sonst still zu „nicht prüfbar“ und fiele
// in der Ampel nicht auf. Die Datei wird trotzdem verwendet; die Liste erscheint als Datenhinweis.
const FORMAT = {
  datum: { passt: istIsoDatumZeit, text: "Datum im Format JJJJ-MM-TT (optional mit Uhrzeit THH:MM)" },
  zahl: { passt: (w) => typeof w === "number" && Number.isFinite(w), text: "Zahl" },
  text: { passt: (w) => typeof w === "string", text: "Text" },
  liste: { passt: Array.isArray, text: "Liste" },
};

export function pruefeAngabenformat(daten, felder) {
  const fehler = [];
  const zeige = (wert) => (typeof wert === "string" ? `„${wert}“` : JSON.stringify(wert));
  daten.exposes.forEach((expose, i) => {
    for (const feld of felder) {
      const format = FORMAT[feld.datentyp];
      const { listenPfad, unterPfad } = zerlegePfad(feld.pfad);
      const stellen = listenPfad === null
        ? [[feld.pfad, wertAmPfad(expose, feld.pfad)]]
        : (Array.isArray(wertAmPfad(expose, listenPfad)) ? wertAmPfad(expose, listenPfad) : [])
          .map((element, j) => [`${listenPfad}[${j}].${unterPfad}`, element && typeof element === "object" ? wertAmPfad(element, unterPfad) : undefined]);
      for (const [pfad, wert] of stellen) {
        if (wert === undefined || wert === null || (typeof wert === "string" && istLeer(wert))) continue;
        if (!format.passt(wert)) fehler.push(`${expose.id ?? `exposes[${i}]`}, ${pfad}: ${format.text} erwartet, gefunden ${zeige(wert)}`);
      }
    }
  });
  return fehler;
}

// ---------- Lesbare Meldungen (nur Darstellung, die Prüfung selbst bleibt unverändert) ----------

// Die Prüfung erzeugt technische Pfade ab 0 („regeln[5].parameter.max“). Für die Lehrperson wird jede
// regel- bzw. katalogbezogene Meldung um eine Kennung ergänzt, die sie in der Oberfläche wiederfindet:
//   Regel R-06 (regeln[5]) – parameter.max: Zahl erwartet, gefunden Text
//   Regel 6 von 18, ohne gültige ID (regeln[5]) – id: Format R-01 erwartet
//   Katalog „Theoretische Schwerpunkte“, Eintrag 9 (kataloge.schwerpunkte.werte[8]) – wert: Wert 6 kommt doppelt vor
// Form: Kennung zuerst (die ID steht so auch im Editor und in der Detailansicht), der technische Pfad bleibt
// in Klammern stehen, damit die Stelle in der JSON-Datei auffindbar ist. Eine ID gilt nur als lesbar, wenn sie
// das erwartete Format hat; sonst zählt die Position ab 1 („Regel 6 von 18“). Nachträgliche Umformung statt
// geänderter Pfade in den Prüffunktionen: So bleiben Prüflogik und Pfade für Tests und Fehlersuche gleich.
function lesbareMeldungen(fehler, daten) {
  return fehler.map((meldung) => lesbareMeldung(meldung, daten));
}

function lesbareMeldung(meldung, daten) {
  const regel = /^(regeln\[(\d+)\])(?:\.([^:]+))?: ([\s\S]*)$/.exec(meldung);
  if (regel) {
    const [, pfad, nummer, rest, text] = regel;
    const i = Number(nummer);
    const id = daten.regeln?.[i]?.id;
    const kennung = typeof id === "string" && REGEL_ID_MUSTER.test(id)
      ? `Regel ${id}`
      : `Regel ${i + 1} von ${daten.regeln.length}, ohne gültige ID`;
    return `${kennung} (${pfad}) – ${rest ? `${rest}: ` : ""}${text}`;
  }
  const eintrag = /^(kataloge\.([^.\s:]+)\.werte\[(\d+)\])(?:\.([^:]+))?: ([\s\S]*)$/.exec(meldung);
  if (eintrag) {
    const [, pfad, katalogId, nummer, rest, text] = eintrag;
    const bezeichnung = daten.kataloge?.[katalogId]?.bezeichnung;
    const name = typeof bezeichnung === "string" && bezeichnung.trim() !== "" ? bezeichnung : katalogId;
    return `Katalog „${name}“, Eintrag ${Number(nummer) + 1} (${pfad}) – ${rest ? `${rest}: ` : ""}${text}`;
  }
  return meldung;
}
