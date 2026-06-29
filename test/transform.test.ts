import { describe, expect, it } from "vitest";
import { type FetchedRound, planSheetAppend, SHEET_HEADERS } from "../src/core/transform.ts";
import type { ConfrontationScore } from "../src/core/types.ts";

/** Build a ConfrontationScore with sensible defaults; override what matters. */
function conf(over: Partial<ConfrontationScore>): ConfrontationScore {
  return {
    eventDate: "2026-06-11T12:00:00Z",
    round: 41,
    betId: "b",
    homeTeam: "Home",
    awayTeam: "Away",
    pickHome: null,
    pickAway: null,
    homeScore: null,
    awayScore: null,
    points: 0,
    correctWinner: false,
    correctHomeScore: false,
    correctAwayScore: false,
    correctDifferenceAndWinner: false,
    scored: false,
    ...over,
  };
}

/** A played game shorthand. */
function played(date: string, points: number, round = 41): ConfrontationScore {
  return conf({ eventDate: date, points, scored: true, round, homeScore: 1, awayScore: 0 });
}

const CUMULATIVE_COL = SHEET_HEADERS.length - 1;
const cumulativeOf = (rows: readonly (string | number | boolean)[][]) =>
  rows.map((r) => r[CUMULATIVE_COL]);

describe("planSheetAppend", () => {
  it("appends all played games of a complete round and resumes at the next round", () => {
    const fetched: FetchedRound[] = [
      {
        id: 41,
        nextId: 42,
        confrontations: [played("2026-06-11T12:00:00Z", 5), played("2026-06-12T12:00:00Z", 3)],
      },
    ];
    const plan = planSheetAppend(fetched, null, 0);

    expect(plan.rows).toHaveLength(2);
    expect(cumulativeOf(plan.rows)).toEqual([5, 8]);
    expect(plan.resumeRound).toBe(42);
    expect(plan.lastWrittenEventDate).toBe("2026-06-12T12:00:00Z");
  });

  it("stops at the first unplayed game and resumes at that round", () => {
    const fetched: FetchedRound[] = [
      {
        id: 41,
        nextId: 42,
        confrontations: [
          played("2026-06-11T12:00:00Z", 5),
          conf({ eventDate: "2026-06-12T12:00:00Z", scored: false }), // not played yet
        ],
      },
    ];
    const plan = planSheetAppend(fetched, null, 0);

    expect(plan.rows).toHaveLength(1);
    expect(plan.resumeRound).toBe(41);
    expect(plan.lastWrittenEventDate).toBe("2026-06-11T12:00:00Z");
  });

  it("skips games already written (kickoff <= watermark) and continues the total", () => {
    const fetched: FetchedRound[] = [
      {
        id: 41,
        nextId: 42,
        confrontations: [
          played("2026-06-11T12:00:00Z", 5), // already written last run
          played("2026-06-12T12:00:00Z", 7), // new
        ],
      },
    ];
    const plan = planSheetAppend(fetched, "2026-06-11T12:00:00Z", 5 /* baseline cumulative */);

    expect(plan.rows).toHaveLength(1);
    expect(cumulativeOf(plan.rows)).toEqual([12]); // 5 baseline + 7
    expect(plan.resumeRound).toBe(42);
  });

  it("holds back a game kicking off at the same time as the first unplayed game", () => {
    const fetched: FetchedRound[] = [
      {
        id: 41,
        nextId: 42,
        confrontations: [
          played("2026-06-11T18:00:00Z", 5), // simultaneous with the unplayed one below
          conf({ eventDate: "2026-06-11T18:00:00Z", scored: false }),
        ],
      },
    ];
    const plan = planSheetAppend(fetched, null, 0);

    expect(plan.rows).toHaveLength(0); // neither written until both are played
    expect(plan.resumeRound).toBe(41);
    expect(plan.lastWrittenEventDate).toBeNull();
  });

  it("walks through several complete rounds before stopping at an incomplete one", () => {
    const fetched: FetchedRound[] = [
      { id: 41, nextId: 42, confrontations: [played("2026-06-11T12:00:00Z", 4, 41)] },
      {
        id: 42,
        nextId: 43,
        confrontations: [
          played("2026-06-16T12:00:00Z", 6, 42),
          conf({ eventDate: "2026-06-17T12:00:00Z", scored: false, round: 42 }),
        ],
      },
    ];
    const plan = planSheetAppend(fetched, null, 0);

    expect(cumulativeOf(plan.rows)).toEqual([4, 10]);
    expect(plan.resumeRound).toBe(42); // stopped inside round 42
  });
});
