# AGENTS.md — SRG FIFA Betting Crawler

Guidance for future sessions (human or AI) working in this repo.

## What this is

A crawler that extracts each group member's **betting score after every game**
of an ongoing FIFA competition, so the progression can be charted as **curves**
across the whole tournament.

It is designed to run as a **Google Apps Script bound to a Google Spreadsheet**:
one sheet per participant, created on demand, refreshed on each run (manually
from a custom menu, or on a time-based trigger).

### Why we parse HTML

The site only renders the final/current score, and inspecting its network panel
revealed no useful JSON endpoint. However, each match is rendered by a React
component whose **`data-react-props` attribute already contains the full
structured payload** (teams, picks, final results, per-bet points and a score
breakdown). So we don't scrape rendered `<div>`s — we locate every
`data-react-class="ScoreBet"` node, read its `data-react-props`, decode the HTML
entities (`&quot;` → `"`), and `JSON.parse` it. This is far more robust than
DOM scraping and locale-independent.

We use **`node-html-parser`** for node location (NOT cheerio). It is pure JS and
decodes attribute entities on `getAttribute`, with a defensive `decodeEntities`
fallback in the parser for safety.

## Architecture

Strict separation so the logic stays unit-testable off-platform:

```
src/
  core/            Pure, environment-agnostic. No GAS or Node APIs. Bundled into the .gs.
    types.ts       TypeBox schemas: Bet / ScoreBetProps (raw) + ConfrontationScore (normalized).
    config.ts      PARTICIPANTS, ROUNDS, BASE_URL, buildBetUrl(). Validated at module load.
    parser.ts      HTML -> ScoreBet props -> normalized ConfrontationScore rows.
    teams.ts       German -> English country-name map + translateTeamName().
    transform.ts   Cumulative totals, sheet rows, and planSheetAppend() (incremental plan).
    validate.ts    parseOrThrow(): the single TypeBox Value.Parse choke point.
    index.ts       Barrel export of the core surface.
  gas/             Google Apps Script only. The ONLY place GAS globals are used.
    main.ts        Entry points: updateAllParticipants(), onOpen(), clearStore(). Sheets + UrlFetchApp.
    store.ts       Typed per-participant resume state over DocumentProperties (no game data).
  local/           Local-only (Node). Used for development + to populate the test cache.
    fetcher.ts     fetchBetPage() with on-disk HTML caching in cache/.
    crawl.ts       CLI: `nub run crawl` — prints each participant's curve.
test/
  parser.test.ts   Snapshot + concrete + per-participant group-stage tests.
  fixtures/         Captured HTML (DO NOT reformat — see .prettierignore).
    pages/          Real per-participant pages (<id>-<round>.html) for snapshots.
  __snapshots__/    Vitest-owned snapshots.
cache/             Git-ignored cached HTML pages (clean with `nub run clean:cache`).
```

## Validate everything with TypeBox

Every data boundary is routed through `parseOrThrow(schema, value, context)`
(which wraps **`Value.Parse`** — Clean → Default → Convert → Assert → Decode) so
a malformed step **breaks early and loudly** instead of silently producing a
wrong curve. This covers:

- raw `data-react-props` JSON (`ScoreBetPropsSchema`),
- the normalized rows we emit (`ConfrontationScoreSchema`, `CumulativePointSchema`),
- the fetched HTML body (must be a non-empty string),
- the static config (`PARTICIPANTS`, `ROUNDS`) at module load,
- `buildBetUrl` arguments (`FetchTargetSchema`),
- the rendered sheet cells (`SheetRowsSchema`),
- and **everything read from / written to** `DocumentProperties` (`CachedRoundSchema`).

When adding a new step, add a schema and run its input/output through
`parseOrThrow`.

## Data model & scoring

Raw `bet.scores` is `{ winner, home, away, difference }`; each non-zero
component means that aspect was predicted correctly. We flatten each bet into a
`ConfrontationScore` and the participant sheet has these columns:

