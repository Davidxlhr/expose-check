// Export und Import des Regelsatzes (Konzept 7.6, A-19, A-20, F-5).
// Die Prüfung einer Importdatei (pruefeImport) und der Exporttext sind ohne DOM testbar;
// Herunterladen und Dateiauswahl brauchen den Browser. Auf Modulebene wird kein DOM angefasst.

import { REGELTYPEN } from "./regeltypen.js";
import { pruefeRegelsatz } from "./schema.js";

export const MAX_IMPORT_BYTES = 200 * 1024; // Konzept 6.6, F-5: Datei > 200 KB wird abgelehnt
const MAX_GEZEIGTE_FEHLER = 10;

// ---------- ohne DOM ----------

// Exporttext: eingerückt, damit die Datei lesbar und in Git vergleichbar bleibt. Er wird beim Import
// wieder zu genau demselben Regelsatz (Rundreise, A-19).
export function exportText(regelsatz) {
  return `${JSON.stringify(regelsatz, null, 2)}\n`;
}

// Dateiname mit lokalem Datum, z. B. „regeln-2026-11-05.json“ (Konzept 7.6).
export function exportDateiname(datum = new Date()) {
  const zwei = (n) => String(n).padStart(2, "0");
  return `regeln-${datum.getFullYear()}-${zwei(datum.getMonth() + 1)}-${zwei(datum.getDate())}.json`;
}

