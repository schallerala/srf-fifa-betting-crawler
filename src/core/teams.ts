import { Type } from "@sinclair/typebox";
import { parseOrThrow } from "./validate.ts";

/**
 * German → English country names. The site renders team names in German; we
 * translate them so the sheet reads in English.
 *
 * The key set is the 48 distinct team names found across all cached pages
 * (`test/fixtures/pages/`). A test asserts the map stays exhaustive, so if a new
 * team appears the suite fails until it's added here. Validated at module load.
 */
export const COUNTRY_NAMES_DE_EN: Readonly<Record<string, string>> = parseOrThrow(
  Type.Record(Type.String(), Type.String()),
  {
    Ägypten: "Egypt",
    Algerien: "Algeria",
    Argentinien: "Argentina",
    Australien: "Australia",
    Belgien: "Belgium",
    "Bosnien-Herzeg.": "Bosnia-Herzegovina",
    Brasilien: "Brazil",
    Curaçao: "Curaçao",
    Deutschland: "Germany",
    "DR Kongo": "DR Congo",
    Ecuador: "Ecuador",
    Elfenbeinküste: "Ivory Coast",
    England: "England",
    Frankreich: "France",
    Ghana: "Ghana",
    Haiti: "Haiti",
    Irak: "Iraq",
    Iran: "Iran",
    Japan: "Japan",
    Jordanien: "Jordan",
    Kanada: "Canada",
    "Kap Verde": "Cape Verde",
    Katar: "Qatar",
    Kolumbien: "Colombia",
    Kroatien: "Croatia",
    Marokko: "Morocco",
    Mexiko: "Mexico",
    Neuseeland: "New Zealand",
    Niederlande: "Netherlands",
    Norwegen: "Norway",
    Österreich: "Austria",
    Panama: "Panama",
    Paraguay: "Paraguay",
    Portugal: "Portugal",
    "Saudi-Arabien": "Saudi Arabia",
    Schottland: "Scotland",
    Schweden: "Sweden",
    Schweiz: "Switzerland",
    Senegal: "Senegal",
    Spanien: "Spain",
    Südafrika: "South Africa",
    Südkorea: "South Korea",
    Tschechien: "Czechia",
    Tunesien: "Tunisia",
    Türkei: "Turkey",
    Uruguay: "Uruguay",
    USA: "USA",
    Usbekistan: "Uzbekistan",
  },
  "COUNTRY_NAMES_DE_EN",
);

/** Translate a German team name to English; unknown names pass through unchanged. */
export function translateTeamName(name: string): string {
  return COUNTRY_NAMES_DE_EN[name] ?? name;
}
