import { defineConfig } from "tsup";

/**
 * Bundle the whole Apps Script (core + GAS entry) into a single
 * `build/main.js` for clasp to push.
 *
 * Strategy for a clean Apps Script UI: everything is bundled into an IIFE
 * assigned to a `GAS` global (`globalName`), and a `footer` emits real top-level
 * `function` declarations for *only* the entry points. Apps Script lists
 * statically-declared top-level functions in its "Run" dropdown, so the internal
 * helpers (fetch, parse, store, …) stay hidden inside the closure and only
 * `updateAllParticipants`, `onOpen` and `clearStore` are runnable from the UI.
 */
const ENTRY_POINTS = ["onOpen", "updateAllParticipants", "clearStore"] as const;

/**
 * `node-html-parser`'s `entities` dependency unpacks its lookup tables with
 * `atob` at module-load time, but the Apps Script V8 runtime has no global
 * `atob`. Define a pure-JS one (used only if the host lacks it) so the bundle
 * loads everywhere — Apps Script, Node, the browser.
 */
const ATOB_POLYFILL = `var atob = (typeof globalThis !== "undefined" && typeof globalThis.atob === "function") ? globalThis.atob : function (input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var str = String(input).replace(/=+$/, ""), output = "";
  for (var bc = 0, bs = 0, buffer, i = 0; (buffer = str.charAt(i++)); ) {
    buffer = chars.indexOf(buffer);
    if (buffer === -1) continue;
    bs = bc % 4 ? bs * 64 + buffer : buffer;
    if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  return output;
};`;

export default defineConfig({
  entry: { main: "src/gas/main.ts" },
  outDir: "build",
  format: ["iife"],
  globalName: "GAS",
  // Apps Script V8 has no module system and no Node built-ins: bundle every
  // dependency in, target a syntax level it understands, keep UTF-8 (Ägypten…).
  noExternal: [/.*/],
  platform: "browser",
  target: "es2019",
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  // Apps Script's push-time parser rejects async-generator syntax
  // (`async function*`) even though V8 supports it — e.g. TypeBox's dead
  // FromAsyncIterator codegen. Force esbuild to lower it (and for-await, which
  // lowers with it) to plain generators + helpers, regardless of `target`.
  esbuildOptions(options) {
    options.supported = {
      ...options.supported,
      "async-generator": false,
      "for-await": false,
    };
  },
  // Force `build/main.js` (tsup would otherwise name iife output `main.global.js`).
  outExtension: () => ({ js: ".js" }),
  banner: { js: ATOB_POLYFILL },
  footer: {
    js: ENTRY_POINTS.map(
      (name) => `function ${name}(e) { return GAS.${name}(e); }`,
    ).join("\n"),
  },
});
