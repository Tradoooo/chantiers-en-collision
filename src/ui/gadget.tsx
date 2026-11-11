/**
 * ui/gadget — dashboard gadget: the four numbers of spec §13.
 *
 * How many collisions the app saw before the first line, while the work was
 * going on, at the PR, and missed until the merge — plus the measured
 * prediction accuracy when the CI step has reported at least one merge.
 *
 * Presentational only: `CollisionStats` comes in as a prop.
 */

import ForgeUI, {
  Badge,
  Cell,
  Fragment,
  Head,
  Heading,
  Row,
  SectionMessage,
  Table,
  Text,
} from "@forge/ui";
import type { CollisionStats } from "../core/types";

interface Figure {
  label: string;
  value: number;
}

/** The four counters, in the order of the spec. */
export function figuresOf(stats: CollisionStats): Figure[] {
  return [
    { label: "Seen before the first line", value: stats.seenBeforeCode },
    { label: "Seen while working", value: stats.seenWhileWorking },
    { label: "Seen at the PR", value: stats.seenAtPr },
    { label: "Missed until the merge", value: stats.missedUntilMerge },
  ];
}

function FigureCell(props: { figure: Figure }) {
  return (
    <Cell>
      <Fragment>
        <Heading size="large">{String(props.figure.value)}</Heading>
        <Text>{props.figure.label}</Text>
      </Fragment>
    </Cell>
  );
}

function FigureTable(props: { figures: Figure[] }) {
  return (
    <Table>
      <Head>
        <Cell><Text>when the collision was seen</Text></Cell>
        <Cell><Text>count</Text></Cell>
      </Head>
      {props.figures.map((figure) => (
        <Row>
          <Cell><Text>{figure.label}</Text></Cell>
          <FigureCell figure={figure} />
        </Row>
      ))}
    </Table>
  );
}

/** "1 in 5 was missed" — one sober sentence, no chart. */
export function summaryOf(stats: CollisionStats): string {
  const seen =
    stats.seenBeforeCode + stats.seenWhileWorking + stats.seenAtPr;
  const total = seen + stats.missedUntilMerge;
  if (total === 0) return "No collision recorded on this project yet.";
  return `${seen} of ${total} collisions were seen before the merge.`;
}

function accuracyText(stats: CollisionStats): string | undefined {
  const accuracy = stats.predictionAccuracy;
  if (accuracy === undefined) return undefined;
  return `${Math.round(accuracy * 100)}% of predicted footprints held at merge.`;
}

function AccuracyNote(props: { stats: CollisionStats }) {
  const text = accuracyText(props.stats);
  if (text === undefined) {
    return (
      <SectionMessage appearance="info" title="Prediction accuracy">
        <Text>Not measured yet: no merge has been compared with its prediction.</Text>
      </SectionMessage>
    );
  }
  return (
    <SectionMessage appearance="confirmation" title="Prediction accuracy">
      <Text>{text}</Text>
      <Badge appearance="primary" text={`${Math.round((props.stats.predictionAccuracy ?? 0) * 100)}%`} />
    </SectionMessage>
  );
}

export function Gadget(props: { stats: CollisionStats }) {
  return (
    <Fragment>
      <FigureTable figures={figuresOf(props.stats)} />
      <Text>{summaryOf(props.stats)}</Text>
      <AccuracyNote stats={props.stats} />
    </Fragment>
  );
}
