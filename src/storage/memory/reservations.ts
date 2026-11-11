/**
 * storage/memory/reservations — ReservationStore.
 *
 * Active = not released AND expiresAt > now (spec §9.3). Overlap is decided
 * through `core/paths.entriesOverlap`: a reservation pattern is a glob when it
 * contains "*" or "?", otherwise a plain path classified as file/dir.
 */

import type { PathKind, Reservation } from "../../core/types";
import { classifyPath, entriesOverlap } from "../../core/paths";
import type { ReservationStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";

const isActive = (r: Reservation, now: string): boolean => !r.releasedAt && r.expiresAt > now;

/** A reservation pattern is a glob as soon as it carries a wildcard. */
function patternKind(pattern: string): PathKind {
  return pattern.includes("*") || pattern.includes("?") ? "pattern" : classifyPath(pattern);
}

function overlapsAny(reservation: Reservation, paths: string[]): boolean {
  return reservation.patterns.some((pattern) =>
    paths.some((path) => entriesOverlap(pattern, patternKind(pattern), path, classifyPath(path))),
  );
}

function activeReservations(
  data: MemoryData,
  keep: (r: Reservation) => boolean,
  now: string,
): Reservation[] {
  const out: Reservation[] = [];
  for (const r of data.reservations.values()) {
    if (isActive(r, now) && keep(r)) out.push(clone(r));
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function createReservation(
  data: MemoryData,
  ids: IdGen,
  r: Omit<Reservation, "id"> & { id?: string },
): Promise<Reservation> {
  const stored: Reservation = { ...clone(r), id: r.id || ids("res") };
  data.reservations.set(stored.id, stored);
  return clone(stored);
}

async function findReservationById(data: MemoryData, id: string): Promise<Reservation | undefined> {
  const r = data.reservations.get(id);
  return r ? clone(r) : undefined;
}

async function listActiveReservations(
  data: MemoryData,
  repoId: string,
  now: string,
): Promise<Reservation[]> {
  return activeReservations(data, (r) => r.repoId === repoId, now);
}

async function findActiveOverlappingReservations(
  data: MemoryData,
  repoId: string,
  paths: string[],
  now: string,
): Promise<Reservation[]> {
  return activeReservations(data, (r) => r.repoId === repoId && overlapsAny(r, paths), now);
}

async function listReservationsByWorksite(
  data: MemoryData,
  worksiteId: string,
  now: string,
): Promise<Reservation[]> {
  return activeReservations(data, (r) => r.worksiteId === worksiteId, now);
}

async function releaseReservation(data: MemoryData, id: string, now: string): Promise<boolean> {
  const known = data.reservations.get(id);
  if (!known) return false;
  data.reservations.set(id, { ...known, releasedAt: known.releasedAt ?? now });
  return true;
}

async function releaseExpiredReservations(data: MemoryData, now: string): Promise<Reservation[]> {
  const released: Reservation[] = [];
  for (const [id, r] of [...data.reservations.entries()]) {
    if (r.releasedAt || r.expiresAt > now) continue;
    const stored: Reservation = { ...r, releasedAt: now };
    data.reservations.set(id, stored);
    released.push(clone(stored));
  }
  return released;
}

export function createReservationStore(data: MemoryData, ids: IdGen): ReservationStore {
  return {
    create: (r) => createReservation(data, ids, r),
    findById: (id) => findReservationById(data, id),
    listActive: (repoId, now) => listActiveReservations(data, repoId, now),
    findActiveOverlapping: (repoId, paths, now) =>
      findActiveOverlappingReservations(data, repoId, paths, now),
    listByWorksite: (worksiteId, now) => listReservationsByWorksite(data, worksiteId, now),
    release: (id, now) => releaseReservation(data, id, now),
    releaseExpired: (now) => releaseExpiredReservations(data, now),
  };
}
