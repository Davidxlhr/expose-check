// Regeltyp-Registry (Konzept 3.1/3.2): Jeder Typ besteht aus
//   auswerten(datensatz, regel, kontext) → Ergebnis
//   parameterTesten(parameter, regelsatz) → Liste von Schemafehlern (relativ zu "parameter")
//   formular → ID des <template> im HTML (Formularbaustein im Regel-Editor)
// Ein neuer Typ heißt: einen Eintrag ergänzen. Reines Modul ohne DOM-Zugriff.
//
// Ergebnisobjekt: { regelId, ergebnis, soll, ist, grund, betroffene, anlass }
//   ergebnis:   "ok" | "hinweis" | "verletzt" | "inaktiv" (genau diese vier, O-13)
//   anlass:     nur bei "inaktiv": "wenn" (Bedingung nicht erfüllt → „Entfällt“)
//               oder "fehlt" (Angabe fehlt bzw. nicht auswertbar → „Nicht prüfbar“)
//   betroffene: Bezeichnungen der Listenelemente, die die Regel nicht erfüllen

import { SCHRANKEN, pruefeFeldverweis, pruefeSchluessel, pruefeText, pruefeZahl } from "./schema.js";
import {
  anzahlText, datumAnzeigen, istIsoDatum, istIsoDatumZeit, istLeer, loesePfad, plusTage,
  tageZwischen, wertAnzeigen, zahlAnzeigen,
} from "./werte.js";

export const GRUND_NICHT_PRUEFBAR = "Nicht prüfbar – Angabe fehlt";
export const GRUND_FORMAT = "Nicht prüfbar – Angabe hat ein unerwartetes Format";

// Rangfolge für „das schlechteste Ergebnis zählt“ (Konzept 2.5, Pfadsyntax; A-07).
const RANG = { inaktiv: 0, ok: 1, hinweis: 2, verletzt: 3 };

// ---------- gemeinsame Auswertung ----------

// Ein Teilergebnis für einen einzelnen Wert. stand:
//   "ok" · "abweichung" (→ stufe der Regel) · "kulanz" (→ hinweis) · "fehlt" (→ inaktiv)
function teil(stand, ist, grund = null) {
  return { stand, ist, grund };
}

function standZuErgebnis(stand, regel) {
  if (stand === "ok") return "ok";
  if (stand === "kulanz") return "hinweis";
  if (stand === "abweichung") return regel.stufe;
  return "inaktiv";
}

export function inaktiv(regel, anlass, grund) {
  return { regelId: regel.id, ergebnis: "inaktiv", soll: null, ist: null, grund, betroffene: [], anlass };
}

// Wendet eine Prüffunktion je Wert an. Bei "[]"-Pfaden je Listenelement; es zählt das schlechteste
// Ergebnis unter ok/hinweis/verletzt, nur wenn alle Elemente inaktiv sind, ist das Ganze inaktiv.
function jeWert(datensatz, regel, kontext, soll, pruefeWert) {
  const aufgeloest = loesePfad(datensatz, regel.parameter.feld, kontext.regelsatz.felder);

  if (aufgeloest.art === "einzeln") {
    const t = pruefeWert(aufgeloest.wert);
    const ergebnis = standZuErgebnis(t.stand, regel);
    if (ergebnis === "inaktiv") return inaktiv(regel, "fehlt", t.grund ?? GRUND_NICHT_PRUEFBAR);
    return { regelId: regel.id, ergebnis, soll, ist: t.ist, grund: t.grund, betroffene: [], anlass: null };
  }

  if (aufgeloest.zustand === "keineListe") return inaktiv(regel, "fehlt", GRUND_FORMAT);
  if (aufgeloest.elemente.length === 0) return inaktiv(regel, "fehlt", GRUND_NICHT_PRUEFBAR);

  const teile = aufgeloest.elemente.map((element) => {
    const t = pruefeWert(element.wert);
    return { ...t, ergebnis: standZuErgebnis(t.stand, regel), bezeichnung: element.bezeichnung };
  });
  const schlechtestes = teile.reduce((a, b) => (RANG[b.ergebnis] > RANG[a.ergebnis] ? b : a)).ergebnis;
  if (schlechtestes === "inaktiv") {
    const formatfehler = teile.some((t) => t.grund === GRUND_FORMAT);
    return inaktiv(regel, "fehlt", formatfehler ? GRUND_FORMAT : GRUND_NICHT_PRUEFBAR);
  }

  // Ist-Text: bei Abweichungen nur die betroffenen Elemente, sonst alle (inkl. nicht prüfbarer).
  // Sind alle erfüllt und gleich, wird zusammengefasst: „angegeben (alle 3 Mitglieder)“.
  const abweichend = teile.filter((t) => t.ergebnis === "verletzt" || t.ergebnis === "hinweis");
  const gezeigt = abweichend.length > 0 ? abweichend : teile;
  const alleGleich = teile.length > 1 && teile.every((t) => t.ergebnis === "ok" && t.ist === teile[0].ist);
  const listenBezeichnung = kontext.regelsatz.felder.find((f) => f.pfad === aufgeloest.listenPfad)?.bezeichnung;
  const ist = alleGleich && listenBezeichnung
    ? `${teile[0].ist} (alle ${teile.length} ${listenBezeichnung})`
    : gezeigt
      .map((t) => `${t.bezeichnung}: ${t.ergebnis === "inaktiv" ? `${t.ist} (nicht prüfbar)` : t.ist}`)
      .join("; ");
  const gruende = [...new Set(abweichend.map((t) => t.grund).filter(Boolean))];
  return {
    regelId: regel.id,
    ergebnis: schlechtestes,
    soll,
    ist,
    grund: gruende.length > 0 ? gruende.join("; ") : null,
    betroffene: abweichend.map((t) => t.bezeichnung),
    anlass: null,
  };
}