// Fehlerstelle aus der Meldung von JSON.parse. Die Meldungen sind nicht standardisiert:
// Chrome nennt meist „(line 5 column 3)“ bzw. „position 87“, Firefox „at line 5 column 3“, Safari oft nichts.
// Bei „Unexpected token“ nennt Chrome (V8) keine Position, sondern nur einen Ausschnitt um die Stelle:
//   Unexpected token ''', ..."  "name": 'Test'↵}" is not valid JSON
// Dann wird der Ausschnitt im Text gesucht; ist er nicht eindeutig, bleibt die Stelle unbekannt.
export function jsonFehlerstelle(meldung, text) {
  const zeileSpalte = /line (\d+) column (\d+)/.exec(meldung);
  if (zeileSpalte) return { zeile: Number(zeileSpalte[1]), spalte: Number(zeileSpalte[2]) };
  const position = /position (\d+)/.exec(meldung);
  if (position) return zeileUndSpalte(text, Number(position[1]));
  // Auslassungspunkte stehen bei V8 außerhalb der Anführungszeichen: ..."ausschnitt"...
  const kontext = /^Unexpected token '(.+?)', (?:\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/.exec(meldung);
  if (kontext) {
    const [, zeichen, ausschnitt] = kontext;
    const beginn = text.indexOf(ausschnitt);
    const imAusschnitt = ausschnitt.indexOf(zeichen);
    if (ausschnitt && beginn >= 0 && text.indexOf(ausschnitt, beginn + 1) === -1 && imAusschnitt >= 0) {
      return zeileUndSpalte(text, beginn + imAusschnitt);
    }
  }
  return null;
}

function zeileUndSpalte(text, position) {
  const vorher = text.slice(0, position).split("\n");
  return { zeile: vorher.length, spalte: vorher.at(-1).length + 1 };
}

// Prüft eine Importdatei vollständig, bevor irgendetwas übernommen wird.
// Ergebnis: { ok: true, regelsatz } oder { ok: false, titel, fehlerliste, weitere }.
export function pruefeImport({ name, groesse, text }) {
  const abgelehnt = (titel, fehlerliste = []) => ({
    ok: false,
    titel,
    fehlerliste: fehlerliste.slice(0, MAX_GEZEIGTE_FEHLER),
    weitere: Math.max(0, fehlerliste.length - MAX_GEZEIGTE_FEHLER),
  });

  if (groesse > MAX_IMPORT_BYTES) {
    return abgelehnt(`„${name}“ ist zu groß (${Math.ceil(groesse / 1024)} KB, erlaubt sind höchstens 200 KB).`);
  }
  if (text.trim() === "") return abgelehnt(`„${name}“ ist leer.`);

  let daten;
  try {
    daten = JSON.parse(text);
  } catch (fehler) {
    const stelle = jsonFehlerstelle(String(fehler.message), text);
    return abgelehnt(`„${name}“ ist keine gültige JSON-Datei.`, [
      stelle ? `Fehler in Zeile ${stelle.zeile}, Spalte ${stelle.spalte}.` : "Die Datei lässt sich nicht als JSON lesen.",
      "Häufige Ursachen: fehlendes oder überzähliges Komma, einfache statt doppelter Anführungszeichen, Kommentare.",
    ]);
  }

  // Dieselbe strenge Prüfung wie beim Laden von regeln.json (Konzept 2.5).
  const fehlerliste = pruefeRegelsatz(daten, REGELTYPEN);
  if (fehlerliste.length > 0) {
    const anzahl = fehlerliste.length === 1 ? "1 Fehler" : `${fehlerliste.length} Fehler`;
    return abgelehnt(`„${name}“ enthält ${anzahl} – der Regelsatz wurde nicht übernommen.`, fehlerliste);
  }
  return { ok: true, regelsatz: daten };
}

export function importMeldung(regelsatz, name) {
  const n = regelsatz.regeln.length;
  return `Regelsatz „${regelsatz.name}“ mit ${n === 1 ? "1 Regel" : `${n} Regeln`} aus „${name}“ importiert.`;
}

// ---------- im Browser ----------

// Export: JSON → Blob → Objekt-URL → temporärer Link mit download-Attribut (Konzept 7.6).
// Die URL wird erst nach dem Klick freigegeben, damit der Download sicher begonnen hat.
export function exportiere(regelsatz) {
  const dateiname = exportDateiname();
  const url = URL.createObjectURL(new Blob([exportText(regelsatz)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return dateiname;
}

// Baut den Import-Baustein aus <template id="vorlage-import"> in `platz` ein.
// beiErfolg(regelsatz, dateiname) übernimmt; melde(text) schreibt in den Statusbereich.
export function bindeImport(platz, praefix, { beiErfolg, melde }) {
  const baustein = document.getElementById("vorlage-import").content.cloneNode(true).firstElementChild;
  const feld = baustein.querySelector('[data-feld="datei"]');
  const hilfe = baustein.querySelector('[data-hilfe="datei"]');
  const fehlerbereich = baustein.querySelector('[data-fehler="datei"]');
  feld.id = `${praefix}-datei`;
  feld.name = "datei";
  hilfe.id = `${feld.id}-hilfe`;
  fehlerbereich.id = `${feld.id}-fehler`;
  baustein.querySelector("label").htmlFor = feld.id;
  feld.setAttribute("aria-describedby", `${hilfe.id} ${fehlerbereich.id}`);

  feld.addEventListener("change", async () => {
    const datei = feld.files?.[0];
    if (!datei) return;
    // Erst die Größe prüfen, dann lesen: eine zu große Datei wird gar nicht eingelesen.
    const text = datei.size > MAX_IMPORT_BYTES ? "" : await datei.text();
    const ergebnis = pruefeImport({ name: datei.name, groesse: datei.size, text });
    // Auswahl zurücksetzen, sonst löst dieselbe Datei nach einer Korrektur kein change mehr aus.
    feld.value = "";
    if (ergebnis.ok) {
      versteckeImportFehler(feld, fehlerbereich);
      beiErfolg(ergebnis.regelsatz, datei.name);
    } else {
      zeigeImportFehler(feld, fehlerbereich, ergebnis);
      melde(`Import fehlgeschlagen: ${ergebnis.titel} Der bisherige Regelsatz bleibt unverändert.`);
    }
  });
  platz.append(baustein);
  return feld;
}

function zeigeImportFehler(feld, bereich, { titel, fehlerliste, weitere }) {
  const ueberschrift = document.createElement("p");
  ueberschrift.className = "import-fehler-titel";
  ueberschrift.textContent = titel;
  const liste = document.createElement("ul");
  liste.className = "fehlerliste";
  for (const text of fehlerliste) {
    const eintrag = document.createElement("li");
    eintrag.textContent = text;
    liste.append(eintrag);
  }
  if (weitere > 0) {
    const eintrag = document.createElement("li");
    eintrag.textContent = `… und ${weitere} weitere`;
    liste.append(eintrag);
  }
  const hinweis = document.createElement("p");
  hinweis.textContent = "Der bisherige Regelsatz bleibt unverändert.";
  bereich.replaceChildren(ueberschrift, ...(fehlerliste.length > 0 ? [liste] : []), hinweis);
  bereich.hidden = false;
  feld.setAttribute("aria-invalid", "true");
}

// Wie bei den Feldmeldungen: erst leeren, dann verstecken (Inhalt hinter aria-describedby).
function versteckeImportFehler(feld, bereich) {
  bereich.textContent = "";
  bereich.hidden = true;
  feld.removeAttribute("aria-invalid");
}
