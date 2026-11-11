/**
 * services/reservations — bounded exclusive reservations (CC-07).
 * Owner: workstream G. Replace stubs; keep signatures EXACTLY.
 * Nothing eternal: default 2 h, max 24 h (core/lifecycle.reservationExpiry);
 * refused with a reason when another active hard reservation overlaps.
 */

import type { ReservationResult } from "../core/types";
import type { Ctx } from "./ctx";

export interface ReserveInput {
  issueKey: string;
  repoSlug: string;
  /** One path per line (patterns allowed). */
  paths: string;
  minutes?: number;
  reason?: string;
  /** Hard: the hook denies edits inside (project hardMode required). */
  hard?: boolean;
}

export async function reserveZone(
  _ctx: Ctx,
  _input: ReserveInput,
): Promise<ReservationResult> {
  throw new Error("TODO(reservations): not implemented — see docs/CONTRACTS.md");
}

export async function releaseReservation(_ctx: Ctx, _id: string): Promise<boolean> {
  throw new Error("TODO(reservations): not implemented — see docs/CONTRACTS.md");
}
