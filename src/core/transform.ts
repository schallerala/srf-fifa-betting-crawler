import { type Static, Type } from "@sinclair/typebox";
import { type ConfrontationScore, ConfrontationScoreSchema } from "./types.ts";
import { parseOrThrow } from "./validate.ts";

/**
 * A confrontation enriched with the participant's running total — the shape
 * that drives the curve across the whole competition.
 */
export const CumulativePointSchema = Type.Composite([
  ConfrontationScoreSchema,
  Type.Object({
    /** Sum of `points` for this and all earlier (by date) scored matches. */
    cumulative: Type.Number(),
  }),
]);
export type CumulativePoint = Static<typeof CumulativePointSchema>;

const ConfrontationListSchema = Type.Array(ConfrontationScoreSchema);

/**
 * Sort confrontations chronologically and attach a running cumulative score.
 *
 * Only scored confrontations contribute points, but unscored future fixtures
 * are kept (with the previous cumulative carried forward) so the spreadsheet
 * shows the full upcoming schedule too.
 */
export function buildCumulative(confrontations: readonly ConfrontationScore[]): CumulativePoint[] {
  // Validate the input boundary so a malformed row never silently skews a curve.
  const valid = parseOrThrow(ConfrontationListSchema, confrontations, "buildCumulative input");

  // Spread first so the caller's array is never mutated.
  // oxlint-disable-next-line no-array-sort
  const sorted = [...valid].sort((a, b) =>
    a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : 0,
  );

  let running = 0;
  return sorted.map((c) => {
    if (c.scored) running += c.points;
    return parseOrThrow(
      CumulativePointSchema,
      { ...c, cumulative: running },
      "buildCumulative output",
    );
  });
}

/**
 * Header row written above the data rows in each participant's sheet.
 *
 * The bet (`Bet Home`/`Bet Away`) and the actual outcome (`Final Home`/`Final
 * Away`) are distinct columns. `Cumulative` is the running total — the y-axis
 * of the curve that is the whole point of the project ("score after every game").
 */
export const SHEET_HEADERS = [
  "Date",
  "Home",
  "Away",
  "Bet Home",
  "Bet Away",
  "Final Home",
  "Final Away",
  "Points",
  "Correct Winner",
  "Correct Home Score",
  "Correct Away Score",
  "Correct Diff + Winner",
  "Cumulative",
] as const;

/** A single validated spreadsheet row (matching {@link SHEET_HEADERS}). */
export const SheetRowSchema = Type.Array(
  Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
);
export type SheetRow = Static<typeof SheetRowSchema>;

/** A validated 2D table of spreadsheet cells. */
export const SheetRowsSchema = Type.Array(SheetRowSchema);
export type SheetRows = Static<typeof SheetRowsSchema>;

/** Render a nullable goal count, or empty string when unknown. */
function cell(value: number | null): string | number {
  return value ?? "";
}

/** Build one validated sheet row from a confrontation + its running total. */
export function toSheetRow(c: ConfrontationScore, cumulative: number): SheetRow {
  return parseOrThrow(
    SheetRowSchema,
    [
      c.eventDate,
      c.homeTeam,
      c.awayTeam,
      cell(c.pickHome),
      cell(c.pickAway),
      cell(c.homeScore),
      cell(c.awayScore),
      c.points,
      c.correctWinner,
      c.correctHomeScore,
      c.correctAwayScore,
      c.correctDifferenceAndWinner,
      cumulative,
    ],
    "toSheetRow output",
  );
}

/**
 * Convert cumulative points into spreadsheet rows (matching {@link SHEET_HEADERS}).
 *
 * Only **played** matches are emitted — upcoming/unplayed fixtures are dropped
 * entirely. Their cumulative was already carried forward in {@link buildCumulative},
 * so the running total on the remaining rows stays correct. Used by the local CLI;
 * the Apps Script path appends incrementally via {@link planSheetAppend}.
 */
export function toSheetRows(points: readonly CumulativePoint[]): SheetRows {
  const rows = points.filter((p) => p.scored).map((p) => toSheetRow(p, p.cumulative));
  return parseOrThrow(SheetRowsSchema, rows, "toSheetRows output");
}

/** One fetched round, handed to {@link planSheetAppend}. */
export interface FetchedRound {
  /** This round's id. */
  id: number;
  /** Round to resume from if this round turns out fully complete (next round, or
   *  itself when it's the last round). */
  nextId: number;
  /** The round's parsed confrontations (any order; empty if the round 404s). */
  confrontations: readonly ConfrontationScore[];
}

/** The incremental update a single run should apply to a participant's sheet. */
export interface SheetAppendPlan {
  /** New rows to append after the existing sheet content (cumulative filled in). */
  rows: SheetRows;
  /** Round id to resume crawling from on the next run. */
  resumeRound: number;
  /** Kickoff time (ISO) of the latest game now written, or the unchanged previous
   *  value when nothing new was appended. The next run's dedupe watermark. */
  lastWrittenEventDate: string | null;
}

/**
 * Plan the incremental sheet update for one participant, given the rounds fetched
 * this run (from the resume round onward, in chronological order).
 *
 * Walking games in date order, it appends every **played** game that is newer than
 * `previousWatermark`, advancing through fully-complete rounds. It **stops at the
 * first not-yet-played game** and reports that game's round as `resumeRound`. Games
 * with the same kickoff as the first unplayed game are held back too, so a pair of
 * simultaneous fixtures is never split across runs.
 *
 * Pure (no GAS/Node APIs) so the tricky resume/dedupe logic is unit-testable.
 */
export function planSheetAppend(
  fetched: readonly FetchedRound[],
  previousWatermark: string | null,
  baselineCumulative: number,
): SheetAppendPlan {
  // Fixed threshold for "already written in a previous run". Never advanced mid-run
  // so simultaneous new games (equal kickoff) are all appended, not deduped away.
  const writtenThroughMs =
    previousWatermark == null ? Number.NEGATIVE_INFINITY : Date.parse(previousWatermark);

  let cumulative = baselineCumulative;
  let lastWritten = previousWatermark;
  let lastWrittenMs = writtenThroughMs;
  let resumeRound = fetched.length > 0 ? fetched[0]!.id : 0;
  const rows: SheetRow[] = [];

  for (const round of fetched) {
    // Spread first so the caller's array is never mutated.
    // oxlint-disable-next-line no-array-sort
    const confs = [...round.confrontations].sort(
      (a, b) => Date.parse(a.eventDate) - Date.parse(b.eventDate),
    );
    const firstUnplayed = confs.find((c) => !c.scored);
    const cutoffMs = firstUnplayed ? Date.parse(firstUnplayed.eventDate) : Number.POSITIVE_INFINITY;

    for (const c of confs) {
      if (!c.scored) continue;
      const ms = Date.parse(c.eventDate);
      if (ms >= cutoffMs) continue; // at/after the first unplayed game → hold back
      if (ms <= writtenThroughMs) continue; // already written on an earlier run
      cumulative += c.points;
      rows.push(toSheetRow(c, cumulative));
      if (ms > lastWrittenMs) {
        lastWritten = c.eventDate;
        lastWrittenMs = ms;
      }
    }

    if (firstUnplayed) {
      // Round still has unplayed games — resume here next time and stop.
      resumeRound = round.id;
      return { rows, resumeRound, lastWrittenEventDate: lastWritten };
    }
    // Round fully complete — its games are all written; resume from the next round.
    resumeRound = round.nextId;
  }

  return { rows, resumeRound, lastWrittenEventDate: lastWritten };
}
