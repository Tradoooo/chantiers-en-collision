/**
 * ui/actions — the bridge from a screen gesture to the Forge resolver.
 * Each user gesture records the exact resolver key plus its payload; when
 * the glue injected its action router (props.actions), the gesture is
 * replayed server-side against the real services (glue/ui-actions).
 * Shared by every screen in src/ui. Owner: orchestrator (frozen).
 */

import { useAction } from "@forge/ui";

/** One call addressed to the Forge resolver. */
export interface ActionRequest {
  /** Resolver key wired in src/index.ts. */
  key: string;
  payload: Record<string, unknown>;
}

/** The router injected by the glue as the `actions` prop of every screen. */
export interface ActionRouter {
  route(key: string, payload?: Record<string, unknown>): Promise<unknown>;
}

export function useActionRequest(router?: ActionRouter) {
  const [, dispatch] = useAction<ActionRequest, ActionRequest>(
    async (_previous, request) => {
      if (router !== undefined && request.key !== "") {
        await router.route(request.key, request.payload);
      }
      return request;
    },
    { key: "", payload: {} },
  );
  return (key: string, payload: Record<string, unknown> = {}): void => {
    dispatch({ key, payload });
  };
}