| Column | Source |
| --- | --- |
| Date | `event_date` (rows ordered by it) |
| Home | `teams[0].name`, translated DE→EN |
| Away | `teams[1].name`, translated DE→EN |
| Bet Home | `picks[0]` (participant's prediction) |
| Bet Away | `picks[1]` |
| Final Home | `final_results[0]` (actual result) |
| Final Away | `final_results[1]` |
| Points | `total_score` |
| Correct Winner | `scores.winner > 0` (worth 5 pts) |
| Correct Home Score | `scores.home > 0` |
| Correct Away Score | `scores.away > 0` |
| Correct Diff + Winner | `scores.difference > 0` |
| **Cumulative** | running sum of Points (the curve's y-axis) |

Decisions worth knowing (revisit if wrong):
- **Only played (scored) matches are written to the sheet.** In Apps Script,
  `planSheetAppend` appends played games and stops at the first unplayed one. The
  local CLI uses `buildCumulative` + `toSheetRows`, which filter to scored rows
  (cumulative still carried across unplayed games, so the totals match).
- The **bet** (`Bet Home`/`Bet Away`, from `picks`) and the **actual result**
  (`Final Home`/`Final Away`, from `final_results`) are kept as distinct columns
  and distinct fields on `ConfrontationScore` (`pickHome`/`pickAway` vs
  `homeScore`/`awayScore`).
- **Cumulative** is appended because the whole point is the curve "score after
  every game".
- The round/stage is intentionally **not** a sheet column (kept internally for
  cumulative grouping). Add one if charting by stage becomes useful.
- **Team names are translated German→English** in `toConfrontationScore` via
  `teams.ts` (`COUNTRY_NAMES_DE_EN`, 48 entries). Unknown names pass through
  unchanged; a test (`has an English translation for every country…`) fails if a
  new team appears that isn't mapped — add it to keep the sheet fully English.

### Hidden / future games

Not-yet-played games are **censored** by the site: `event_state` is `"open"`,
`picks` is an empty array `[]`, and there is **no** `final_results`/`scores`
key at all. To tolerate this, the raw schema is deliberately lenient — a
pick/result entry is `number | string | null` (`GoalEntrySchema`) inside an
array of any length (`ScoreListSchema`). The parser's `numericPair()` helper
coerces anything non-numeric (missing, empty, `"?"`/null) to `null`, so such a
bet normalizes to unknown pick/scores with `scored: false` — and is therefore
excluded from the sheet (only played games are written).

## Participants & rounds

Participants (`src/core/config.ts`) — by site id:
`n9KVw` Alain (the current user; public, no auth needed) · `3MOax` David ·
`OXz9` Andreas · `GO6Z3` Caroline · `BrMV2` Philipp · `74J9M` Yves ·
`Lnbgz` Bib Bibsen · `Vr5X3` Sibylle.

Rounds (ids): 41/42/43 Group stage games 1–3 · 44 KO 1/16 · 45 KO 1/8 ·
46 KO 1/4 · 47 Semifinals · 48 3rd place final · 49 Final.

URL shape (`BASE_URL` + `buildBetUrl`): `https://wmtippspiel.srf.ch/users/<id>/round/<roundId>`.
A group-stage round page lists 24 confrontations (the full match-day).

## Caching

- **Local (tests/dev):** `fetchBetPage` writes each page to
  `cache/<participantId>-<roundId>.html` and reuses it, so tests never hit the
  network. Clear with `nub run clean:cache` (plain `rm`, no extra deps).
- **Apps Script (between runs):** the cache is a tiny **per-participant resume
  pointer**, never game data — confrontations live only in the sheet. `store.ts`
  keeps `ParticipantState { lastWrittenEventDate, resumeRound }` in
  `DocumentProperties` (key `state:<id>`). `clearStore()` wipes it.

  Each run (`updateParticipant`):
  1. Fetch rounds from `resumeRound` onward, **stopping after the first round that
     still has an unplayed game** (`fetchUntilIncomplete`) — finished rounds before
     `resumeRound` are never re-fetched.
  2. `planSheetAppend` (pure, in core) walks games in date order, **appends each
     played game newer than `lastWrittenEventDate`**, advances through complete
     rounds, and **stops at the first unplayed game** — that game's round becomes
     the new `resumeRound`. Games sharing a kickoff with the first unplayed one are
     held back so a simultaneous pair is never split across runs.
  3. New rows are appended to the sheet (cumulative continues from the sheet's last
     row); state is saved.

  `lastWrittenEventDate` is the **kickoff of the last game written**, not wall-clock
  — so a result posted hours after kickoff is still picked up (a wall-clock
  watermark would skip it). The tricky resume/dedupe logic is unit-tested in
  `test/transform.test.ts`.

  > Migration: the old scheme stored confrontations under `round:<id>:<round>` keys.
  > After deploying this version, run `clearStore()` once to drop the dead keys.

## Tooling & scripts

Runtime/dev: **nub** (Node-based; drop-in for bun-style commands), **vitest**,
**TypeScript** (typecheck only), **oxlint**, **oxfmt**, **@sinclair/typebox**,
**node-html-parser**.

```
nub install              # install deps
nub run test             # vitest run (snapshots + assertions)
nub run test:watch       # watch mode
nub run test:update      # update snapshots (-u) after an intended change
nub run typecheck        # tsc --noEmit (strict, noUncheckedIndexedAccess)
nub run lint             # oxlint
nub run fmt              # oxfmt src test  (fixtures/snapshots are .prettierignore'd)
nub run fmt:check        # oxfmt --check
nub run crawl            # local CLI; `-- --no-cache`, `-- --participant David --round 41`
nub run build            # tsup bundle -> build/main.js (+ copies appsscript.json)
nub run push             # build, then `clasp push` to the bound Apps Script project
nub run clean:cache      # rm -f cache/*.html
```

## Testing strategy

- **Fixture** `test/fixtures/round-41-sample.html`: Bet A is captured **verbatim**
  (entity-encoded `&quot;`) to exercise real-world decoding; Bets B/C add a
  partially-correct bet and an unplayed fixture. Do not reformat it.
- **Fixture** `test/fixtures/round-44-future.html`: a hidden/censored future
  game (`event_state` "open", empty `picks`, no results/scores) — guards that
  such bets parse and normalize to unknown/`not scored`.
- **Snapshot tests** guard the full parse + sheet rendering against regressions.
  Run `nub run test:update` when a change is intentional.
- **Per-participant group-stage snapshots**: real pages captured for every
  participant × rounds 41/42/43 are committed under `test/fixtures/pages/`
  (`<id>-<round>.html`) and snapshotted — a solid regression base independent of
  the git-ignored `cache/`. Re-capture with `nub run crawl -- --round <id>` then
  `cp cache/*.html test/fixtures/pages/` and `nub run test:update`.
- **Static-assertion test** (`describe("real captured data")`): concrete asserts
  on David's group-stage-game-1 page (count, total, first match).

## Deployment to Google Apps Script

`tsup` (esbuild) bundles `src/gas/main.ts` + all of core + deps into a single
`build/main.js`, which `clasp` pushes. Commands:

```
nub run build   # tsup -> build/main.js, then copies appsscript.json into build/
nub run push    # nub run build && clasp push
```

How the bundle stays Apps-Script-friendly (`tsup.config.ts`):
- **Single IIFE, only entry points exposed.** Everything is bundled into
  `var GAS = (() => { … })()`; a `footer` emits real top-level `function`
  declarations for *only* `onOpen`, `updateAllParticipants`, `clearStore`. Apps
  Script lists statically-declared top-level functions in its Run dropdown, so
  the internal helpers stay hidden inside the closure. (`main.ts` `export {}`s
  exactly those three.)
- **No modules / Node built-ins:** `format: iife`, `platform: browser`,
  `noExternal: [/.*/]` (bundle every dependency), `target: es2019`.
- **`atob` polyfill banner:** `node-html-parser`'s `entities` dep unpacks tables
  with `atob` at load, which the V8 runtime lacks — the banner defines a pure-JS
  one. (Verified by loading the bundle in a bare JS context.)
- **Async generators lowered:** Apps Script's push-time parser rejects
  `async function*` (e.g. TypeBox's dead `FromAsyncIterator` codegen) with
  `Unexpected token *`, even though runtime V8 supports it. `esbuildOptions` sets
  `supported: { "async-generator": false, "for-await": false }` to lower them to
  plain generators + helpers, regardless of `target`.

Config:
- `appsscript.json` (repo root, copied into `build/`): V8 runtime, `Europe/Zurich`,
  scopes `spreadsheets.currentonly` + `script.external_request` +
  `script.container.ui`.
- `.clasp.json`: real `scriptId` + bound `parentId`, `rootDir: "build"` so clasp
  pushes only the bundle + manifest. `build/` is git-ignored.

After the first push, add a time-based trigger on `updateAllParticipants` for
automatic refreshes; the `onOpen` menu lets you run it from the sheet.

## TODOs

- [X] **BASE_URL + `buildBetUrl` route shape** in `src/core/config.ts` are
      placeholders (`https://example.invalid`). Fill in the real origin/path.
- [X] **The current user's own score** — turned out to be reachable without
      authentication via a normal participant id (`n9KVw` Alain). No special path
      needed; it's just another entry in `PARTICIPANTS`.
- [X] Wire up the **clasp + bundler** build for GAS deployment (`tsup` →
      `build/main.js`, `nub run build` / `nub run push`).
- [X] Once a real page is cached, fill the **static-assertion TODOs** in
      `test/parser.test.ts` and un-skip them.
- [X] Confirm the four correctness booleans map to `scores.{winner,home,away,
      difference} > 0` on real data (now verified across all participants'
      committed group-stage pages in `test/fixtures/pages/`).
