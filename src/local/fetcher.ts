import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { buildBetUrl } from "../core/config.ts";
import { parseOrThrow } from "../core/validate.ts";

/** A betting page must be a non-empty HTML document. */
const HtmlSchema = Type.String({ minLength: 1 });

/** Repo root (this file lives at <root>/src/local/fetcher.ts). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where cached HTML pages are stored locally (git-ignored). */
export const CACHE_DIR = join(ROOT, "cache");

/** Deterministic cache path for a (participant, round) page. */
export function cachePath(participantId: string, roundId: number): string {
  return join(CACHE_DIR, `${participantId}-${roundId}.html`);
}

export interface FetchOptions {
  /**
   * When true (default) a cached file is used if present, and freshly fetched
   * pages are written to the cache. Tests rely on this so they never hit the
   * network. Set false to force a live fetch.
   */
  useCache?: boolean;
}

/**
 * Fetch a single betting page for (participant, round), transparently caching
 * the HTML to disk so repeated runs / tests stay offline.
 */
export async function fetchBetPage(
  participantId: string,
  roundId: number,
  options: FetchOptions = {},
): Promise<string> {
  const useCache = options.useCache ?? true;
  const path = cachePath(participantId, roundId);

  if (useCache && existsSync(path)) {
    return parseOrThrow(HtmlSchema, readFileSync(path, "utf8"), `cache ${path}`);
  }

  const url = buildBetUrl(participantId, roundId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${res.status}`);
  }
  const html = parseOrThrow(HtmlSchema, await res.text(), `fetch ${url}`);

  if (useCache) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(path, html, "utf8");
  }
  return html;
}
