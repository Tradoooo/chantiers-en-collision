/**
 * ui/components — shared UI kit building blocks for every screen.
 * Owner: orchestrator. FROZEN: import these, do not modify; if something is
 * missing, define it locally in your screen file and report it.
 *
 * Forge UI kit 1.x: no View/Box — layout via Fragment, Table/Head/Row/Cell,
 * Text, SectionMessage, StatusLozenge, Badge.
 */

import ForgeUI, {
  Badge,
  Fragment,
  Heading,
  Row,
  SectionMessage,
  StatusLozenge,
  Table,
  Cell,
  Head,
  Text,
} from "@forge/ui";
import type {
  Degree,
  FootprintEntry,
  NeighborInfo,
  Verdict,
  WorksiteState,
} from "../core/types";
import { minutesBetween } from "../testing/clock";

/* ------------------------------------------------------------------ */

const DEGREE_APPEARANCE: Record<Degree, "default" | "inprogress" | "new" | "removed"> = {
  0: "default",
  1: "default",
  2: "inprogress",
  3: "new",
  4: "removed",
  5: "removed",
};

export function DegreeLozenge(props: { degree?: Degree }) {
  if (props.degree === undefined) return <Badge text="—" appearance="default" />;
  return (
    <StatusLozenge
      appearance={DEGREE_APPEARANCE[props.degree]}
      text={`D${props.degree}`}
    />
  );
}

/* ------------------------------------------------------------------ */

const STATE_APPEARANCE: Record<
  WorksiteState,
  "default" | "inprogress" | "success" | "new" | "removed" | "moved"
> = {
  planned: "default",
  open: "inprogress",
  active: "inprogress",
  paused: "moved",
  review: "new",
  dormant: "default",
  closed: "success",
};

export function StateLozenge(props: { state: WorksiteState }) {
  return <StatusLozenge appearance={STATE_APPEARANCE[props.state]} text={props.state} />;
}

/* ------------------------------------------------------------------ */

export function FootprintTable(props: { entries: FootprintEntry[] }) {
  return (
    <Table>
      <Head>
        <Cell>
          <Text>path</Text>
        </Cell>
        <Cell>
          <Text>kind</Text>
        </Cell>
        <Cell>
          <Text>source</Text>
        </Cell>
        <Cell>
          <Text>mode</Text>
        </Cell>
        <Cell>
          <Text>gap</Text>
        </Cell>
      </Head>
      {props.entries.map((e) => (
        <Row>
          <Cell>
            <Text>{e.path}</Text>
          </Cell>
          <Cell>
            <Text>{e.kind}</Text>
          </Cell>
          <Cell>
            <Badge text={e.source} appearance="default" />
          </Cell>
          <Cell>
            <Text>{e.mode}</Text>
          </Cell>
          <Cell>
            <Text>{e.declaredMismatch ? "⚠" : ""}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */

export function NeighborList(props: { neighbors: NeighborInfo[]; now: string }) {
  if (props.neighbors.length === 0) {
    return <Text>No neighbour on this ground right now.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>ticket</Text>
        </Cell>
        <Cell>
          <Text>actor</Text>
        </Cell>
        <Cell>
          <Text>state</Text>
        </Cell>
        <Cell>
          <Text>last activity</Text>
        </Cell>
        <Cell>
          <Text>branch</Text>
        </Cell>
      </Head>
      {props.neighbors.map((n) => (
        <Row>
          <Cell>
            <Text>{n.issueKey}</Text>
          </Cell>
          <Cell>
            <Text>{n.actorLabel}</Text>
          </Cell>
          <Cell>
            <StateLozenge state={n.state} />
          </Cell>
          <Cell>
            <Text>{minutesBetween(n.lastActivityAt, props.now)} min ago</Text>
          </Cell>
          <Cell>
            <Text>{n.branch ?? "—"}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */

const VERDICT_APPEARANCE: Record<
  Verdict["kind"],
  "info" | "warning" | "error" | "confirmation"
> = {
  free: "confirmation",
  caution: "info",
  wait: "warning",
  stop: "error",
};

export function VerdictBlock(props: { verdict: Verdict }) {
  return (
    <SectionMessage appearance={VERDICT_APPEARANCE[props.verdict.kind]} title={props.verdict.kind.toUpperCase()}>
      <Text>{props.verdict.text}</Text>
    </SectionMessage>
  );
}

/* ------------------------------------------------------------------ */

export function SectionCard(props: { title: string; children?: unknown }) {
  return (
    <Fragment>
      <Heading size="medium">{props.title}</Heading>
      {props.children as never}
    </Fragment>
  );
}
