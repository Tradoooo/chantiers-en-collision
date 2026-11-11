/**
 * services/tokens — personal/project tokens for hook + CI (spec §17).
 * Owner: workstream H. Replace stubs; keep signatures EXACTLY.
 * The clear token is shown ONCE; only the sha256 hash is stored.
 * Project tokens may only send attested footprints (ciFootprint/reportConflict).
 * Use ctx.randomHex / ctx.sha256 when provided (tests), else node:crypto.
 */

import type { HookToken } from "../core/types";
import type { Ctx } from "./ctx";

export interface CreatedToken {
  /** Clear value — shown once, never stored. */
  token: string;
  tokenHash: string;
  scope: "personal" | "project";
}

export async function createToken(
  _ctx: Ctx,
  _scope: "personal" | "project",
): Promise<CreatedToken> {
  throw new Error("TODO(tokens): not implemented — see docs/CONTRACTS.md");
}

export async function verifyToken(_ctx: Ctx, _token: string): Promise<HookToken | undefined> {
  throw new Error("TODO(tokens): not implemented — see docs/CONTRACTS.md");
}
