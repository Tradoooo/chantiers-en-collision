/**
 * services/notices — the worksite mailbox (CC-08, spec §9.4).
 * Owner: workstream G. Replace stubs; keep signatures EXACTLY.
 * Recipients = open worksites of the repo whose footprint overlaps the
 * notice paths (excluding the author's worksite). Delivered ONCE per
 * session, with the next tool response or hook context.
 */

import type { NeighborInfo, Notice } from "../core/types";
import type { Ctx } from "./ctx";

export interface PostNoticeInput {
  issueKey: string;
  /** One path per line. */
  paths: string;
  text: string;
  repoSlug?: string;
}

export async function postNotice(
  _ctx: Ctx,
  _input: PostNoticeInput,
): Promise<{ notice: Notice; recipients: NeighborInfo[] }> {
  throw new Error("TODO(notices): not implemented — see docs/CONTRACTS.md");
}
