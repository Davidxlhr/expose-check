// Prüf-Engine: wendet einen gültigen Regelsatz auf Exposé-Datensätze an (Konzept 3.1, A-06 bis A-08).
// Bedingung "wenn", Gesamtstatus (Ampel), Begründungstexte. Reines Modul ohne DOM-Zugriff.

import { REGELTYPEN, inaktiv } from "./regeltypen.js";
import { wertAmPfad, wertAnzeigen } from "./werte.js";

// Gesamtstatus eines Exposés; Reihenfolge = Sortierung „schlechtestes zuerst“.
export const GESAMTSTATUS = ["verletzt", "hinweis", "ok"];

// Anzeige-Texte (Konzept 3.1, 6.1): neutral, nicht wertend (A-41).
export const AMPEL_TEXT = Object.freeze({
  verletzt: "Verstöße",
  hinweis: "Hinweise",
  ok: "Keine Auffälligkeiten",
});

const ERGEBNIS_TEXT = Object.freeze({ ok: "Erfüllt", hinweis: "Hinweis", verletzt: "Verstoß" });

// Reihenfolge der Einzelergebnisse in der Detailansicht: Verstoß → Hinweis → Erfüllt → Entfällt/Nicht prüfbar.
const ERGEBNIS_REIHENFOLGE = { verletzt: 0, hinweis: 1, ok: 2, inaktiv: 3 };

// „Entfällt“ (Bedingung nicht erfüllt) und „Nicht prüfbar“ (Angabe fehlt) sind beide inaktiv.
export function ergebnisText(ergebnis) {
  if (ergebnis.ergebnis === "inaktiv") return ergebnis.anlass === "wenn" ? "Entfällt" : "Nicht prüfbar";
  return ERGEBNIS_TEXT[ergebnis.ergebnis];
}

// Begründung im festen Format „Soll: … · Ist: …“ mit optionalem Zusatz (A-08).
// inaktiv nennt stattdessen den Anlass.
export function begruendung(ergebnis) {
  if (ergebnis.ergebnis === "inaktiv") return ergebnis.grund;
  const zusatz = ergebnis.grund ? ` – ${ergebnis.grund}` : "";
  return `Soll: ${ergebnis.soll} · Ist: ${ergebnis.ist}${zusatz}`;
}

// Sucht den Katalog, gegen den eine Katalog-Regel ein Feld prüft (für Anzeigetexte wie „Gruppenarbeit“).
export function katalogFuerFeld(regelsatz, feldPfad) {
  const regel = regelsatz.regeln.find((r) => r.typ === "katalog" && r.parameter.feld === feldPfad);
  return regel ? regelsatz.kataloge[regel.parameter.katalog] : null;
}

// Anzeigetext eines Werts mit Katalogtext, sofern ein Katalog zum Feld gehört.
export function anzeigeMitKatalog(regelsatz, feldPfad, wert) {
  const katalog = katalogFuerFeld(regelsatz, feldPfad);
  const eintrag = katalog?.werte.find((w) => w.wert === wert);
  return eintrag ? eintrag.text : wertAnzeigen(wert);
}

// Bedingung "wenn": nur Gleichheit (Konzept 2.5). Liefert null, wenn die Regel gilt, sonst ein inaktiv-Ergebnis.
function pruefeBedingung(datensatz, regel, regelsatz) {
  if (!regel.wenn) return null;
  const { feld, gleich } = regel.wenn;
  const wert = wertAmPfad(datensatz, feld);
  if (wert === gleich) return null;

  // Klartext für den Bedingungswert aus einem passenden Katalog, z. B. "gruppenarbeit" → "Gruppenarbeit".
  const katalogText = anzeigeMitKatalog(regelsatz, feld, gleich);
  const feldBezeichnung = regelsatz.felder.find((f) => f.pfad === feld)?.bezeichnung ?? feld;
  const angegeben = wert === undefined || wert === null || wert === ""
    ? `${feldBezeichnung} nicht angegeben`
    : `angegeben: ${anzeigeMitKatalog(regelsatz, feld, wert)}`;
  return inaktiv(regel, "wenn", `Entfällt – gilt nur bei ${katalogText} (${angegeben})`);
}

// Gesamtstatus aus dem schlechtesten Einzelergebnis; inaktiv zählt nicht (A-07).
export function gesamtstatus(ergebnisse) {
  if (ergebnisse.some((e) => e.ergebnis === "verletzt")) return "verletzt";
  if (ergebnisse.some((e) => e.ergebnis === "hinweis")) return "hinweis";
  return "ok";
}

// Prüft ein Exposé gegen alle aktiven Regeln. Deaktivierte Regeln liefern kein Ergebnis (A-06).
export function pruefeExpose(expose, regelsatz) {
  const kontext = { regelsatz };
  const ergebnisse = regelsatz.regeln
    .filter((regel) => regel.aktiv)
    .map((regel) => {
      const entfaellt = pruefeBedingung(expose, regel, regelsatz);
      if (entfaellt) return entfaellt;
      try {
        return REGELTYPEN[regel.typ].auswerten(expose, regel, kontext);
      } catch {
        // Sicherheitsnetz für unerwartete Datenformen in einem einzelnen Datensatz (F-4):
        // Die Regel gilt als nicht prüfbar, die übrigen Regeln laufen weiter.
        return inaktiv(regel, "fehlt", "Nicht prüfbar – Angabe hat ein unerwartetes Format");
      }
    });

  const zaehler = { verletzt: 0, hinweis: 0, ok: 0, inaktiv: 0 };
  for (const e of ergebnisse) zaehler[e.ergebnis] += 1;
  return { exposeId: expose.id, ergebnisse, gesamt: gesamtstatus(ergebnisse), zaehler };
}

// Prüft alle Exposés; Ergebnis als Map exposeId → Prüfung.
export function pruefeAlle(exposes, regelsatz) {
  return new Map(exposes.map((expose) => [expose.id, pruefeExpose(expose, regelsatz)]));
}

// Anzahl Exposés je Gesamtstatus (für SVG-Grafik, Filter und Editor-Vorschau).
export function verteilung(pruefungen) {
  const anzahl = { verletzt: 0, hinweis: 0, ok: 0 };
  for (const pruefung of pruefungen.values()) anzahl[pruefung.gesamt] += 1;
  return anzahl;
}

// Sortiert Einzelergebnisse für die Anzeige, bei Gleichstand nach Regelreihenfolge.
export function sortiereErgebnisse(ergebnisse) {
  return ergebnisse
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ERGEBNIS_REIHENFOLGE[a.e.ergebnis] - ERGEBNIS_REIHENFOLGE[b.e.ergebnis] || a.i - b.i)
    .map(({ e }) => e);
}
