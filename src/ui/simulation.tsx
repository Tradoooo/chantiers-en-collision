/**
 * ui/simulation — the simulation console (spec §16.6, CC-15).
 *
 * Pick a scenario, replay it, read the step-by-step verdicts. Presentational
 * only: scenarios and the last result come in as props; the resolver runs the
 * scenario (key below) and re-renders this screen with a fresh `result`.
 */

import ForgeUI, {
  Badge,
  Cell,
  Form,
  Fragment,
  Heading,
  Head,
  Option,
  Row,
  SectionMessage,
  Select,
  Table,
  Text,
} from "@forge/ui";
import type {
  SimulationResult,
  SimulationScenario,
  SimulationStep,
  SimulationStepResult,
} from "../core/types";
import { VerdictBlock } from "./components";
import { useActionRequest, type ActionRouter } from "./issuePanel";

/** Resolver key: run one scenario and return its step results. */
export const ACTION_RUN = "simulation.run";

/* ------------------------------------------------------------------ */

function scenarioFor(
  scenarios: SimulationScenario[],
  result?: SimulationResult,
): SimulationScenario {
  const wanted = result?.scenarioKey;
  return scenarios.find((s) => s.key === wanted) ?? scenarios[0];
}

function expectedText(step: SimulationStep): string {
  const parts: string[] = [];
  if (step.expect?.verdict !== undefined) parts.push(`verdict ${step.expect.verdict}`);
  if (step.expect?.degree !== undefined) parts.push(`degree D${step.expect.degree}`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

/* ------------------------------------------------------------------ */

export function SimulationConsole(props: {
  scenarios: SimulationScenario[];
  result?: SimulationResult;
  actions?: ActionRouter;
}) {
  const call = useActionRequest(props.actions);
  if (props.scenarios.length === 0) {
    return (
      <SectionMessage appearance="info" title="No scenario available">
        <Text>No simulation scenario is registered for this project.</Text>
      </SectionMessage>
    );
  }
  const scenario = scenarioFor(props.scenarios, props.result);
  return (
    <Fragment>
      <Heading size="medium">Simulation console</Heading>
      <Form
        onSubmit={(data) => {
          call(ACTION_RUN, { scenarioKey: String(data.scenario ?? scenario.key) });
        }}
        submitButtonText="Run scenario"
      >
        <Select
          label="Scenario"
          name="scenario"
          description="Replay a make-believe sprint and watch the verdicts."
        >
          {props.scenarios.map((s) => (
            <Option
              label={s.title}
              value={s.key}
              defaultSelected={s.key === scenario.key}
            />
          ))}
        </Select>
      </Form>
      {props.result === undefined ? (
        <ScenarioPreview scenario={scenario} />
      ) : (
        <RunResult result={props.result} scenario={scenario} />
      )}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* Before a run: what the scenario is supposed to do                   */
/* ------------------------------------------------------------------ */

function ScenarioPreview(props: { scenario: SimulationScenario }) {
  const { scenario } = props;
  return (
    <Fragment>
      <Text>{scenario.description ?? "No description for this scenario."}</Text>
      <Text>{`${scenario.actors.length} actor(s) · ${scenario.repos.map((r) => r.slug).join(", ")}`}</Text>
      <Table>
        <Head>
          <Cell><Text>#</Text></Cell>
          <Cell><Text>actor</Text></Cell>
          <Cell><Text>action</Text></Cell>
          <Cell><Text>expected</Text></Cell>
          <Cell><Text>note</Text></Cell>
        </Head>
        {scenario.steps.map((step, index) => (
          <Row>
            <Cell><Text>{String(index + 1)}</Text></Cell>
            <Cell><Text>{step.actor}</Text></Cell>
            <Cell><Text>{step.action}</Text></Cell>
            <Cell><Text>{expectedText(step)}</Text></Cell>
            <Cell><Text>{step.note ?? "—"}</Text></Cell>
          </Row>
        ))}
      </Table>
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* After a run: step-by-step results                                   */
/* ------------------------------------------------------------------ */

function RunResult(props: { result: SimulationResult; scenario: SimulationScenario }) {
  const { result } = props;
  const passed = result.results.filter((r) => r.ok).length;
  return (
    <Fragment>
      <SectionMessage
        appearance={result.allOk ? "confirmation" : "error"}
        title={`${props.scenario.title} — ${passed}/${result.results.length} steps ok`}
      >
        <Text>
          {result.allOk
            ? "Every expected verdict came out as announced."
            : "At least one step did not behave as announced; see the detail column."}
        </Text>
      </SectionMessage>
      <Table>
        <Head>
          <Cell><Text>#</Text></Cell>
          <Cell><Text>actor</Text></Cell>
          <Cell><Text>action</Text></Cell>
          <Cell><Text>note</Text></Cell>
          <Cell><Text>ok</Text></Cell>
          <Cell><Text>detail</Text></Cell>
          <Cell><Text>verdict</Text></Cell>
        </Head>
        {result.results.map((r) => (
          <StepResultRow result={r} />
        ))}
      </Table>
    </Fragment>
  );
}

function StepResultRow(props: { result: SimulationStepResult }) {
  const { result } = props;
  return (
    <Row>
      <Cell><Text>{String(result.index)}</Text></Cell>
      <Cell><Text>{result.step.actor}</Text></Cell>
      <Cell><Text>{result.step.action}</Text></Cell>
      <Cell><Text>{result.step.note ?? "—"}</Text></Cell>
      <Cell><Text>{result.ok ? "✓" : "✗"}</Text></Cell>
      <Cell><Text>{result.detail ?? "—"}</Text></Cell>
      <Cell>
        {result.verdict === undefined ? (
          <Badge appearance="default" text="no verdict" />
        ) : (
          <VerdictBlock verdict={result.verdict} />
        )}
      </Cell>
    </Row>
  );
}
