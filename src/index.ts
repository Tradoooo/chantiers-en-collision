/**
 * Entry point — every handler referenced by manifest.yml (`index.<name>`).
 * Owner: workstream I (glue). This is a PLACEHOLDER: replace with the real
 * wiring (Resolver from @forge/resolver, Ctx built by src/forge-context.ts
 * from Forge SQL stores + caller identity + JiraPort over requestJira).
 * Keep the exported names EXACTLY — the manifest and scripts/check-manifest
 * depend on them.
 */

const TODO = new Error("TODO(glue): wire resolvers — see docs/CONTRACTS.md");

export async function main(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function declareFootprint(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function checkZone(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function whoTouches(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function getWorksite(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function predictFootprintTool(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function listCollisions(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function listClearWork(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function planParallelWork(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function reserveZone(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function postNotice(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function resolveCollision(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function closeWorksiteTool(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function reportConflict(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function handleIngest(_req: unknown): Promise<unknown> {
  throw TODO;
}
export async function issueEvents(_event: unknown): Promise<void> {
  throw TODO;
}
export async function sweepFiveMinute(): Promise<void> {
  throw TODO;
}
export async function dailyJobs(): Promise<void> {
  throw TODO;
}
export async function jqlCollidingWork(_payload: unknown): Promise<unknown> {
  throw TODO;
}
export async function jqlCollidesWith(_payload: unknown): Promise<unknown> {
  throw TODO;
}
