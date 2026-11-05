// Laden der JSON-Dateien und der PDF-Vorschau per fetch, mit verständlichen Fehlermeldungen
// (Konzept 6.6: F-1 bis F-4, F-6). Kein DOM-Zugriff; die Darstellung übernimmt ansichten.js.

import { pruefeExposeDatei, pruefeRegelsatz } from "./schema.js";
import { REGELTYPEN } from "./regeltypen.js";

export const PFAD_REGELN = "data/regeln.json";
export const PFAD_EXPOSES = "data/exposes.json";

// Ladefehler mit Angaben für die Meldungsbox: was (titel), wo (datei), was tun (hilfe), Fehlerliste.
export class Ladefehler extends Error {
  constructor({ datei, titel, text, hilfe, fehlerliste = [] }, optionen) {
    super(`${titel} ${text}`, optionen);
    this.name = "Ladefehler";
    this.datei = datei;
    this.titel = titel;
    this.text = text;
    this.hilfe = hilfe;
    this.fehlerliste = fehlerliste;
  }
}

// Liefert nur den Medientyp ohne Zusätze wie "; charset=utf-8".
function medientyp(antwort) {
  const typ = antwort.headers.get("Content-Type") ?? "";
  return typ.split(";")[0].trim().toLowerCase();
}

function dateiname(pfad) {
  return pfad.split("/").at(-1);
}

// Lädt eine JSON-Datei; jeder Fehler wird zu einem Ladefehler mit deutscher Meldung.
async function ladeJson(pfad) {
  const datei = dateiname(pfad);
  const titel = `${datei} konnte nicht geladen werden.`;
  let antwort;
  try {
    antwort = await fetch(pfad, { cache: "no-cache" });
  } catch (fehler) {
    throw new Ladefehler({
      datei, titel, text: "Der Server ist nicht erreichbar.",
      hilfe: "Bitte die Verbindung prüfen und erneut laden.",
    }, { cause: fehler });
  }
  if (!antwort.ok) {
    throw new Ladefehler({
      datei, titel, text: `Der Server antwortet mit HTTP ${antwort.status}.`,
      hilfe: `Bitte prüfen, ob die Datei unter „${pfad}“ vorhanden ist, und erneut laden.`,
    });
  }
  // Schutz gegen einen Server, der statt der Datei eine HTML-Seite mit Status 200 liefert (SPA-Fallback, RI-02).
  const typ = medientyp(antwort);
  if (typ !== "application/json") {
    throw new Ladefehler({
      datei, titel, text: `Der Server liefert sie als „${typ || "unbekannt"}“ statt als JSON.`,
      hilfe: `Bitte prüfen, ob die Datei unter „${pfad}“ vorhanden ist.`,
    });
  }
  try {
    return await antwort.json();
  } catch (fehler) {
    throw new Ladefehler({
      datei, titel: `${datei} ist keine gültige JSON-Datei.`,
      text: "Die Datei lässt sich nicht als JSON lesen.",
      hilfe: "Häufige Ursachen: ein fehlendes oder überzähliges Komma, einfache statt doppelter Anführungszeichen, Kommentare in der Datei.",
    }, { cause: fehler });
  }
}

// Lädt und prüft den Regelsatz. Ein fehlerhafter Regelsatz wird vollständig abgelehnt (A-21, F-4).
export async function ladeRegelsatz(pfad = PFAD_REGELN) {
  const daten = await ladeJson(pfad);
  const fehlerliste = pruefeRegelsatz(daten, REGELTYPEN);
  if (fehlerliste.length > 0) {
    throw new Ladefehler({
      datei: dateiname(pfad),
      titel: `${dateiname(pfad)} enthält Fehler – der Regelsatz wurde nicht übernommen.`,
      text: `${fehlerliste.length === 1 ? "1 Fehler" : `${fehlerliste.length} Fehler`} gefunden. Damit keine unvollständige Prüfung entsteht, wird keine Regel angewendet.`,
      hilfe: "Bitte die genannten Stellen in der Datei korrigieren und erneut laden.",
      fehlerliste,
    });
  }
  return daten;
}

// Lädt die Exposé-Angaben. Einzelne fehlerhafte Angaben ergeben später „Nicht prüfbar“ (F-4).
export async function ladeExposes(pfad = PFAD_EXPOSES) {
  const daten = await ladeJson(pfad);
  const fehlerliste = pruefeExposeDatei(daten);
  if (fehlerliste.length > 0) {
    throw new Ladefehler({
      datei: dateiname(pfad),
      titel: `${dateiname(pfad)} hat nicht den erwarteten Aufbau.`,
      text: `${fehlerliste.length === 1 ? "1 Fehler" : `${fehlerliste.length} Fehler`} gefunden.`,
      hilfe: "Bitte die genannten Stellen in der Datei korrigieren und erneut laden.",
      fehlerliste,
    });
  }
  return daten;
}

// Nur relative Pfade zu PDF-Dateien im Projekt, keine fremden Adressen.
const PDF_PFAD = /^(?!.*\.\.)[\w\-./]+\.pdf$/i;

// Holt das PDF per fetch und liefert eine Blob-URL (Muster aus dem Spike, siehe README/Konzept RI-02):
// Auf StackBlitz liefert ein Service Worker die Dateien aus. Anfragen von <object> gehen laut
// Service-Worker-Standard („Handle Fetch“) an ihm vorbei, fetch dagegen nicht. Die Blob-URL braucht
// danach keine Netzanfrage mehr. Fehler werden als kurzer Text geworfen.
export async function ladePdf(pfad) {
  if (!PDF_PFAD.test(pfad)) throw new Error("ungültiger Pfad");
  let antwort;
  try {
    antwort = await fetch(pfad);
  } catch (fehler) {
    throw new Error("keine Verbindung zum Server", { cause: fehler });
  }
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  // Schutz gegen einen Server, der statt des PDFs eine HTML-Seite mit Status 200 liefert.
  const typ = medientyp(antwort);
  if (typ !== "application/pdf") throw new Error(`geliefert als „${typ || "unbekannt"}“ statt PDF`);
  return URL.createObjectURL(await antwort.blob());
}
