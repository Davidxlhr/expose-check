// Spike: Prüft, ob das Laden der JSON-Dateien per fetch und die PDF-Vorschau
// per <object> funktionieren – lokal und auf StackBlitz. Noch keine Prüflogik.

const PFAD_REGELN = "data/regeln.json";
const PFAD_EXPOSES = "data/exposes.json";

const statusmeldung = document.querySelector("#statusmeldung");
const fehlerBereich = document.querySelector("#fehler");
const anzahlRegeln = document.querySelector("#anzahl-regeln");
const exposeListe = document.querySelector("#expose-liste");
const vorschau = document.querySelector("#vorschau");

// Liefert nur den Medientyp ohne Zusätze wie "; charset=utf-8".
function medientyp(antwort) {
  const typ = antwort.headers.get("Content-Type") ?? "";
  return typ.split(";")[0].trim().toLowerCase();
}

// Lädt eine JSON-Datei. Jeder Fehler wird zu einer verständlichen deutschen Meldung.
async function ladeJson(pfad) {
  let antwort;
  try {
    antwort = await fetch(pfad);
  } catch (fehler) {
    throw new Error(`${pfad} konnte nicht geladen werden (keine Verbindung zum Server).`, { cause: fehler });
  }
  if (!antwort.ok) {
    throw new Error(`${pfad} konnte nicht geladen werden (HTTP ${antwort.status}).`);
  }
  // Schutz gegen einen Server, der statt der Datei eine HTML-Seite mit Status 200 liefert.
  const typ = medientyp(antwort);
  if (typ !== "application/json") {
    throw new Error(`${pfad} wurde nicht als JSON geliefert, sondern als „${typ || "unbekannt"}“.`);
  }
  try {
    return await antwort.json();
  } catch (fehler) {
    throw new Error(
      `${pfad} ist keine gültige JSON-Datei. Häufige Ursachen: fehlendes Komma oder einfache statt doppelter Anführungszeichen.`,
      { cause: fehler }
    );
  }
}

// Minimale Strukturprüfung (die echte Schemaprüfung folgt später): Liste unter `schluessel` vorhanden?
function liste(daten, schluessel, pfad) {
  if (!Array.isArray(daten?.[schluessel])) {
    throw new Error(`${pfad} enthält keine Liste „${schluessel}“.`);
  }
  return daten[schluessel];
}

// Zeigt eine Fehlermeldung auf der Seite; Details nur in der Konsole.
function zeigeFehler(fehler) {
  console.error(fehler);
  const meldung = document.createElement("p");
  meldung.textContent = `Fehler: ${fehler.message} Bitte die Datei prüfen und die Seite neu laden.`;
  fehlerBereich.append(meldung);
}

// Holt das PDF per fetch und liefert eine Blob-URL.
// Warum nicht direkt <object data="pdf/…">? Auf StackBlitz liefert ein Service Worker die Dateien aus,
// und Anfragen von <object>/<embed> gehen laut Service-Worker-Standard („Handle Fetch“) an ihm vorbei.
// fetch läuft dagegen über den Service Worker; die Blob-URL braucht danach keine Netzanfrage mehr.
async function ladePdf(pfad) {
  let antwort;
  try {
    antwort = await fetch(pfad);
  } catch (fehler) {
    throw new Error("keine Verbindung zum Server", { cause: fehler });
  }
  if (!antwort.ok) {
    throw new Error(`HTTP ${antwort.status}`);
  }
  // Schutz gegen einen Server, der statt des PDFs eine HTML-Seite mit Status 200 liefert.
  const typ = medientyp(antwort);
  if (typ !== "application/pdf") {
    throw new Error(`geliefert als „${typ || "unbekannt"}“ statt PDF`);
  }
  return URL.createObjectURL(await antwort.blob());
}

// Blob-URL des gerade angezeigten PDFs; wird beim Wechsel freigegeben.
let aktuelleBlobUrl = null;
// Zählt die Klicks, damit eine langsame ältere Antwort keine neuere Vorschau überschreibt.
let letzteAnfrage = 0;

