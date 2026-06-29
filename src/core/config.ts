/**
 * Static configuration: who we crawl, which competition stages exist, and how
 * to build the URL for a given (participant, round) pair. Every value here is
 * validated against a TypeBox schema at module load so a typo in the config
 * fails fast rather than producing empty sheets at runtime.
 */
import { type Static, Type } from "@sinclair/typebox";
import { parseOrThrow } from "./validate.ts";

export const ParticipantSchema = Type.Object({
  /** The opaque id used by the website to identify the participant. */
  id: Type.String({ minLength: 1 }),
  /** Human-friendly name; also used as the spreadsheet tab title. */
  name: Type.String({ minLength: 1 }),
});
export type Participant = Static<typeof ParticipantSchema>;

/**
 * The group members we crawl. Alain (the current user) is just another id here:
 * his page is reachable without authentication, same as everyone else's.
 *
 *
 */
export const PARTICIPANTS: readonly Participant[] = parseOrThrow(
  Type.Array(ParticipantSchema, { minItems: 1 }),
  [
    { id: "n9KVw", name: "Alain" },
    { id: "3MOax", name: "David" },
    { id: "OXz9", name: "Andreas" },
    { id: "GO6Z3", name: "Caroline" },
    { id: "BrMV2", name: "Philipp" },
    { id: "74J9M", name: "Yves" },
    { id: "Lnbgz", name: "Bib Bibsen" },
    { id: "Vr5X3", name: "Sibylle" },
  ],
  "PARTICIPANTS config",
);

/**
 * The competition stages, by the id the website uses for each. This enum is the
 * single source of truth — refer to rounds by name (`RoundId.GroupStageGame1`)
 * everywhere instead of the bare id (`41`).
 */
export enum RoundId {
  GroupStageGame1 = 41,
  GroupStageGame2 = 42,
  GroupStageGame3 = 43,
  Knockout16 = 44,
  Knockout8 = 45,
  Knockout4 = 46,
  KnockoutSemifinals = 47,
  ThirdPlaceFinal = 48,
  KnockoutFinal = 49,
}

/** Human-friendly display name for each round id. */
export const ROUND_NAMES: Readonly<Record<RoundId, string>> = {
  [RoundId.GroupStageGame1]: "Group stage: game 1",
  [RoundId.GroupStageGame2]: "Group stage: game 2",
  [RoundId.GroupStageGame3]: "Group stage: game 3",
  [RoundId.Knockout16]: "Knockout 1/16",
  [RoundId.Knockout8]: "Knockout 1/8",
  [RoundId.Knockout4]: "Knockout 1/4",
  [RoundId.KnockoutSemifinals]: "Knockout Semifinals",
  [RoundId.ThirdPlaceFinal]: "3rd place final",
  [RoundId.KnockoutFinal]: "Knockout Final",
};

/** Numeric round ids in chronological order. */
export const ROUND_IDS: readonly RoundId[] = Object.values(RoundId).filter(
  (value): value is RoundId => typeof value === "number",
);

/** Resolve any round id to its display name (falls back to the bare id). */
export function roundName(id: number): string {
  return ROUND_NAMES[id as RoundId] ?? String(id);
}

export const RoundSchema = Type.Object({
  /** Round id used in the URL / embedded in each bet's `round` field. */
  id: Type.Enum(RoundId),
  /** Human-friendly stage name. */
  name: Type.String({ minLength: 1 }),
});
export type Round = Static<typeof RoundSchema>;

/** The competition stages, in chronological order, derived from {@link RoundId}. */
export const ROUNDS: readonly Round[] = parseOrThrow(
  Type.Array(RoundSchema, { minItems: 1 }),
  ROUND_IDS.map((id) => ({ id, name: ROUND_NAMES[id] })),
  "ROUNDS config",
);

/**
 * Base URL of the betting site.
 */
export const BASE_URL = "https://wmtippspiel.srf.ch/";

/**
 * Build the URL that returns the HTML page containing the `ScoreBet`
 * components for a single participant + round.
 */
export const FetchTargetSchema = Type.Object({
  participantId: Type.String({ minLength: 1 }),
  roundId: Type.Integer(),
});
export type FetchTarget = Static<typeof FetchTargetSchema>;

export function buildBetUrl(participantId: string, roundId: number): string {
  const target = parseOrThrow(
    FetchTargetSchema,
    { participantId, roundId },
    "buildBetUrl arguments",
  );
  // Plain string assembly (no `URL`) — the Apps Script V8 runtime has no WHATWG
  // URL class, and this code is shared with the GAS entry point.
  const base = BASE_URL.replace(/\/+$/, "");
  return `${base}/users/${target.participantId}/round/${target.roundId}`;
}
