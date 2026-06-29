import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARTICIPANTS, ROUND_NAMES, RoundId } from "../src/core/config.ts";
import { parseConfrontations, parseScoreBets } from "../src/core/parser.ts";
import { COUNTRY_NAMES_DE_EN } from "../src/core/teams.ts";
import { buildCumulative, toSheetRows } from "../src/core/transform.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const sampleHtml = readFileSync(join(FIXTURES, "round-41-sample.html"), "utf8");
const futureHtml = readFileSync(join(FIXTURES, "round-44-future.html"), "utf8");

/**
 * Read a real captured page for one participant + round. These are committed
 * under test/fixtures/pages/ (copied from the local cache) so the snapshot base
 * is reproducible on any checkout, independent of `cache/`.
 */
function readPage(participantId: string, round: RoundId): string {
  return readFileSync(join(FIXTURES, "pages", `${participantId}-${round}.html`), "utf8");
}

describe("parseScoreBets", () => {
  it("extracts every ScoreBet payload, decoding entity-encoded props", () => {
    const bets = parseScoreBets(sampleHtml);
    expect(bets).toHaveLength(3);
    // Bet A is the verbatim, &quot;-encoded payload from the live site.
    const first = bets[0]!;
    expect(first.bet.teams.map((t) => t.name)).toEqual(["Mexiko", "Südafrika"]);
    expect(first.bet.total_score).toBe(10);
  });

  it("throws loudly when props fail schema validation", () => {
    const broken = '<div data-react-class="ScoreBet" data-react-props=\'{"bet":{}}\'></div>';
    expect(() => parseScoreBets(broken)).toThrow(/ScoreBet #0 props: invalid/);
  });

  it("accepts a hidden future game (empty picks, no results/scores)", () => {
    const bets = parseScoreBets(futureHtml);
    expect(bets).toHaveLength(1);
    const { bet } = bets[0]!;
    expect(bet.round).toBe(RoundId.Knockout16);
    expect(bet.picks).toEqual([]);
    expect(bet.censored).toBe(true);
    expect(bet.event_state).toBe("open");
    // The hidden score has no `final_results` / `scores` keys at all.
    expect(bet.final_results).toBeUndefined();
    expect(bet.scores).toBeUndefined();
  });
});

describe("parseConfrontations", () => {
  it("normalizes the actual score and the four correctness flags", () => {
    const rows = parseConfrontations(sampleHtml);

    // Bet A — Mexico 2:0 South Africa, perfect prediction (10 pts, all flags true).
    // Team names are translated from German on the way to ConfrontationScore.
    expect(rows[0]).toMatchObject({
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      pickHome: 2,
      pickAway: 0,
      homeScore: 2,
      awayScore: 0,
      points: 10,
      correctWinner: true,
      correctHomeScore: true,
      correctAwayScore: true,
      correctDifferenceAndWinner: true,
      scored: true,
    });

    // Bet B — bet 1:1, actual 3:1; only the winner was right (4 pts: winner 2 + away 2).
    expect(rows[1]).toMatchObject({
      homeTeam: "Brazil",
      pickHome: 1,
      pickAway: 1,
      homeScore: 3,
      awayScore: 1,
      points: 4,
      correctWinner: true,
      correctHomeScore: false,
      correctAwayScore: true,
      correctDifferenceAndWinner: false,
    });

    // Bet C — not yet played: no pick, no scores, nothing correct.
    expect(rows[2]).toMatchObject({
      homeTeam: "Spain",
      pickHome: null,
      pickAway: null,
      homeScore: null,
      awayScore: null,
      points: 0,
      scored: false,
      correctWinner: false,
    });
  });

  it("normalizes a hidden future game to unknown scores, not scored", () => {
    const [future] = parseConfrontations(futureHtml);
    expect(future).toMatchObject({
      round: RoundId.Knockout16,
      homeTeam: "Brazil",
      awayTeam: "Japan",
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
    });
  });

  it("matches the parsed-confrontations snapshot", () => {
    expect(parseConfrontations(sampleHtml)).toMatchSnapshot();
  });
});

describe("buildCumulative + toSheetRows", () => {
  it("orders by date and carries a running total across matches", () => {
    const curve = buildCumulative(parseConfrontations(sampleHtml));
    expect(curve.map((c) => c.cumulative)).toEqual([10, 14, 14]);
  });

  it("matches the sheet-rows snapshot", () => {
    const curve = buildCumulative(parseConfrontations(sampleHtml));
    expect(toSheetRows(curve)).toMatchSnapshot();
  });
});

/**
 * Static assertions against REAL data captured from the live site.
 */
describe("real captured data", () => {
  const ROUND = RoundId.GroupStageGame1;
  const realHtml = () => readPage("3MOax" /* David */, ROUND);

  it("parses the expected number of confrontations", () => {
    const rows = parseConfrontations(realHtml());
    expect(rows).toHaveLength(24);
  });

  it(`computes the expected total for David after ${ROUND_NAMES[ROUND]}`, () => {
    const curve = buildCumulative(parseConfrontations(realHtml()));
    const total = curve.at(-1)?.cumulative ?? 0;
    expect(total).toBe(101);
  });

  it("matches the expected first match", () => {
    const [first] = parseConfrontations(realHtml());
    expect(first).toMatchObject({
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 2,
      awayScore: 0,
      points: 10,
    });
  });
});

/**
 * Solid regression base: snapshot the full normalized parse for every
 * participant across the first three (group-stage) rounds. Any change in
 * parsing/normalization that alters real output will surface here.
 *
 * Regenerate intentionally with `nub run test:update` after re-capturing pages.
 */
describe("group-stage snapshots (per participant)", () => {
  const GROUP_STAGE = [
    RoundId.GroupStageGame1,
    RoundId.GroupStageGame2,
    RoundId.GroupStageGame3,
  ] as const;

  for (const participant of PARTICIPANTS) {
    for (const round of GROUP_STAGE) {
      it(`${participant.name} — ${ROUND_NAMES[round]}`, () => {
        const confrontations = parseConfrontations(readPage(participant.id, round));
        expect(confrontations).toHaveLength(24);
        expect(confrontations).toMatchSnapshot();
      });
    }
  }

  it("has an English translation for every country in the cached pages", () => {
    const german = new Set<string>();
    for (const participant of PARTICIPANTS) {
      for (const round of GROUP_STAGE) {
        for (const { bet } of parseScoreBets(readPage(participant.id, round))) {
          for (const team of bet.teams) german.add(team.name);
        }
      }
    }
    const untranslated = [...german].filter((name) => !(name in COUNTRY_NAMES_DE_EN));
    expect(untranslated).toEqual([]);
  });
});
