import { parse } from "node-html-parser";
import { translateTeamName } from "./teams.ts";
import {
  type Bet,
  type ConfrontationScore,
  ConfrontationScoreSchema,
  type ScoreBetProps,
  ScoreBetPropsSchema,
} from "./types.ts";
import { parseOrThrow } from "./validate.ts";

/**
 * Minimal HTML-entity decode for the standard set found in attribute values.
 * `node-html-parser` already decodes `getAttribute` values, but we apply this
 * defensively so the parser is robust to raw payloads (e.g. fixtures captured
 * verbatim, or environment differences when bundled into Apps Script).
 */
function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Extract every `ScoreBet` payload from a betting-page HTML string.
 *
 * Rather than scraping the rendered `<div>`s (brittle, locale-dependent), we
 * read the structured JSON the site already embeds in each component's
 * `data-react-props` attribute and validate it against {@link ScoreBetPropsSchema}.
 *
 * @throws if a `ScoreBet` element is missing/has unparsable props, or if the
 *   payload fails schema validation — surfacing site changes loudly.
 */
export function parseScoreBets(html: string): ScoreBetProps[] {
  const root = parse(html);
  const nodes = root.querySelectorAll('[data-react-class="ScoreBet"]');

  return nodes.map((node, index) => {
    const raw = node.getAttribute("data-react-props");
    if (!raw) {
      throw new Error(`ScoreBet #${index} is missing data-react-props`);
    }

    let json: unknown;
    try {
      json = JSON.parse(decodeEntities(raw));
    } catch (cause) {
      throw new Error(`ScoreBet #${index} has unparsable data-react-props`, {
        cause,
      });
    }

    return parseOrThrow(ScoreBetPropsSchema, json, `ScoreBet #${index} props`);
  });
}

/**
 * Coerce a raw picks/final_results list into a `[home, away]` pair of real
 * numbers, mapping anything unknown (missing list, empty `[]`, or a `"?"`/null
 * placeholder for a hidden game) to `null`.
 */
function numericPair(
  list: readonly (number | string | null)[] | null | undefined,
): [number | null, number | null] {
  const [rawHome, rawAway] = list ?? [];
  return [
    typeof rawHome === "number" ? rawHome : null,
    typeof rawAway === "number" ? rawAway : null,
  ];
}

/** Flatten a raw {@link Bet} into a normalized, schema-validated row. */
export function toConfrontationScore(bet: Bet): ConfrontationScore {
  const [home, away] = bet.teams;
  const breakdown = bet.scores ?? {};
  // A concrete pick/result needs two real numbers; anything else (missing, empty
  // `[]`, or a `"?"`/null placeholder for a hidden future game) reads as unknown.
  const [pickHome, pickAway] = numericPair(bet.picks);
  const [homeScore, awayScore] = numericPair(bet.final_results);
  const played = homeScore !== null && awayScore !== null;
  const row = {
    eventDate: bet.event_date,
    round: bet.round,
    betId: String(bet.bet_id),
    homeTeam: translateTeamName(home?.name ?? "?"),
    awayTeam: translateTeamName(away?.name ?? "?"),
    pickHome,
    pickAway,
    homeScore,
    awayScore,
    points: bet.total_score ?? 0,
    correctWinner: (breakdown.winner ?? 0) > 0,
    correctHomeScore: (breakdown.home ?? 0) > 0,
    correctAwayScore: (breakdown.away ?? 0) > 0,
    correctDifferenceAndWinner: (breakdown.difference ?? 0) > 0,
    scored: bet.event_state === "over" && played,
  };
  return parseOrThrow(ConfrontationScoreSchema, row, `Confrontation (bet ${bet.bet_id})`);
}

/** Parse an HTML page directly into normalized confrontation rows. */
export function parseConfrontations(html: string): ConfrontationScore[] {
  return parseScoreBets(html).map((props) => toConfrontationScore(props.bet));
}
