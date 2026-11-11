/**
 * ui/projectSettings — screen 4 "project settings" (spec §16.4).
 *
 * Presentational only: repos, zones, passage rules, hook file and CI
 * snippets arrive as typed props; interactions are published as action
 * messages (see useActionBridge below). Owner: workstream K.
 */

import ForgeUI, {
  Badge,
  Cell,
  Code,
  Fragment,
  Form,
  Head,
  Heading,
  Option,
  Row,
  Select,
  Tab,
  Tabs,
  Table,
  Text,
  TextArea,
  TextField,
  Toggle,
  useAction,
} from "@forge/ui";
import type { ActionRouter } from "./issuePanel";
import type {
  PriorityCriterion,
  PriorityRules,
  RepoRecord,
  Zone,
  ZoneNature,
} from "../core/types";
import { SectionCard } from "./components";

/* ------------------------------------------------------------------ */
/* Action bridge                                                       */
/* ------------------------------------------------------------------ */

/**
 * GAP REPORT: the installed @forge/ui 1.11.4 types `useAction` as a
 * stateful hook `(updater, initialValue)` — there is no string-key
 * overload in its d.ts. The screens stay presentational by publishing
 * every interaction as `{ key, payload }` through the single action
 * channel; the glue (workstream I, `src/index.ts`) routes each message
 * by `key` to the matching service.
 *
 * Keys used by workstream K screens:
 * - "settings.saveZone"  — payload: zone form (name, nature, patterns,
 *                          frozenFrom?, frozenTo?)
 * - "settings.saveRules" — payload: rules form (order, agentYields,
 *                          hardMode, dormancyHours)
 * - "tokens.generate"    — payload: none
 * - "tokens.revoke"      — payload: { tokenHash } (full hash)
 */
export type ActionKey =
  | "settings.saveZone"
  | "settings.saveRules"
  | "tokens.generate"
  | "tokens.revoke";

export interface ActionMessage {
  key: ActionKey;
  payload?: Record<string, unknown>;
}

export type ActionSender = (key: ActionKey, payload?: Record<string, unknown>) => void;

export function useActionBridge(router?: ActionRouter): ActionSender {
  const [, dispatch] = useAction<ActionMessage | null, ActionMessage>(
    async (_previous, next) => {
      if (router !== undefined && next !== null) {
        await router.route(next.key, next.payload);
      }
      return next;
    },
    null,
  );
  return (key, payload) => dispatch({ key, payload });
}

/* ------------------------------------------------------------------ */
/* Tab (a) — repositories                                              */
/* ------------------------------------------------------------------ */

