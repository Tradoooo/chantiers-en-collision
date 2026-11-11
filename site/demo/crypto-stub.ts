/**
 * Browser stub for node:crypto (aliased at bundle time).
 * The demo never creates tokens; if it ever does, fail loudly.
 */

function unavailable(): never {
  throw new Error("node:crypto is not available in the browser demo");
}

export function createHash(): never {
  return unavailable();
}

export function randomBytes(): never {
  return unavailable();
}