function blobUrlFreigeben() {
  if (aktuelleBlobUrl) {
    URL.revokeObjectURL(aktuelleBlobUrl);
    aktuelleBlobUrl = null;
  }
}

// Link zum Öffnen des PDFs in einem neuen Tab (Pflicht-Fallback).
function pdfLink(pfad) {
  const link = document.createElement("a");
  link.href = pfad;
  link.target = "_blank";
  link.textContent = "PDF öffnen";
  return link;
}

async function zeigeVorschau(expose) {
  const anfrage = ++letzteAnfrage;
  blobUrlFreigeben();
  const ueberschrift = document.createElement("h3");
  ueberschrift.textContent = `${expose.id}: ${expose.titel}`;
  vorschau.replaceChildren(ueberschrift);

  if (!expose.pdf) {
    const hinweis = document.createElement("p");
    hinweis.textContent = `Kein PDF hinterlegt – eingereicht als ${String(expose.dateiformat ?? "unbekannt").toUpperCase()}.`;
    vorschau.append(hinweis);
    statusmeldung.textContent = `${expose.id}: kein PDF hinterlegt.`;
    return;
  }

  let blobUrl;
  try {
    blobUrl = await ladePdf(expose.pdf);
  } catch (fehler) {
    if (anfrage !== letzteAnfrage) return; // inzwischen anderes Exposé gewählt
    console.error(fehler);
    const hinweis = document.createElement("p");
    hinweis.append(`Das PDF konnte nicht geladen werden (${fehler.message}). `, pdfLink(expose.pdf));
    vorschau.append(hinweis);
    statusmeldung.textContent = `${expose.id}: PDF nicht abrufbar.`;
    return;
  }
  if (anfrage !== letzteAnfrage) {
    URL.revokeObjectURL(blobUrl); // Antwort kam zu spät, wird nicht mehr gebraucht
    return;
  }
  aktuelleBlobUrl = blobUrl;

  const objekt = document.createElement("object");
  objekt.data = blobUrl;
  objekt.type = "application/pdf";
  objekt.width = "100%";
  objekt.height = "600";
  objekt.setAttribute("aria-label", `PDF-Vorschau: ${expose.titel}`);
  // Fallback-Inhalt: erscheint nur, wenn der Browser das PDF nicht einbetten kann.
  const fallback = document.createElement("p");
  fallback.append("Die PDF-Vorschau kann in diesem Browser nicht angezeigt werden. ", pdfLink(expose.pdf));
  objekt.append(fallback);
  vorschau.append(objekt);
  statusmeldung.textContent = `${expose.id}: PDF-Vorschau angezeigt.`;
}

function zeigeListe(exposes) {
  for (const expose of exposes) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = expose.titel;
    knopf.addEventListener("click", () => zeigeVorschau(expose));
    const eintrag = document.createElement("li");
    eintrag.append(knopf);
    exposeListe.append(eintrag);
  }
}

async function start() {
  // Das Skript läuft, also wurde die Seite über einen Webserver geöffnet.
  document.querySelector("#hinweis-webserver").hidden = true;

  // Beide Dateien parallel laden; ein Fehler in der einen verhindert die Anzeige der anderen nicht.
  const [regeln, exposes] = await Promise.allSettled([
    ladeJson(PFAD_REGELN).then((daten) => liste(daten, "regeln", PFAD_REGELN)),
    ladeJson(PFAD_EXPOSES).then((daten) => liste(daten, "exposes", PFAD_EXPOSES)),
  ]);

  if (regeln.status === "fulfilled") {
    anzahlRegeln.textContent = `Regelsatz geladen: ${regeln.value.length} Regeln.`;
  } else {
    zeigeFehler(regeln.reason);
  }

  if (exposes.status === "fulfilled") {
    zeigeListe(exposes.value);
  } else {
    zeigeFehler(exposes.reason);
  }

  const fehlerzahl = [regeln, exposes].filter((e) => e.status === "rejected").length;
  statusmeldung.textContent = fehlerzahl === 0 ? "Daten geladen." : "Laden mit Fehlern beendet.";
}

start();
