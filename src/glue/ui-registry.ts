/**
 * glue/ui-registry — the ONLY place that imports the UI screens of workstreams
 * J and K, so a missing/renamed screen breaks this file and nothing else.
 * Owner: workstream I (glue).
 *
 * CONTRACT with the screens: `glue/ui-resolvers.ts` builds, per module, the
 * exact props object the screen declares (see `loadScreen` there):
 *   issuePanel       `{ panel, zones, now, data, actions }`
 *   map              `{ data: WorksiteMapData, now, actions }`
 *   sprintCheck      `{ data: SprintCheckData, actions }`
 *   gadget           `{ stats, data, actions }`
 *   projectSettings  `{ repos, zones, rules, hooksFile, ciSnippets, data, actions }`
 *   personalSettings `{ myWorksites, mySessions, tokens, newToken?, now, data, actions }`
 *   simulation       `{ scenarios, result?, data, actions }`
 * `actions` is `UiActions` (glue/ui-resolvers): every side effect a screen may
 * trigger. Screens cannot import `@forge/*` (docs/CONTRACTS.md rule 4), so
 * identity, stores and services all stay behind that prop.
 *
 * The component is looked up by name, then by `default`, then by "the first
 * function the module exports": the registry keeps working if a screen is
 * exported under another name.
 */

import ForgeUI, { Text } from "@forge/ui";
import * as gadgetUi from "../ui/gadget";
import * as issuePanelUi from "../ui/issuePanel";
import * as personalSettingsUi from "../ui/personalSettings";
import * as projectSettingsUi from "../ui/projectSettings";
import * as simulationUi from "../ui/simulation";
import * as sprintCheckUi from "../ui/sprintCheck";
import * as worksiteMapUi from "../ui/worksiteMap";
import type { UiModule } from "./ui-resolvers";

/** Opaque UI kit element (`ForgeElement`; same idea as src/ui/jsx-shim.d.ts). */
export type UiElement = ReturnType<typeof Text>;
export type UiComponent = (props: Record<string, unknown>) => UiElement;

function pick(module: unknown, names: string[]): UiComponent | undefined {
  const bag = module as Record<string, unknown>;
  for (const name of [...names, "default"]) {
    const value = bag[name];
    if (typeof value === "function") return value as unknown as UiComponent;
  }
  const fallback = Object.values(bag).find((value) => typeof value === "function");
  return fallback as unknown as UiComponent | undefined;
}

const COMPONENTS: Record<UiModule, UiComponent | undefined> = {
  issuePanel: pick(issuePanelUi, ["IssuePanel", "WorksitePanel", "Panel"]),
  map: pick(worksiteMapUi, ["WorksiteMap", "Map"]),
  sprintCheck: pick(sprintCheckUi, ["SprintCheck"]),
  gadget: pick(gadgetUi, ["Gadget", "CollisionGadget", "CollisionStats"]),
  projectSettings: pick(projectSettingsUi, ["ProjectSettings", "Settings"]),
  personalSettings: pick(personalSettingsUi, ["PersonalSettings", "Settings"]),
  simulation: pick(simulationUi, ["SimulationConsole", "Simulation"]),
};

/** The screen component of a module, or undefined while J/K are landing. */
export function componentFor(module: UiModule): UiComponent | undefined {
  return COMPONENTS[module];
}

/** Build a screen element; undefined when the screen is not available yet. */
export function screenFor(module: UiModule, props: Record<string, unknown>): UiElement | undefined {
  const component = componentFor(module);
  if (component === undefined) return undefined;
  return ForgeUI.createElement(component, props);
}
