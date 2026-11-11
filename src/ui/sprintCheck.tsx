/**
 * ui/sprintCheck — screen 3 "sprint check" (spec §16.3, §12).
 *
 * Presentational only: risky pairs, hinge tickets, suggested order and the
 * announced confidence, all coming from typed props. Owner: workstream K.
 */

import ForgeUI, {
  Cell,
  Fragment,
  Head,
  Heading,
  Row,
  SectionMessage,
  StatusLozenge,
  Table,
  Text,
} from "@forge/ui";
import type { SprintCheckData } from "../core/types";
import { DegreeLozenge } from "./components";

type LozengeAppearance =
  | "default"
  | "inprogress"
  | "moved"
  | "new"
  | "removed"
  | "success";

const CONFIDENCE_APPEARANCE: Record<SprintCheckData["confidence"], LozengeAppearance> = {
  high: "success",
  medium: "moved",
  low: "removed",
};

function RiskyPairsTable(props: { data: SprintCheckData }) {
  if (props.data.riskyPairs.length === 0) {
    return <Text>No risky pair in this sprint — the ground looks clear.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>A</Text>
        </Cell>
        <Cell>
          <Text>B</Text>
        </Cell>
        <Cell>
          <Text>degree</Text>
        </Cell>
        <Cell>
          <Text>path</Text>
        </Cell>
        <Cell>
          <Text>zone</Text>
        </Cell>
      </Head>
      {props.data.riskyPairs.map((pair) => (
        <Row>
          <Cell>
            <Text>{pair.a}</Text>
          </Cell>
          <Cell>
            <Text>{pair.b}</Text>
          </Cell>
          <Cell>
            <DegreeLozenge degree={pair.degree} />
          </Cell>
          <Cell>
            <Text>{pair.path}</Text>
          </Cell>
          <Cell>
            <Text>{pair.zoneName ?? "—"}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function HingesBlock(props: { hinges: string[] }) {
  if (props.hinges.length === 0) {
    return <Text>No hinge ticket in this sprint.</Text>;
  }
  return (
    <SectionMessage
      appearance="warning"
      title="Hinge tickets — run them alone, first"
    >
      {props.hinges.map((issueKey) => (
        <Text>{issueKey}</Text>
      ))}
    </SectionMessage>
  );
}

function SuggestedOrder(props: { order: string[] }) {
  if (props.order.length === 0) {
    return <Text>No order suggested yet.</Text>;
  }
  return (
    <Fragment>
      {props.order.map((issueKey, index) => (
        <Text>{`${index + 1}. ${issueKey}`}</Text>
      ))}
    </Fragment>
  );
}

function TicketsTable(props: { data: SprintCheckData }) {
  return (
    <Table>
      <Head>
        <Cell>
          <Text>ticket</Text>
        </Cell>
        <Cell>
          <Text>summary</Text>
        </Cell>
        <Cell>
          <Text>components</Text>
        </Cell>
        <Cell>
          <Text>footprint paths</Text>
        </Cell>
        <Cell>
          <Text>incident</Text>
        </Cell>
      </Head>
      {props.data.tickets.map((ticket) => (
        <Row>
          <Cell>
            <Text>{ticket.issueKey}</Text>
          </Cell>
          <Cell>
            <Text>{ticket.summary ?? "—"}</Text>
          </Cell>
          <Cell>
            <Text>{ticket.components.length > 0 ? ticket.components.join(", ") : "—"}</Text>
          </Cell>
          <Cell>
            <Text>{String(ticket.entries.length)}</Text>
          </Cell>
          <Cell>
            <Text>{ticket.incident ? "yes" : "no"}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

export function SprintCheck(props: { data: SprintCheckData }) {
  return (
    <Fragment>
      <Heading size="large">Sprint check</Heading>
      <Fragment>
        <Text>Confidence</Text>
        <StatusLozenge
          appearance={CONFIDENCE_APPEARANCE[props.data.confidence]}
          text={props.data.confidence}
        />
        <Text>{props.data.confidenceNote ?? ""}</Text>
      </Fragment>
      <Heading size="medium">Tickets of the sprint</Heading>
      <TicketsTable data={props.data} />
      <Heading size="medium">Risky pairs</Heading>
      <RiskyPairsTable data={props.data} />
      <Heading size="medium">Hinges</Heading>
      <HingesBlock hinges={props.data.hinges} />
      <Heading size="medium">Suggested order</Heading>
      <SuggestedOrder order={props.data.suggestedOrder} />
    </Fragment>
  );
}
