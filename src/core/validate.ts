import type { StaticDecode, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Validate + decode `value` against `schema` using TypeBox's full
 * {@link Value.Parse} pipeline (Clean → Default → Convert → Assert → Decode),
 * throwing a contextual error on the first violation.
 *
 * This is the single choke point we route every data boundary through — fetched
 * HTML, parsed JSON, config, and computed rows — so a malformed step blows up
 * loudly and early instead of silently producing a wrong curve.
 */
export function parseOrThrow<T extends TSchema>(
  schema: T,
  value: unknown,
  context: string,
): StaticDecode<T> {
  try {
    return Value.Parse(schema, value);
  } catch (cause) {
    const first = [...Value.Errors(schema, value)][0];
    const where = first?.path ? ` at "${first.path}"` : "";
    const why = first?.message ?? (cause as Error).message;
    throw new Error(`${context}: invalid${where}: ${why}`, { cause });
  }
}