// Soll-Text eines Katalogs: Zahlenreihe als Bereich, kurze Textkataloge als Aufzählung.
function katalogSoll(katalog) {
  const werte = katalog.werte.map((w) => w.wert);
  const zahlen = werte.every((w) => typeof w === "number");
  if (zahlen) {
    const sortiert = [...werte].sort((a, b) => a - b);
    const lueckenlos = sortiert.every((w, i) => i === 0 || w === sortiert[i - 1] + 1);
    if (lueckenlos && sortiert.length > 2) return `${katalog.bezeichnung} ${sortiert[0]}–${sortiert.at(-1)}`;
    return `${katalog.bezeichnung}: ${sortiert.join(", ")}`;
  }
  if (katalog.werte.length <= 4) {
    const texte = katalog.werte.map((w) => w.text);
    return texte.length === 1 ? texte[0] : `${texte.slice(0, -1).join(", ")} oder ${texte.at(-1)}`;
  }
  return `ein Wert aus „${katalog.bezeichnung}“`;
}

// Anzeige eines einzelnen Werts mit Katalogtext, falls vorhanden ("gruppenarbeit" → "Gruppenarbeit").
function katalogWertAnzeigen(katalog, wert) {
  const eintrag = katalog.werte.find((w) => w.wert === wert);
  if (!eintrag) return wertAnzeigen(wert);
  return typeof wert === "number" ? zahlAnzeigen(wert) : eintrag.text;
}

function bereichText(min, max) {
  return min === max ? `genau ${min}` : `${min} bis ${max}`;
}

// Kompilierte Muster je Ausdruck, wie beim HTML-Attribut pattern (WHATWG HTML, „compiled pattern regular
// expression“): erst das Muster allein mit Flag "v" kompilieren – nur wenn das gelingt, verankert
// "^(?:" + muster + ")$". Sonst würde z. B. „[0-9]{6})|(.*“ erst durch die Verankerung gültig (S-2).
const musterCache = new Map();
export function kompiliereMuster(muster) {
  if (!musterCache.has(muster)) {
    new RegExp(muster, "v"); // wirft SyntaxError, wenn das Muster für sich ungültig ist
    musterCache.set(muster, new RegExp(`^(?:${muster})$`, "v"));
  }
  return musterCache.get(muster);
}

// Ausbau-Parameter lehnt die Kern-Prüfung verständlich ab (Konzept 2.5).
function ausbau(text) {
  return `${text} wird von dieser Version noch nicht ausgewertet und ist deshalb nicht zulässig`;
}

// Prüft Parameter gegen erlaubte Schlüssel und liefert Fehler ohne "parameter."-Präfix.
function parameterFehler(parameter, erlaubt, pruefungen) {
  const fehler = [];
  pruefeSchluessel(parameter, erlaubt, "", fehler);
  pruefungen(fehler);
  return fehler.map((f) => f.replace(/^\./, ""));
}

// Erlaubte Datentypen des geprüften Felds je Typ. Einzige Quelle für Schemaprüfung und Feld-Auswahl
// im Regel-Editor (null = alle Felder). Konzept 7.5: „frist → nur datum“.
const DATENTYPEN_ANZAHL = ["liste"];
const DATENTYPEN_FRIST = ["datum"];
const DATENTYPEN_UMFANG = ["zahl"];

