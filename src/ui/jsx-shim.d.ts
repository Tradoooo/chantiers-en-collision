/**
 * JSX support shim for Forge UI kit (server-rendered JSX).
 * tsconfig sets jsxFactory = ForgeUI.createElement (the default export).
 * Owner: orchestrator (frozen).
 */

declare global {
  namespace JSX {
    type Element = ReturnType<typeof import("@forge/ui").default.createElement>;
    interface ElementAttributesProperty {
      props: Record<string, unknown>;
    }
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
  }
}

export {};
