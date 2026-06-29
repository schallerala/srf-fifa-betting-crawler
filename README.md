# SRG FIFA Betting Crawler

Tracks how each member of our betting group is doing in the SRF *WM-Tippspiel*
(the [wmtippspiel.srf.ch](https://wmtippspiel.srf.ch) FIFA-tournament prediction
game) and charts their **score after every single match** — so you can see each
person's progression as a curve across the whole tournament, not just the final
standings.

It runs as a **Google Apps Script bound to a Google Spreadsheet**: one sheet per
participant, refreshed on demand from a custom menu or on a time-based trigger.

## How it works

The site only renders the current score and exposes no JSON API. But every match
is a React component whose `data-react-props` attribute already holds the full
structured payload (teams, picks, final results, per-bet points). So instead of
scraping rendered HTML, the crawler locates each `data-react-class="ScoreBet"`
node, reads its `data-react-props`, decodes the HTML entities, and `JSON.parse`s
it — robust and locale-independent. HTML parsing uses
[`node-html-parser`](https://www.npmjs.com/package/node-html-parser); every data
boundary is validated with [TypeBox](https://github.com/sinclairzx81/typebox) so
a malformed step fails loudly instead of producing a wrong curve.

Each participant sheet has one row per played match with the date, both teams,
the participant's bet, the actual result, the points scored (and which aspects
were correct), plus a **running cumulative total** — the curve's y-axis.

## Layout

```
src/
  core/   Pure, environment-agnostic parsing/transform logic (bundled into the .gs)
  gas/    Google Apps Script entry points — Sheets + UrlFetchApp + resume state
  local/  Node-only dev CLI + on-disk HTML cache used to populate test fixtures
test/     Snapshot + assertion tests over real captured pages in fixtures/
```

See [`AGENTS.md`](AGENTS.md) for the full architecture, data model, scoring
rules, resume/dedupe logic, and deployment notes.

## Usage

This project uses [**nub**](https://github.com/) as its runtime/script runner.

```
nub install            # install deps
nub run crawl          # local CLI: print each participant's curve
nub run test           # vitest (snapshots + assertions)
nub run typecheck      # tsc --noEmit
nub run lint           # oxlint
nub run fmt            # oxfmt
nub run build          # tsup -> build/main.js (+ appsscript.json)
nub run push           # build, then `clasp push` to the bound Apps Script project
```

After the first `nub run push`, add a time-based trigger on
`updateAllParticipants` for automatic refreshes; the sheet's custom menu
(`onOpen`) lets you run it manually.