function ReposTab(props: { repos: RepoRecord[] }) {
  if (props.repos.length === 0) {
    return <Text>No repository registered yet.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>slug</Text>
        </Cell>
        <Cell>
          <Text>provider</Text>
        </Cell>
        <Cell>
          <Text>default branch</Text>
        </Cell>
      </Head>
      {props.repos.map((repo) => (
        <Row>
          <Cell>
            <Text>{repo.slug}</Text>
          </Cell>
          <Cell>
            <Badge text={repo.provider} appearance="default" />
          </Cell>
          <Cell>
            <Text>{repo.defaultBranch}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Tab (b) — zones                                                     */
/* ------------------------------------------------------------------ */

const NATURE_OPTIONS: ZoneNature[] = [
  "ordinary",
  "exclusive",
  "hotspot",
  "frozen",
  "out-of-scope",
];

type ZoneForm = {
  name: string;
  nature: string;
  patterns: string;
  frozenFrom?: string;
  frozenTo?: string;
};

function ZonesTable(props: { zones: Zone[] }) {
  if (props.zones.length === 0) {
    return <Text>No zone defined — the default catalogue applies.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>name</Text>
        </Cell>
        <Cell>
          <Text>nature</Text>
        </Cell>
        <Cell>
          <Text>patterns</Text>
        </Cell>
        <Cell>
          <Text>frozen</Text>
        </Cell>
      </Head>
      {props.zones.map((zone) => (
        <Row>
          <Cell>
            <Text>{zone.name}</Text>
          </Cell>
          <Cell>
            <Badge text={zone.nature} appearance="important" />
          </Cell>
          <Cell>
            <Text>{zone.patterns.join(", ")}</Text>
          </Cell>
          <Cell>
            <Text>
              {zone.frozenFrom && zone.frozenTo
                ? `${zone.frozenFrom} → ${zone.frozenTo}`
                : "—"}
            </Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function ZonesTab(props: { zones: Zone[]; send: ActionSender }) {
  return (
    <Fragment>
      <ZonesTable zones={props.zones} />
      <Heading size="small">Add a zone</Heading>
      <Form<ZoneForm>
        submitButtonText="Add zone"
        onSubmit={(data) => props.send("settings.saveZone", data)}
      >
        <TextField name="name" label="Name" isRequired />
        <Select name="nature" label="Nature" isRequired>
          {NATURE_OPTIONS.map((nature, index) => (
            <Option
              label={nature}
              value={nature}
              defaultSelected={index === 0}
            />
          ))}
        </Select>
        <TextArea
          name="patterns"
          label="Patterns"
          description="One glob pattern per line."
          isRequired
        />
        <TextField
          name="frozenFrom"
          label="Frozen from (ISO date, optional)"
          placeholder="2026-11-24"
        />
        <TextField
          name="frozenTo"
          label="Frozen to (ISO date, optional)"
          placeholder="2026-11-26"
        />
      </Form>
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* Tab (c) — passage rules                                             */
/* ------------------------------------------------------------------ */

const CRITERION_HINT: PriorityCriterion[] = [
  "reservation",
  "incident",
  "priority",
  "due",
  "advance",
  "first",
];

type RulesForm = {
  order: string;
  agentYields: boolean;
  hardMode: boolean;
  dormancyHours: string;
};

function PassageTab(props: { rules: PriorityRules; send: ActionSender }) {
  return (
    <Form<RulesForm>
      submitButtonText="Save passage rules"
      onSubmit={(data) => props.send("settings.saveRules", data)}
    >
      <TextField
        name="order"
        label="Who yields — ordered criteria"
        description={`Comma-separated, chosen among: ${CRITERION_HINT.join(", ")}.`}
        defaultValue={props.rules.order.join(",")}
        isRequired
      />
      <Toggle
        name="agentYields"
        label="On a tie, the agent yields to the human"
        defaultChecked={props.rules.agentYields}
      />
      <Toggle
        name="hardMode"
        label="Hard mode — D4 in reserved or frozen zones denies the edit"
        defaultChecked={props.rules.hardMode}
      />
      <TextField
        name="dormancyHours"
        label="Dormancy delay (hours)"
        type="number"
        defaultValue={String(props.rules.dormancyHours)}
        isRequired
      />
    </Form>
  );
}

/* ------------------------------------------------------------------ */
/* Tab (d) — hook file & CI snippets                                   */
/* ------------------------------------------------------------------ */

function languageOf(name: string): "json" | "shell" | "text" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".sh")) return "shell";
  // NOTE: CodeLanguages has no "yaml" entry in @forge/ui 1.11.4.
  return "text";
}

function HookCiTab(props: {
  hooksFile: string;
  ciSnippets: { name: string; content: string }[];
}) {
  return (
    <Fragment>
      <SectionCard title="Hook file">
        <Text>
          Install this hook in every agent client: it reports open, touch
          and close events without sending file contents.
        </Text>
        <Code text={props.hooksFile} language="text" showLineNumbers />
      </SectionCard>
      {props.ciSnippets.map((snippet) => (
        <SectionCard title={snippet.name}>
          <Code
            text={snippet.content}
            language={languageOf(snippet.name)}
            showLineNumbers
          />
        </SectionCard>
      ))}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function ProjectSettings(props: {
  repos: RepoRecord[];
  zones: Zone[];
  rules: PriorityRules;
  hooksFile: string;
  ciSnippets: { name: string; content: string }[];
  actions?: ActionRouter;
}) {
  const send = useActionBridge(props.actions);
  return (
    <Fragment>
      <Heading size="large">Project settings</Heading>
      <Tabs>
        <Tab label="Repositories">
          <ReposTab repos={props.repos} />
        </Tab>
        <Tab label="Zones">
          <ZonesTab zones={props.zones} send={send} />
        </Tab>
        <Tab label="Passage">
          <PassageTab rules={props.rules} send={send} />
        </Tab>
        <Tab label="Hook & CI">
          <HookCiTab hooksFile={props.hooksFile} ciSnippets={props.ciSnippets} />
        </Tab>
      </Tabs>
    </Fragment>
  );
}
