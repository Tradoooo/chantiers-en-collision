/**
 * storage/forge/reservations — ReservationStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts + memory stub docstrings):
 *  - a reservation is ACTIVE while it is not released AND expires_at > now;
 *  - patterns are globs, stored as a JSON array in a TEXT column: overlap
 *    cannot be decided in SQL, so active reservations of the repo are loaded
 *    (bounded by the (repo_id, expires_at) index) and filtered in JS through
 *    core/paths.entriesOverlap;
 *  - `releaseExpired` releases everything expired and returns what it released.
 */

import { classifyPath, entriesOverlap } from "../../core/paths";
import type { Reservation } from "../../core/types";
import type { ReservationStore } from "../interfaces";
import { all, bool, newId, one, optStr, parseJson, run, runText, str, upsert } from "./db";

interface ReservationRow {
  id: string;
  worksite_id: string;
  repo_id: string;
  patterns: string;
  hard: number;
  reason: string;
  created_at: string;
  expires_at: string;
  released_at: string;
}

function toReservation(row: ReservationRow): Reservation {
  const reservation: Reservation = {
    id: str(row.id),
    worksiteId: str(row.worksite_id),
    repoId: str(row.repo_id),
    patterns: parseJson<string[]>(row.patterns, []),
    hard: bool(row.hard),
    createdAt: str(row.created_at),
    expiresAt: str(row.expires_at),
  };
  const reason = optStr(row.reason);
  if (reason) reservation.reason = reason;
  const releasedAt = optStr(row.released_at);
  if (releasedAt) reservation.releasedAt = releasedAt;
  return reservation;
}

/** True while the reservation still holds the paths (not released, not past). */
function isActive(row: ReservationRow, now: string): boolean {
  return str(row.released_at) === "" && str(row.expires_at) > now;
}

async function writeReservation(reservation: Reservation): Promise<void> {
  await upsert(
    "reservation",
    reservation.id,
    [
      "worksite_id",
      "repo_id",
      "patterns",
      "hard",
      "reason",
      "created_at",
      "expires_at",
      "released_at",
    ],
    [
      reservation.worksiteId,
      reservation.repoId,
      JSON.stringify(reservation.patterns),
      reservation.hard ? 1 : 0,
      reservation.reason ?? "",
      reservation.createdAt,
      reservation.expiresAt,
      reservation.releasedAt ?? "",
    ],
  );
}

/** True when any pattern of the reservation covers any of the given paths. */
function overlapsAny(reservation: Reservation, paths: string[]): boolean {
  return reservation.patterns.some((pattern) =>
    paths.some((path) => entriesOverlap(path, classifyPath(path), pattern, "pattern")),
  );
}

async function activeOfRepo(repoId: string, now: string): Promise<Reservation[]> {
  const rows = await all<ReservationRow>`
    SELECT * FROM reservation
    WHERE repo_id = ${repoId} AND released_at = '' AND expires_at > ${now}
    ORDER BY expires_at ASC`;
  return rows.map(toReservation);
}

async function createReservation(
  r: Omit<Reservation, "id"> & { id?: string },
): Promise<Reservation> {
  const reservation: Reservation = { ...r, id: r.id ?? newId("res") };
  await writeReservation(reservation);
  return reservation;
}

async function findReservationById(id: string): Promise<Reservation | undefined> {
  const row = await one<ReservationRow>`SELECT * FROM reservation WHERE id = ${id}`;
  return row ? toReservation(row) : undefined;
}

async function findActiveOverlappingReservations(
  repoId: string,
  paths: string[],
  now: string,
): Promise<Reservation[]> {
  if (paths.length === 0) return [];
  const active = await activeOfRepo(repoId, now);
  return active.filter((reservation) => overlapsAny(reservation, paths));
}

async function listReservationsByWorksite(
  worksiteId: string,
  now: string,
): Promise<Reservation[]> {
  const rows = await all<ReservationRow>`
    SELECT * FROM reservation WHERE worksite_id = ${worksiteId} ORDER BY created_at DESC`;
  return rows.filter((row) => isActive(row, now)).map(toReservation);
}

async function releaseReservation(id: string, now: string): Promise<boolean> {
  const affected = await run`
    UPDATE reservation SET released_at = ${now}
    WHERE id = ${id} AND released_at = ''`;
  return affected > 0;
}

async function releaseExpiredReservations(now: string): Promise<Reservation[]> {
  const rows = await all<ReservationRow>`
    SELECT * FROM reservation WHERE released_at = '' AND expires_at <= ${now}`;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => str(row.id));
  await runText(
    `UPDATE reservation SET released_at = ? WHERE id IN (${ids.map(() => "?").join(", ")})`,
    [now, ...ids],
  );
  return rows.map((row) => ({ ...toReservation(row), releasedAt: now }));
}

export function createReservationStore(): ReservationStore {
  return {
    create: createReservation,
    findById: findReservationById,
    listActive: activeOfRepo,
    findActiveOverlapping: findActiveOverlappingReservations,
    listByWorksite: listReservationsByWorksite,
    release: releaseReservation,
    releaseExpired: releaseExpiredReservations,
  };
}
