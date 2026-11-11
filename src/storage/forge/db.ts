/**
 * storage/forge/db — the single gateway to "@forge/sql".
 *
 * The installed SDK (@forge/sql 4.x) exposes `sql` as a `SqlClient`:
 *   sql.prepare(query).bindParams(...values).execute()
 * There is NO tagged template in the package. To keep the stores readable
 * AND safe, this module provides our own tagged template: every `${...}`
 * interpolation becomes a bound `?` parameter — never a concatenated
 * string, never a raw value in the SQL text.
 *
 *   const rows = await all<FootprintRow>`
 *     SELECT * FROM footprint WHERE repo_id = ${repoId} AND path = ${path}`;
 *
 * Table/column names interpolated in `upsert()` come from internal
 * constants only (never from user input).
 */

import { sql } from "@forge/sql";
import type { UpdateQueryResponse } from "@forge/sql";

export type SqlScalar = string | number | boolean | null;
export type SqlParam = SqlScalar | string[] | number[];

export interface BuiltQuery {
  text: string;
  params: SqlScalar[];
}

/* ------------------------------------------------------------------ */
/* Query building                                                      */
/* ------------------------------------------------------------------ */

/** Turn a tagged template into SQL text + bound parameters. */
export function buildQuery(strings: TemplateStringsArray, values: SqlParam[]): BuiltQuery {
  const params: SqlScalar[] = [];
  let text = "";
  strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= values.length) return;
    const value = values[index];
    if (Array.isArray(value)) {
      const items = value as Array<string | number>;
      if (items.length === 0) {
        text += "(NULL)"; // never emit "IN ()" — matches nothing
        return;
      }
      text += items.map(() => "?").join(", ");
      items.forEach((item) => params.push(item));
      return;
    }
    text += "?";
    params.push(scalar(value));
  });
  return { text, params };
}

/** Booleans are stored as 0/1, `undefined` as NULL. */
function scalar(value: SqlParam): SqlScalar {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return null; // defensive: arrays are expanded in buildQuery
  return value;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

/** Run a SELECT with explicit text + parameters. */
export async function allText<T>(text: string, params: SqlScalar[]): Promise<T[]> {
  const result = await sql.prepare<T>(text).bindParams(...params).execute();
  const rows: unknown = result.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Run a SELECT written as a tagged template. */
export async function all<T>(strings: TemplateStringsArray, ...values: SqlParam[]): Promise<T[]> {
  const { text, params } = buildQuery(strings, values);
  return allText<T>(text, params);
}

/** First row of a SELECT, or undefined. */
export async function one<T>(strings: TemplateStringsArray, ...values: SqlParam[]): Promise<T | undefined> {
  const rows = await all<T>(strings, ...values);
  return rows[0];
}

/** Run a write statement, returns the number of affected rows. */
export async function runText(text: string, params: SqlScalar[]): Promise<number> {
  const result = await sql.prepare<UpdateQueryResponse>(text).bindParams(...params).execute();
  const rows: unknown = result.rows;
  const fromRows =
    rows && typeof rows === "object" && !Array.isArray(rows)
      ? (rows as Partial<UpdateQueryResponse>)
      : undefined;
  const metadata = (result.metadata ?? {}) as { affectedRows?: number };
  return fromRows?.affectedRows ?? metadata.affectedRows ?? 0;
}

/** Run a write statement written as a tagged template. */
export async function run(strings: TemplateStringsArray, ...values: SqlParam[]): Promise<number> {
  const { text, params } = buildQuery(strings, values);
  return runText(text, params);
}

/** Run an INSERT, returns the generated id (0 when the API does not give it). */
export async function insert(strings: TemplateStringsArray, ...values: SqlParam[]): Promise<number> {
  const { text, params } = buildQuery(strings, values);
  const result = await sql.prepare<UpdateQueryResponse>(text).bindParams(...params).execute();
  const rows: unknown = result.rows;
  const fromRows =
    rows && typeof rows === "object" && !Array.isArray(rows)
      ? (rows as Partial<UpdateQueryResponse>)
      : undefined;
  const metadata = (result.metadata ?? {}) as { insertId?: number };
  return fromRows?.insertId ?? metadata.insertId ?? 0;
}

/**
 * Insert or update a row keyed by one column.
 * `table`, `keyColumn` and `columns` are internal constant names — never
 * user input; every VALUE goes through a bound parameter.
 */
export async function upsertByKey(
  table: string,
  keyColumn: string,
  keyValue: SqlScalar,
  columns: string[],
  values: SqlScalar[],
): Promise<void> {
  const placeholders = columns.map(() => "?").join(", ");
  const assignments = columns.map((column) => `${column} = VALUES(${column})`).join(", ");
  const text =
    `INSERT INTO ${table} (${keyColumn}, ${columns.join(", ")}) VALUES (?, ${placeholders}) ` +
    `ON DUPLICATE KEY UPDATE ${assignments}`;
  await runText(text, [keyValue, ...values]);
}

/** Insert or update a row keyed by its `id` column. */
export async function upsert(
  table: string,
  id: string,
  columns: string[],
  values: SqlScalar[],
): Promise<void> {
  await upsertByKey(table, "id", id, columns, values);
}

/* ------------------------------------------------------------------ */
/* Row decoding helpers                                                */
/* ------------------------------------------------------------------ */

/** Text column (never null in the domain). */
export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/** Optional text column: "" (or NULL) becomes undefined. */
export function optStr(value: unknown): string | undefined {
  const text = str(value);
  return text === "" ? undefined : text;
}

/** Numeric column. */
export function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Boolean column stored as 0/1. */
export function bool(value: unknown): boolean {
  return num(value) !== 0;
}

/** Serialize a value for a TEXT column holding JSON. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parse a TEXT column holding JSON, falling back when unreadable. */
export function parseJson<T>(value: unknown, fallback: T): T {
  const text = str(value);
  if (text === "") return fallback;
  try {
    const parsed = JSON.parse(text) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Escape the LIKE wildcards of a literal path prefix. */
export function likePrefix(path: string): string {
  return `${path.replace(/[\\%_]/g, (char) => `\\${char}`)}/%`;
}

/** Opaque, unique-ish id (uuid when the runtime provides one). */
export function newId(prefix: string): string {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return `${prefix}_${runtimeCrypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}