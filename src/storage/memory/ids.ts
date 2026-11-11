/**
 * storage/memory/ids — opaque id generator.
 *
 * One counter per bundle, shared by every store: ids are unique inside a
 * bundle and keep a readable prefix ("repo-1", "zone-2", "ws-3"...).
 * Nothing outside the app may parse them (spec: ids are opaque).
 */

export type IdGen = (prefix: string) => string;

export function createIdGen(): IdGen {
  let counter = 0;
  return (prefix: string): string => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}
