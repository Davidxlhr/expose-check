// Werte und Pfade: Zugriff auf Angaben eines Exposé-Datensatzes und einheitliche Formatierung.
// Reines Modul ohne DOM-Zugriff (auch mit Node testbar). Konzept 2.1 und 2.5 (Pfadsyntax).

// Fehlender Wert nach Konzept 2.1: Schlüssel fehlt, null, leere Zeichenkette (nach trim) oder leeres Array.
export function istLeer(wert) {
  if (wert === undefined || wert === null) return true;
  if (typeof wert === "string") return wert.trim() === "";
  if (Array.isArray(wert)) return wert.length === 0;
  return false;
}

// Zerlegt einen Pfad wie "mitglieder[].schwerpunkte" in Listenteil und Unterpfad.
// Ohne "[]" ist listenPfad null. Höchstens ein "[]" je Pfad (prüft schema.js).
export function zerlegePfad(pfad) {
  const stelle = pfad.indexOf("[]");
  if (stelle === -1) return { listenPfad: null, unterPfad: pfad };
  return { listenPfad: pfad.slice(0, stelle), unterPfad: pfad.slice(stelle + 3) };
}

// Folgt einem einfachen Punktpfad ("a.b") in einem Objekt. Liefert undefined, sobald eine Stufe fehlt.
export function wertAmPfad(objekt, punktPfad) {
  let aktuell = objekt;
  for (const teil of punktPfad.split(".")) {
    if (aktuell === null || typeof aktuell !== "object" || Array.isArray(aktuell)) return undefined;
    aktuell = aktuell[teil];
  }
  return aktuell;
}

// Bezeichnung eines Listenelements für Begründungen (Konzept 3.1):
// Wert von elementName, sonst elementBezeichnung + Position + "(ohne Name)", z. B. "Mitglied 3 (ohne Name)".
export function elementBezeichnung(listenFeld, element, index) {
  const nameFeld = listenFeld?.elementName;
  const name = nameFeld ? wertAmPfad(element, nameFeld) : undefined;
  if (typeof name === "string" && name.trim() !== "") return name.trim();
  const grund = listenFeld?.elementBezeichnung || "Eintrag";
  return nameFeld ? `${grund} ${index + 1} (ohne Name)` : `${grund} ${index + 1}`;
}

// Löst einen Regelpfad gegen einen Datensatz auf.
// Ohne "[]": { art: "einzeln", wert }.
// Mit "[]":  { art: "liste", zustand: "ok" | "fehlt" | "keineListe", elemente: [{ index, bezeichnung, wert }] }.
export function loesePfad(datensatz, pfad, felder = []) {
  const { listenPfad, unterPfad } = zerlegePfad(pfad);
  if (listenPfad === null) return { art: "einzeln", wert: wertAmPfad(datensatz, pfad) };

  const liste = wertAmPfad(datensatz, listenPfad);
  if (istLeer(liste)) return { art: "liste", zustand: "fehlt", elemente: [] };
  if (!Array.isArray(liste)) return { art: "liste", zustand: "keineListe", elemente: [] };

  const listenFeld = felder.find((f) => f.pfad === listenPfad);
  const elemente = liste.map((element, index) => ({
    index,
    bezeichnung: elementBezeichnung(listenFeld, element, index),
    wert: element !== null && typeof element === "object" ? wertAmPfad(element, unterPfad) : undefined,
  }));
  return { art: "liste", listenPfad, zustand: "ok", elemente };
}

// ---------- Formatierung für Begründungen und Anzeige ----------

const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATUM_ZEIT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

// Prüft, ob eine Zeichenkette ein echtes Kalenderdatum im Format JJJJ-MM-TT ist (kein 30.02.).
export function istIsoDatum(text) {
  const treffer = typeof text === "string" ? ISO_DATUM.exec(text) : null;
  if (!treffer) return false;
  const [jahr, monat, tag] = treffer.slice(1).map(Number);
  const datum = new Date(Date.UTC(jahr, monat - 1, tag));
  return datum.getUTCFullYear() === jahr && datum.getUTCMonth() === monat - 1 && datum.getUTCDate() === tag;
}

// Prüft Eingangswerte: JJJJ-MM-TT, optional mit Uhrzeit THH:MM (Konzept 2.1).
export function istIsoDatumZeit(text) {
  const treffer = typeof text === "string" ? ISO_DATUM_ZEIT.exec(text) : null;
  if (!treffer || !istIsoDatum(text.slice(0, 10))) return false;
  if (treffer[4] === undefined) return true;
  return Number(treffer[4]) <= 23 && Number(treffer[5]) <= 59;
}

// Tage zwischen zwei ISO-Daten (b − a), über UTC gerechnet, damit Zeitzonen keine Rolle spielen.
export function tageZwischen(isoA, isoB) {
  const zuUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((zuUtc(isoB) - zuUtc(isoA)) / 86_400_000);
}

// Addiert Tage zu einem ISO-Datum und liefert wieder JJJJ-MM-TT.
export function plusTage(iso, tage) {
  const datum = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + tage));
  return datum.toISOString().slice(0, 10);
}

// "2026-11-06" → "06.11.2026", "2026-11-06T08:15" → "06.11.2026, 08:15 Uhr".
export function datumAnzeigen(iso) {
  if (typeof iso !== "string" || !istIsoDatumZeit(iso)) return String(iso);
  const datum = `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  return iso.length > 10 ? `${datum}, ${iso.slice(11, 16)} Uhr` : datum;
}

// Zahl mit deutschem Dezimalkomma, ohne von der Laufzeitumgebung abhängige Locale.
export function zahlAnzeigen(zahl) {
  return String(zahl).replace(".", ",");
}

// Kurztext für einen beliebigen Wert in Begründungen.
export function wertAnzeigen(wert) {
  if (wert === undefined || wert === null) return "fehlt";
  if (typeof wert === "number") return zahlAnzeigen(wert);
  if (Array.isArray(wert)) return wert.length === 0 ? "leer" : wert.map(wertAnzeigen).join(", ");
  if (typeof wert === "string") return wert.trim() === "" ? "leer" : wert;
  if (typeof wert === "boolean") return wert ? "ja" : "nein";
  return "Angabe in unerwartetem Format";
}

// Zählwort mit Singular/Plural: anzahlText(1, "Verstoß", "Verstöße") → "1 Verstoß".
export function anzahlText(anzahl, einzahl, mehrzahl) {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`;
}