// ---------- die sieben Typen ----------

export const REGELTYPEN = Object.freeze({
  pflichtfeld: {
    bezeichnung: "Pflichtfeld",
    beschreibung: "Eine Angabe muss vorhanden sein.",
    formular: "vorlage-pflichtfeld",
    hinzufuegbar: true, // Kern (A-14)
    feldDatentypen: null,
    // Standard für neue Regeln: das erste Feld ohne eigene Pflichtfeld-Regel.
    standardParameter(regelsatz) {
      const belegt = new Set(regelsatz.regeln.filter((r) => r.typ === "pflichtfeld").map((r) => r.parameter.feld));
      const feld = regelsatz.felder.find((f) => !belegt.has(f.pfad)) ?? regelsatz.felder[0];
      return { feld: feld.pfad };
    },
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler);
      });
    },
    auswerten(datensatz, regel, kontext) {
      // Ausnahme zu „Nicht prüfbar“: Das Fehlen selbst ist hier das Prüfziel (Konzept 3.1).
      return jeWert(datensatz, regel, kontext, "angegeben", (wert) => {
        if (!istLeer(wert)) return teil("ok", "angegeben");
        return teil("abweichung", wert === undefined || wert === null ? "fehlt" : "leer");
      });
    },
  },

  anzahl: {
    bezeichnung: "Anzahl",
    beschreibung: "Eine Liste muss zwischen Mindest- und Höchstzahl Einträge haben.",
    formular: "vorlage-anzahl",
    hinzufuegbar: true, // Kern (A-14)
    feldDatentypen: DATENTYPEN_ANZAHL,
    // Standard für neue Regeln: erste Liste, genau ein Eintrag.
    standardParameter(regelsatz) {
      const liste = regelsatz.felder.find((f) => f.datentyp === "liste");
      return { feld: liste.pfad, min: 1, max: 1 };
    },
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld", "min", "max"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler, { datentypen: DATENTYPEN_ANZAHL });
        pruefeZahl(parameter.min, "min", SCHRANKEN.anzahl, fehler);
        pruefeZahl(parameter.max, "max", SCHRANKEN.anzahl, fehler);
        if (Number.isInteger(parameter.min) && Number.isInteger(parameter.max) && parameter.min > parameter.max) {
          fehler.push("max: Der Höchstwert muss mindestens so groß sein wie der Mindestwert");
        }
      });
    },
    auswerten(datensatz, regel, kontext) {
      const { min, max } = regel.parameter;
      // Eine fehlende Liste zählt als 0 Einträge (Konzept 3.1).
      return jeWert(datensatz, regel, kontext, bereichText(min, max), (wert) => {
        if (wert !== undefined && wert !== null && !Array.isArray(wert)) return teil("fehlt", wertAnzeigen(wert), GRUND_FORMAT);
        const n = Array.isArray(wert) ? wert.length : 0;
        return teil(n >= min && n <= max ? "ok" : "abweichung", String(n));
      });
    },
  },

  katalog: {
    bezeichnung: "Katalog",
    beschreibung: "Jeder Wert muss in einem Katalog stehen.",
    formular: "vorlage-katalog",
    hinzufuegbar: false, // Ausbau (A-34)
    feldDatentypen: null,
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld", "katalog"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler);
        if (typeof parameter.katalog !== "string" || !Object.hasOwn(regelsatz.kataloge ?? {}, parameter.katalog)) {
          fehler.push(`katalog: Katalog „${parameter.katalog}“ existiert nicht`);
        }
      });
    },
    auswerten(datensatz, regel, kontext) {
      const katalog = kontext.regelsatz.kataloge[regel.parameter.katalog];
      const erlaubt = (w) => katalog.werte.some((e) => e.wert === w);
      // Fehlender Wert oder leere Liste → nicht prüfbar; das Fehlen meldet pflichtfeld bzw. anzahl.
      return jeWert(datensatz, regel, kontext, katalogSoll(katalog), (wert) => {
        if (istLeer(wert)) return teil("fehlt", wertAnzeigen(wert));
        const werte = Array.isArray(wert) ? wert : [wert];
        if (werte.some((w) => w !== null && typeof w === "object")) return teil("fehlt", "", GRUND_FORMAT);
        const fremd = werte.filter((w) => !erlaubt(w));
        if (fremd.length === 0) return teil("ok", werte.map((w) => katalogWertAnzeigen(katalog, w)).join(", "));
        // Zusatz nur bei mehreren Werten, damit klar ist, welcher Wert nicht passt.
        const zusatz = werte.length === 1 ? null
          : `${fremd.map(wertAnzeigen).join(", ")} ${fremd.length === 1 ? "steht" : "stehen"} nicht im Katalog`;
        return teil("abweichung", werte.map((w) => katalogWertAnzeigen(katalog, w)).join(", "), zusatz);
      });
    },
  },

  eindeutig: {
    bezeichnung: "Eindeutig",
    beschreibung: "Ein Merkmal darf innerhalb einer Liste nicht doppelt vorkommen.",
    formular: "vorlage-eindeutig",
    hinzufuegbar: false, // Ausbau (A-34)
    feldDatentypen: DATENTYPEN_ANZAHL, // gilt für die Liste; das Merkmal ist ein Unterfeld der Liste
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["liste", "merkmal"], (fehler) => {
        const liste = pruefeFeldverweis(parameter.liste, "liste", regelsatz, fehler, { datentypen: DATENTYPEN_ANZAHL, ohneListe: true });
        if (liste && typeof parameter.merkmal === "string") {
          pruefeFeldverweis(`${parameter.liste}[].${parameter.merkmal}`, "merkmal", regelsatz, fehler);
        } else if (typeof parameter.merkmal !== "string") {
          fehler.push("merkmal: Unterfeld der Liste erwartet");
        }
      });
    },
    auswerten(datensatz, regel, kontext) {
      const { liste, merkmal } = regel.parameter;
      const felder = kontext.regelsatz.felder;
      const merkmalBezeichnung = felder.find((f) => f.pfad === `${liste}[].${merkmal}`)?.bezeichnung ?? merkmal;
      const elementWort = felder.find((f) => f.pfad === liste)?.elementBezeichnung ?? "Eintrag";
      const soll = `${merkmalBezeichnung} je ${elementWort} verschieden`;

      const aufgeloest = loesePfad(datensatz, `${liste}[].${merkmal}`, felder);
      if (aufgeloest.zustand === "keineListe") return inaktiv(regel, "fehlt", GRUND_FORMAT);
      if (aufgeloest.zustand === "fehlt") return inaktiv(regel, "fehlt", GRUND_NICHT_PRUEFBAR);

      // Werte sammeln (Arrays flachklopfen, fehlende Werte ignorieren) und je Wert die Personen merken.
      const vorkommen = new Map();
      let anzahlWerte = 0;
      for (const element of aufgeloest.elemente) {
        const werte = Array.isArray(element.wert) ? element.wert : [element.wert];
        for (const wert of werte) {
          if (istLeer(wert) || typeof wert === "object") continue;
          anzahlWerte += 1;
          const schluessel = `${typeof wert}:${wert}`;
          if (!vorkommen.has(schluessel)) vorkommen.set(schluessel, { wert, bei: [] });
          vorkommen.get(schluessel).bei.push(element.bezeichnung);
        }
      }
      const ergebnis = (art, ist, betroffene = []) =>
        ({ regelId: regel.id, ergebnis: art, soll, ist, grund: null, betroffene, anlass: null });

      if (anzahlWerte < 2) return ergebnis("ok", anzahlWerte === 0 ? "keine Angabe" : "nur eine Angabe");
      const doppelt = [...vorkommen.values()].filter((v) => v.bei.length > 1);
      if (doppelt.length === 0) {
        return ergebnis("ok", `alle verschieden (${[...vorkommen.values()].map((v) => wertAnzeigen(v.wert)).join(", ")})`);
      }
      const ist = doppelt.map(({ wert, bei }) => {
        const personen = [...new Set(bei)];
        const wo = personen.length === 1 ? `doppelt bei ${personen[0]}` : `bei ${personen.slice(0, -1).join(", ")} und ${personen.at(-1)}`;
        return `${merkmalBezeichnung} ${wertAnzeigen(wert)} ${wo}`;
      }).join("; ");
      return ergebnis(regel.stufe, ist, [...new Set(doppelt.flatMap((v) => v.bei))]);
    },
  },

  frist: {
    bezeichnung: "Frist",
    beschreibung: "Ein Datum darf einen Stichtag nicht überschreiten.",
    formular: "vorlage-frist",
    hinzufuegbar: false, // Ausbau (A-34)
    feldDatentypen: DATENTYPEN_FRIST,
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld", "stichtag", "kulanzTage", "uhrzeit"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler, { datentypen: DATENTYPEN_FRIST });
        if (!istIsoDatum(parameter.stichtag)) fehler.push("stichtag: Datum im Format JJJJ-MM-TT erwartet");
        pruefeZahl(parameter.kulanzTage, "kulanzTage", SCHRANKEN.kulanzTage, fehler);
        if (parameter.uhrzeit !== undefined) fehler.push(`uhrzeit: ${ausbau("Eine Uhrzeit der Frist")}`);
      });
    },
    auswerten(datensatz, regel, kontext) {
      const { stichtag, kulanzTage } = regel.parameter;
      const ende = plusTage(stichtag, kulanzTage);
      const soll = kulanzTage > 0
        ? `bis ${datumAnzeigen(stichtag)}, mit Kulanz bis ${datumAnzeigen(ende)}`
        : `bis ${datumAnzeigen(stichtag)}`;
      return jeWert(datensatz, regel, kontext, soll, (wert) => {
        if (istLeer(wert)) return teil("fehlt", "fehlt");
        if (!istIsoDatumZeit(wert)) return teil("fehlt", wertAnzeigen(wert), "Nicht prüfbar – kein gültiges Datum");
        // Im Kern zählt nur der Datumsteil (erste 10 Zeichen), einschließlich Stichtag (O-02).
        const datum = wert.slice(0, 10);
        if (datum <= stichtag) return teil("ok", datumAnzeigen(wert));
        const tage = tageZwischen(stichtag, datum);
        const zuSpaet = `${anzahlText(tage, "Tag", "Tage")} nach der Frist`;
        if (datum <= ende) return teil("kulanz", datumAnzeigen(wert), `${zuSpaet}, innerhalb der Kulanz`);
        return teil("abweichung", datumAnzeigen(wert), zuSpaet);
      });
    },
  },

  umfang: {
    bezeichnung: "Umfang",
    beschreibung: "Ein Zahlenwert darf einen Höchstwert nicht überschreiten.",
    formular: "vorlage-umfang",
    hinzufuegbar: false, // Ausbau (A-34)
    feldDatentypen: DATENTYPEN_UMFANG,
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld", "max", "messung", "toleranzProzent"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler, { datentypen: DATENTYPEN_UMFANG });
        pruefeZahl(parameter.max, "max", SCHRANKEN.umfangMax, fehler);
        if (parameter.messung !== undefined && parameter.messung !== "wert") {
          fehler.push(`messung: ${ausbau(`Die Messung „${parameter.messung}“`)}; erlaubt ist nur „wert“`);
        }
        if (parameter.toleranzProzent !== undefined && parameter.toleranzProzent !== 0) {
          fehler.push(`toleranzProzent: ${ausbau("Eine Toleranz")}`);
        }
      });
    },
    auswerten(datensatz, regel, kontext) {
      const { max } = regel.parameter;
      return jeWert(datensatz, regel, kontext, `höchstens ${zahlAnzeigen(max)}`, (wert) => {
        if (istLeer(wert)) return teil("fehlt", "fehlt");
        if (typeof wert !== "number" || !Number.isFinite(wert)) return teil("fehlt", wertAnzeigen(wert), "Nicht prüfbar – keine Zahl");
        return teil(wert <= max ? "ok" : "abweichung", zahlAnzeigen(wert));
      });
    },
  },

  muster: {
    bezeichnung: "Muster",
    beschreibung: "Ein Wert muss vollständig zu einem Muster passen.",
    formular: "vorlage-muster",
    hinzufuegbar: false, // Ausbau (A-34)
    feldDatentypen: null,
    parameterTesten(parameter, regelsatz) {
      return parameterFehler(parameter, ["feld", "muster", "beschreibung"], (fehler) => {
        pruefeFeldverweis(parameter.feld, "feld", regelsatz, fehler);
        pruefeText(parameter.muster, "muster", SCHRANKEN.muster, fehler);
        pruefeText(parameter.beschreibung, "beschreibung", SCHRANKEN.musterBeschreibung, fehler);
        if (typeof parameter.muster === "string") {
          try {
            kompiliereMuster(parameter.muster);
          } catch {
            fehler.push("muster: Ungültiges Muster. In eckigen Klammern Sonderzeichen wie - mit \\ maskieren.");
          }
        }
      });
    },
    auswerten(datensatz, regel, kontext) {
      const ausdruck = kompiliereMuster(regel.parameter.muster);
      return jeWert(datensatz, regel, kontext, regel.parameter.beschreibung, (wert) => {
        if (istLeer(wert)) return teil("fehlt", "fehlt");
        if (typeof wert !== "string" && typeof wert !== "number") return teil("fehlt", wertAnzeigen(wert), GRUND_FORMAT);
        const text = String(wert);
        return teil(ausdruck.test(text) ? "ok" : "abweichung", text);
      });
    },
  },
});
