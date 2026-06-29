import { type Static, Type } from "@sinclair/typebox";

/**
 * Schemas describing the JSON embedded in each `ScoreBet` React component
 * (the `data-react-props` attribute). This is the canonical, structured source
 * of truth for a single bet/confrontation — far richer than the rendered HTML.
 *
 * The schemas are intentionally lenient (`additionalProperties: true`, generous
 * nullability) so that upstream markup tweaks do not break parsing. We only hard-
 * require the handful of fields we actually consume.
 */

/** One team participating in a confrontation. */
export const TeamSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    image: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true },
);
export type Team = Static<typeof TeamSchema>;

/** Point breakdown for a scored bet. `null` until the match has been scored. */
export const ScoreBreakdownSchema = Type.Union([
  Type.Object(
    {
      winner: Type.Optional(Type.Number()),
      home: Type.Optional(Type.Number()),
      away: Type.Optional(Type.Number()),
      difference: Type.Optional(Type.Number()),
    },
    { additionalProperties: true },
  ),
  Type.Null(),
]);
export type ScoreBreakdown = Static<typeof ScoreBreakdownSchema>;

/**
 * A single [home, away] entry: a goal count, or an "unknown" placeholder.
 *
 * Hidden future games (censored, `event_state` "open") expose the score as
 * unknown rather than an integer — in the payload that shows up as an empty
 * `picks` array, a missing `final_results`, or a non-numeric marker. We accept
 * `string`/`null` entries so such bets validate instead of throwing.
 */
const GoalEntrySchema = Type.Union([Type.Number(), Type.String(), Type.Null()]);

/**
 * Picks / final results: an array of {@link GoalEntrySchema} (length 0 for a
 * hidden/not-yet-placed bet, 2 once concrete), or null when absent.
 */
const ScoreListSchema = Type.Union([Type.Array(GoalEntrySchema), Type.Null()]);

/**
 * The `bet` object inside `data-react-props`. Only `round`, `event_date`,
 * `bet_id` and `teams` are required; everything tied to a finished match is
 * optional/nullable because we also fetch fixtures that have not been played.
 */
export const BetSchema = Type.Object(
  {
    event_date: Type.String(),
    event_name: Type.Optional(Type.String()),
    meta_location: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    deadline: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    round: Type.Number(),
    bet_id: Type.Union([Type.String(), Type.Number()]),
    type: Type.Optional(Type.String()),
    total_score: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    picks: Type.Optional(ScoreListSchema),
    final_results: Type.Optional(ScoreListSchema),
    teams: Type.Array(TeamSchema),
    censored: Type.Optional(Type.Boolean()),
    event_state: Type.Optional(Type.String()),
    race_over: Type.Optional(Type.Boolean()),
    scores: Type.Optional(ScoreBreakdownSchema),
  },
  { additionalProperties: true },
);
export type Bet = Static<typeof BetSchema>;

/** The full `data-react-props` payload of a `ScoreBet` element. */
export const ScoreBetPropsSchema = Type.Object(
  {
    bet: BetSchema,
    authenticity_token: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type ScoreBetProps = Static<typeof ScoreBetPropsSchema>;

/** A goal count, or null when unknown (unplayed match / no bet placed). */
const NullableGoalsSchema = Type.Union([Type.Number(), Type.Null()]);

/**
 * A single normalized confrontation row, flattened from a {@link Bet} for one
 * participant. This is what we ultimately write to the spreadsheet, and the
 * shape we validate the parser's output against.
 *
 * We keep the participant's prediction (`pickHome`/`pickAway`, from `picks`)
 * and the actual outcome (`homeScore`/`awayScore`, from `final_results`) as
 * distinct fields so the sheet can show both side by side.
 *
 * The four `correct*` booleans are derived from the bet's `scores` breakdown
 * (each component being non-zero means that aspect was predicted correctly):
 *   - correctWinner               → scores.winner    (worth 5 pts)
 *   - correctHomeScore            → scores.home
 *   - correctAwayScore            → scores.away
 *   - correctDifferenceAndWinner  → scores.difference
 */
export const ConfrontationScoreSchema = Type.Object({
  /** ISO date-time the match kicks off. Drives the curve's x-axis (ordered). */
  eventDate: Type.String(),
  /** Round id (41..49). Kept for grouping/cumulative logic. */
  round: Type.Number(),
  /** Stable bet id from the site. */
  betId: Type.String(),
  homeTeam: Type.String(),
  awayTeam: Type.String(),
  /** Participant's predicted home goals, or null if no bet was placed. */
  pickHome: NullableGoalsSchema,
  /** Participant's predicted away goals, or null if no bet was placed. */
  pickAway: NullableGoalsSchema,
  /** Actual final goals for the home team, or null if not played yet. */
  homeScore: NullableGoalsSchema,
  /** Actual final goals for the away team, or null if not played yet. */
  awayScore: NullableGoalsSchema,
  /** Points earned for this bet (0 if unscored). */
  points: Type.Number(),
  /** Predicted the match winner / draw correctly (5 pts). */
  correctWinner: Type.Boolean(),
  /** Predicted the home team's exact goal count correctly. */
  correctHomeScore: Type.Boolean(),
  /** Predicted the away team's exact goal count correctly. */
  correctAwayScore: Type.Boolean(),
  /** Predicted the goal difference and winner correctly. */
  correctDifferenceAndWinner: Type.Boolean(),
  /** Whether the match has been played and scored. */
  scored: Type.Boolean(),
});
export type ConfrontationScore = Static<typeof ConfrontationScoreSchema>;
