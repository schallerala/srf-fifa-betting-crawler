/**
 * Google Apps Script entry points. Bound to a Google Spreadsheet, these
 * functions fetch each participant's betting pages, parse the embedded scores
 * and write one sheet per participant so the data can be charted as curves.
 *
 * This file is the ONLY part of the codebase allowed to use GAS globals
 * (`SpreadsheetApp`, `UrlFetchApp`, ...). All HTML parsing / scoring lives in
 * `../core` so it stays unit-testable with vitest. The whole thing is bundled
 * into a single `.gs` file before being pushed (see AGENTS.md → Deployment).
 */
import { Type } from "@sinclair/typebox";
import { buildBetUrl, PARTICIPANTS, ROUNDS } from "../core/config.ts";
import { parseConfrontations } from "../core/parser.ts";
import {
  type FetchedRound,
  planSheetAppend,
  SHEET_HEADERS,
  type SheetRows,
} from "../core/transform.ts";
import type { ConfrontationScore } from "../core/types.ts";
import { parseOrThrow } from "../core/validate.ts";
import {
  clearStore,
  ParticipantStateSchema,
  participantKey,
  readValue,
  writeValue,
} from "./store.ts";

/** A betting page must be a non-empty HTML document. */
const HtmlSchema = Type.String({ minLength: 1 });

/** Fetch one betting page via the GAS URL fetch service. */
function fetchBetPage(participantId: string, roundId: number): string {
  const url = buildBetUrl(participantId, roundId);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`Fetch failed for ${url}: HTTP ${code}`);
  }
  return parseOrThrow(HtmlSchema, response.getContentText(), `fetch ${url}`);
}

/** Get the sheet with the given name, creating it if it does not exist. */
function getOrCreateSheet(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
): GoogleAppsScript.Spreadsheet.Sheet {
  return spreadsheet.getSheetByName(name) ?? spreadsheet.insertSheet(name);
}

/** Write the header row (and freeze it) if the sheet is still empty. */
function ensureHeader(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([Array.from(SHEET_HEADERS)]);
  sheet.setFrozenRows(1);
}

/** The cumulative total in the last data row, or 0 if only the header exists. */
function lastCumulative(sheet: GoogleAppsScript.Spreadsheet.Sheet): number {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const value = sheet.getRange(lastRow, SHEET_HEADERS.length).getValue();
  return typeof value === "number" ? value : 0;
}

/** Append rows after the existing content in one batched write. */
function appendRows(sheet: GoogleAppsScript.Spreadsheet.Sheet, rows: SheetRows): void {
  if (rows.length === 0) return;
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, SHEET_HEADERS.length).setValues(rows);
}

/**
 * Fetch rounds for a participant starting at `startRoundId`, stopping after the
 * first round that still has an unplayed game (later rounds aren't ready yet, so
 * we don't waste requests on them). Rounds before `startRoundId` are already
 * complete and in the sheet, so they're never fetched.
 */
function fetchUntilIncomplete(participantId: string, startRoundId: number): FetchedRound[] {
  const startIndex = Math.max(
    0,
    ROUNDS.findIndex((r) => r.id === startRoundId),
  );
  const fetched: FetchedRound[] = [];
  for (let i = startIndex; i < ROUNDS.length; i++) {
    const round = ROUNDS[i]!;
    const nextId = ROUNDS[i + 1]?.id ?? round.id;
    let confrontations: ConfrontationScore[] = [];
    try {
      confrontations = parseConfrontations(fetchBetPage(participantId, round.id));
    } catch (err) {
      // Round may not exist yet, or the fetch failed — treat as "not ready".
      Logger.log(`Round ${round.id} for ${participantId}: ${(err as Error).message}`);
    }
    fetched.push({ id: round.id, nextId, confrontations });

    const complete = confrontations.length > 0 && confrontations.every((c) => c.scored);
    if (!complete) break;
  }
  return fetched;
}

/**
 * Incrementally update one participant's sheet: fetch from the stored resume
 * round, append the newly-played games, and persist the new resume pointer +
 * watermark. Finished rounds are never re-fetched and confrontations are never
 * cached — the sheet is the only store of game data.
 */
function updateParticipant(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  participant: { id: string; name: string },
): void {
  const key = participantKey(participant.id);
  const state = readValue(ParticipantStateSchema, key);
  const startRound = state?.resumeRound ?? ROUNDS[0]!.id;

  const fetched = fetchUntilIncomplete(participant.id, startRound);
  if (fetched.length === 0) return;

  const sheet = getOrCreateSheet(spreadsheet, participant.name);
  ensureHeader(sheet);

  const plan = planSheetAppend(fetched, state?.lastWrittenEventDate ?? null, lastCumulative(sheet));
  appendRows(sheet, plan.rows);

  writeValue(ParticipantStateSchema, key, {
    lastWrittenEventDate: plan.lastWrittenEventDate,
    resumeRound: plan.resumeRound,
  });
}

/**
 * Main entry point — run from the Apps Script editor or a time-based trigger.
 * Updates every participant's sheet with games played since the last run.
 */
function updateAllParticipants(): void {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  for (const participant of PARTICIPANTS) {
    updateParticipant(spreadsheet, participant);
  }
}

/** Adds a custom menu so the crawl can be triggered from the Sheets UI. */
function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("FIFA Betting")
    .addItem("Update all participants", "updateAllParticipants")
    .addToUi();
}

/**
 * The entry points exposed to the Apps Script runtime. The bundle (see
 * tsup.config.ts) wraps everything in an IIFE assigned to `GAS` and then emits
 * top-level `function` declarations for exactly these names — so only they show
 * up as runnable functions in the Apps Script UI, not the internal helpers.
 */
export { clearStore, onOpen, updateAllParticipants };
