/**
 * A tiny, type-safe key-value store layered on top of
 * `PropertiesService.getDocumentProperties()` — the per-document persistence
 * Apps Script gives us between runs.
 *
 * Every read and write is funneled through TypeBox ({@link parseOrThrow}) so a
 * corrupt or schema-drifted property blows up immediately instead of silently
 * poisoning a participant's curve.
 */
import { type StaticDecode, type TSchema, Type } from "@sinclair/typebox";
import { parseOrThrow } from "../core/validate.ts";

/**
 * The small bit of resume state we keep per participant between runs. We do NOT
 * cache confrontations here — those belong in the sheet. This is purely the
 * "where do I pick up" pointer so finished rounds are never re-fetched.
 */
export const ParticipantStateSchema = Type.Object({
  /**
   * Kickoff time (ISO) of the most recent game already written to the
   * participant's sheet — the dedupe watermark. On the next run, played games at
   * or before it are skipped (already recorded) and later ones are appended.
   * `null` until the first game is written. Keyed on the game's kickoff rather
   * than wall-clock so a result posted hours after kickoff is never missed.
   */
  lastWrittenEventDate: Type.Union([Type.String(), Type.Null()]),
  /**
   * Round to resume crawling from next run: the first round still containing an
   * unplayed game. Every round before it is fully complete and already in the
   * sheet, so we skip fetching them entirely.
   */
  resumeRound: Type.Number(),
});
export type ParticipantState = StaticDecode<typeof ParticipantStateSchema>;

function documentStore(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getDocumentProperties();
}

/** Stable property key for one participant's resume state. */
export function participantKey(participantId: string): string {
  return `state:${participantId}`;
}

/** Read + validate a JSON value, or null if the key is absent. */
export function readValue<T extends TSchema>(schema: T, key: string): StaticDecode<T> | null {
  const raw = documentStore().getProperty(key);
  if (raw == null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`DocumentProperties["${key}"] holds invalid JSON`, { cause });
  }
  return parseOrThrow(schema, json, `DocumentProperties["${key}"]`);
}

/** Validate then persist a JSON value. */
export function writeValue<T extends TSchema>(
  schema: T,
  key: string,
  value: StaticDecode<T>,
): void {
  const validated = parseOrThrow(schema, value, `DocumentProperties["${key}"] (write)`);
  documentStore().setProperty(key, JSON.stringify(validated));
}

/** Wipe all persisted state (handy from the editor when schemas change). */
export function clearStore(): void {
  documentStore().deleteAllProperties();
}
