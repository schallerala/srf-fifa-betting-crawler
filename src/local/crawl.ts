/**
 * Local CLI to try the crawler out without Google Apps Script.
 *
 * Usage (via nub):
 *   nub run crawl                       # all participants, all rounds (cached)
 *   nub run crawl -- --no-cache         # force live fetches
 *   nub run crawl -- --participant David --round 41
 *
 * It prints, per participant, the cumulative-score curve to stdout. With a real
 * BASE_URL configured this also populates the local HTML cache used by tests.
 */
import { PARTICIPANTS, roundName, ROUNDS } from "../core/config.ts";
import { parseConfrontations } from "../core/parser.ts";
import { buildCumulative } from "../core/transform.ts";
import { fetchBetPage } from "./fetcher.ts";

function parseArgs(argv: string[]) {
  const args = { useCache: true, participant: "", round: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-cache") args.useCache = false;
    else if (a === "--participant") args.participant = argv[++i] ?? "";
    else if (a === "--round") args.round = Number(argv[++i] ?? 0);
  }
  return args;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const participants = opts.participant
    ? PARTICIPANTS.filter((p) => p.name === opts.participant)
    : PARTICIPANTS;
  const rounds = opts.round ? ROUNDS.filter((r) => r.id === opts.round) : ROUNDS;

  for (const participant of participants) {
    const confrontations = [];
    for (const round of rounds) {
      try {
        // Sequential on purpose: keeps cache writes simple and avoids hammering
        // the site. This is a dev CLI, not a hot path.
        // oxlint-disable-next-line no-await-in-loop
        const html = await fetchBetPage(participant.id, round.id, {
          useCache: opts.useCache,
        });
        confrontations.push(...parseConfrontations(html));
      } catch (err) {
        console.warn(`! ${participant.name} round ${round.id}: ${(err as Error).message}`);
      }
    }

    const curve = buildCumulative(confrontations);
    console.log(`flushing ${curve.length} point(s) for ${participant.name}`);
    console.log(`\n=== ${participant.name} (${participant.id}) ===`);
    for (const point of curve) {
      console.log(
        `${point.eventDate}  ${roundName(point.round)}  ` +
          `${point.homeTeam} vs ${point.awayTeam}  ` +
          `+${point.points} -> ${point.cumulative}`,
      );
    }
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
