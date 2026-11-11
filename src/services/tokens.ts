/**
 * services/tokens — personal/project tokens for the hook + CI (spec §17).
 * The clear token is shown ONCE; only its sha256 hash is stored. Project
 * tokens may only send attested footprints (enforced by the glue).
 */

import { createHash, randomBytes } from "node:crypto";
import type { HookToken } from "../core/types";
import type { Ctx } from "./ctx";

export interface CreatedToken {
  /** Clear value — shown once, never stored. */
  token: string;
  tokenHash: string;
  scope: "personal" | "project";
}

export function hashToken(ctx: Ctx, token: string): string {
  return ctx.sha256
    ? ctx.sha256(token)
    : createHash("sha256").update(token).digest("hex");
}

export async function createToken(
  ctx: Ctx,
  scope: "personal" | "project",
): Promise<CreatedToken> {
  const token = ctx.randomHex ? ctx.randomHex(24) : randomBytes(24).toString("hex");
  const tokenHash = hashToken(ctx, token);
  await ctx.stores.tokens.create({
    accountId: ctx.identity.accountId,
    tokenHash,
    scope,
    projectId: scope === "project" ? ctx.projectId : undefined,
    createdAt: ctx.now(),
  });
  return { token, tokenHash, scope };
}

export async function verifyToken(
  ctx: Ctx,
  token: string,
): Promise<HookToken | undefined> {
  const tokenHash = hashToken(ctx, token);
  const found = await ctx.stores.tokens.findByHash(tokenHash);
  if (found) await ctx.stores.tokens.touchLastUsed(tokenHash, ctx.now());
  return found;
}
