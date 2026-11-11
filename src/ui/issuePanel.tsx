/**
 * ui/issuePanel — the "Worksite" ticket panel (spec §16.1).
 *
 * Purely presentational: every datum comes in through props (the resolver
 * builds the `WorksitePanel` and re-renders through `render()`). The only
 * side effect is a resolver call, raised through `useActionRequest()`; the
 * resolver keys used here are listed in ACTION_* constants below.
 */

import ForgeUI, {
  Badge, Button, Cell, Checkbox, CheckboxGroup, Form, Fragment, Head, Heading,
  Option, Row, SectionMessage, Select, Table, Text, TextField, useAction,
} from "@forge/ui";
import type {
  Collision, FootprintCoverage, FootprintEntry, FootprintSource, NeighborInfo,
  Notice, NoticeView, Reservation, ResolutionChoice, Worksite, WorksitePanel,
  Zone, ZoneNature,
} from "../core/types";
import { DegreeLozenge, FootprintTable, NeighborList, SectionCard } from "./components";
import { zoneForPath } from "../core/zones";

/* ------------------------------------------------------------------ */
/* Resolver bridge                                                     */
/* ------------------------------------------------------------------ */

/** Resolver key: resolve one collision (six outcomes, spec §8). */
export const ACTION_RESOLVE = "collisions.resolve";
/** Resolver key: declare that I start working on this ticket. */
export const ACTION_I_WORK_ON_IT = "worksites.iWorkOnIt";

/** One call addressed to the Forge resolver. */
export interface ActionRequest {
  /** Resolver key wired in src/index.ts. */
  key: string;
  payload: Record<string, unknown>;
}

/**
 * Bridge from a screen to the resolver. Each user gesture records the exact
 * resolver key plus its payload; the glue replays that request and hands the
 * fresh data back as props. Shared by every screen in src/ui.
 */
export function useActionRequest() {
  const [, dispatch] = useAction<ActionRequest, ActionRequest>(
    (_previous, request) => request,
    { key: "", payload: {} },
  );
  return (key: string, payload: Record<string, unknown> = {}): void => {
    dispatch({ key, payload });
  };
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const SOURCE_ORDER: FootprintSource[] = ["predicted", "declared", "observed", "attested"];

const QUICK_CHOICES: { choice: ResolutionChoice; label: string }[] = [
  { choice: "wait", label: "Wait" },
  { choice: "sequence", label: "Sequence" },
  { choice: "coordinate", label: "Coordinate" },
  { choice: "split", label: "Split" },
  { choice: "merge", label: "Merge" },
];

/** One repository block of the panel. */
export type RepoPanel = WorksitePanel["repos"][number];

/* ------------------------------------------------------------------ */
/* Panel                                                              */
/* ------------------------------------------------------------------ */

export function IssuePanel(props: { panel: WorksitePanel; zones: Zone[]; now: string }) {
  const { panel } = props;
  if (panel.repos.length === 0) {
    return (
      <SectionMessage appearance="info" title="No worksite yet">
        <Text>
          This ticket has no worksite on any repository. Open a worksite, pick the
          zones you are about to touch, and the app will watch the ground for you.
        </Text>
      </SectionMessage>
    );
  }
  return (
    <Fragment>
      <Heading size="medium">{`Worksite · ${panel.issueKey}`}</Heading>
      {panel.repos.map((block) => (
        <RepoSection
          block={block}
          zones={props.zones}
          now={props.now}
          issueKey={panel.issueKey}
        />
      ))}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* One repository                                                      */
/* ------------------------------------------------------------------ */

function RepoSection(props: {
  block: RepoPanel;
  issueKey: string;
  zones: Zone[];
  now: string;
}) {
  const { block } = props;
  const mine = block.worksites.map((w: Worksite) => w.id);
  return (
    <SectionCard title={block.repo.slug}>
      <Text>{`${block.repo.provider} · default branch ${block.repo.defaultBranch}`}</Text>
      <CoverageLine coverage={block.coverage} />
      <Text>Footprint by source</Text>
      <FootprintBySource footprints={block.footprintsBySource} />
      <Text>Neighbours on this ground</Text>
      <NeighborList neighbors={block.neighbors} now={props.now} />
      <CollisionsBlock
        collisions={block.collisions}
        neighbors={block.neighbors}
        mine={mine}
        zones={props.zones}
      />
      <Text>Notices received</Text>
      <NoticeInbox notices={block.noticesInbox} />
      <Text>Notices sent</Text>
      <NoticeOutbox notices={block.noticesSent} />
      <Text>Reservations</Text>
      <ReservationList reservations={block.reservations} />
      <IWorkOnIt
        issueKey={props.issueKey}
        repoId={block.repo.id}
        zones={props.zones}
        predicted={block.footprintsBySource.predicted ?? []}
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Footprint                                                           */
/* ------------------------------------------------------------------ */

function mismatchCount(entries: FootprintEntry[]): number {
  return entries.filter((e) => e.declaredMismatch === true).length;
}

function MismatchNote(props: { entries: FootprintEntry[] }) {
  const count = mismatchCount(props.entries);
  if (count === 0) return <Text>all declared</Text>;
  return <Badge appearance="important" text={`${count} outside the declaration`} />;
}

function CoverageLine(props: { coverage: FootprintCoverage }) {
  const parts = SOURCE_ORDER.filter((s) => props.coverage[s] !== undefined).map(
    (s) => `${s}: ${props.coverage[s]}`,
  );
  if (parts.length === 0) {
    return <Text>Coverage — nothing declared, nothing observed yet.</Text>;
  }
  return <Text>{`Coverage — ${parts.join(" · ")}`}</Text>;
}

function FootprintBySource(props: {
  footprints: Record<FootprintSource, FootprintEntry[]>;
}) {
  const blocks = SOURCE_ORDER.map((source) => ({
    source,
    entries: props.footprints[source] ?? [],
  })).filter((b) => b.entries.length > 0);
  if (blocks.length === 0) {
    return <Text>No footprint yet: nothing predicted, declared, observed or attested.</Text>;
  }
  return (
    <Fragment>
      {blocks.map((b) => (
        <Fragment>
          <Text>{`${b.source} · ${b.entries.length} path(s)`}</Text>
          <MismatchNote entries={b.entries} />
          <FootprintTable entries={b.entries} />
        </Fragment>
      ))}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/* Collisions                                                          */
/* ------------------------------------------------------------------ */

function zoneOf(collision: Collision, zones: Zone[]): Zone | undefined {
  if (collision.zoneId === undefined) return undefined;
  return zones.find((z) => z.id === collision.zoneId);
}

function neighborOf(
  collision: Collision,
  mine: string[],
  neighbors: NeighborInfo[],
): NeighborInfo | undefined {
  const sides = [collision.worksiteA, collision.worksiteB];
  const around = neighbors.filter((n) => sides.includes(n.worksiteId));
  return around.find((n) => !mine.includes(n.worksiteId)) ?? around[0];
}

function CollisionsBlock(props: {
  collisions: Collision[];
  neighbors: NeighborInfo[];
  mine: string[];
  zones: Zone[];
}) {
  const call = useActionRequest();
  const open = props.collisions.filter((c) => c.state === "open");
  if (open.length === 0) {
    return <Text>No collision on this repository. The ground is free.</Text>;
  }
  return (
    <Fragment>
      <Table>
        <Head>
          <Cell><Text>degree</Text></Cell>
          <Cell><Text>path</Text></Cell>
          <Cell><Text>zone</Text></Cell>
          <Cell><Text>neighbour</Text></Cell>
          <Cell><Text>nature</Text></Cell>
          <Cell><Text>issues</Text></Cell>
        </Head>
        {open.map((collision) => {
          const zone = zoneOf(collision, props.zones);
          return (
            <CollisionRow
              collision={collision}
              neighbor={neighborOf(collision, props.mine, props.neighbors)}
              zoneName={zone?.name}
              zoneNature={zone?.nature}
              call={call}
            />
          );
        })}
      </Table>
      <OverrideForm collisions={open} call={call} />
    </Fragment>
  );
}

/** Going ahead anyway: always with a written reason (spec §8). */
function OverrideForm(props: {
  collisions: Collision[];
  call: (key: string, payload?: Record<string, unknown>) => void;
}) {
  return (
    <Form
      onSubmit={(data) => {
        props.call(ACTION_RESOLVE, {
          collisionId: String(data.collision ?? ""),
          choice: "override",
          reason: String(data.reason ?? ""),
        });
      }}
      submitButtonText="Override with this reason"
    >
      <Select label="Collision" name="collision" isRequired={true}>
        {props.collisions.map((c) => (
          <Option
            label={`D${c.degree} · ${c.path}`}
            value={c.id}
            defaultSelected={c === props.collisions[0]}
          />
        ))}
      </Select>
      <TextField
        name="reason"
        label="Why you go ahead anyway"
        description="The app then checks whether a real conflict followed."
        isRequired={true}
      />
    </Form>
  );
}

function CollisionRow(props: {
  collision: Collision;
  neighbor?: NeighborInfo;
  zoneName?: string;
  zoneNature?: ZoneNature;
  call: (key: string, payload?: Record<string, unknown>) => void;
}) {
  const { collision } = props;
  const base = { collisionId: collision.id, worksiteA: collision.worksiteA, worksiteB: collision.worksiteB };
  return (
    <Row>
      <Cell><DegreeCell degree={collision.degree} probable={collision.probable} /></Cell>
      <Cell><Text>{collision.path}</Text></Cell>
      <Cell><Text>{props.zoneName ?? "—"}</Text></Cell>
      <Cell><Text>{props.neighbor ? `${props.neighbor.issueKey} · ${props.neighbor.actorLabel}` : "—"}</Text></Cell>
      <Cell><Text>{props.zoneNature ?? "—"}</Text></Cell>
      <Cell>
        <IssueButtons base={base} call={props.call} />
      </Cell>
    </Row>
  );
}

/** The five one-click outcomes; "override" needs a reason (see OverrideForm). */
function IssueButtons(props: {
  base: Record<string, unknown>;
  call: (key: string, payload?: Record<string, unknown>) => void;
}) {
  return (
    <Fragment>
      {QUICK_CHOICES.map((q) => (
        <Button
          text={q.label}
          appearance="default"
          onClick={() =>
            props.call(ACTION_RESOLVE, { ...props.base, choice: q.choice })
          }
        />
      ))}
    </Fragment>
  );
}

function DegreeCell(props: { degree: Collision["degree"]; probable?: boolean }) {
  return (
    <Fragment>
      <DegreeLozenge degree={props.degree} />
      <ProbableTag probable={props.probable} />
    </Fragment>
  );
}

/** Prediction-only collision: capped degree, announced as probable (§7). */
function ProbableTag(props: { probable?: boolean }) {
  if (props.probable !== true) return null;
  return <Badge appearance="default" text="probable" />;
}

/* ------------------------------------------------------------------ */
/* Notices and reservations                                            */
/* ------------------------------------------------------------------ */

/** One notice, whichever side of the mailbox it sits on. */
interface NoticeLine {
  label: string;
  paths: string[];
  text: string;
  when: string;
}

function inboxLines(notices: NoticeView[]): NoticeLine[] {
  return notices.map((n) => ({
    label: `${n.fromIssueKey} · ${n.fromActorLabel}`,
    paths: n.paths,
    text: n.text,
    when: n.createdAt,
  }));
}

function outboxLines(notices: Notice[]): NoticeLine[] {
  return notices.map((n) => ({
    label: n.issueKey,
    paths: n.paths,
    text: n.text,
    when: n.createdAt,
  }));
}

/** One table for both directions; `empty` is shown when there is nothing. */
function NoticeTable(props: { lines: NoticeLine[]; empty: string; head: string }) {
  if (props.lines.length === 0) return <Text>{props.empty}</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>{props.head}</Text></Cell>
        <Cell><Text>paths</Text></Cell>
        <Cell><Text>text</Text></Cell>
        <Cell><Text>when</Text></Cell>
      </Head>
      {props.lines.map((line) => (
        <Row>
          <Cell><Text>{line.label}</Text></Cell>
          <Cell><Text>{line.paths.join(", ")}</Text></Cell>
          <Cell><Text>{line.text}</Text></Cell>
          <Cell><Text>{line.when}</Text></Cell>
        </Row>
      ))}
    </Table>
  );
}

function NoticeInbox(props: { notices: NoticeView[] }) {
  return (
    <NoticeTable
      lines={inboxLines(props.notices)}
      empty="No notice received."
      head="from"
    />
  );
}

function NoticeOutbox(props: { notices: Notice[] }) {
  return (
    <NoticeTable
      lines={outboxLines(props.notices)}
      empty="No notice sent."
      head="ticket"
    />
  );
}

function ReservationList(props: { reservations: Reservation[] }) {
  if (props.reservations.length === 0) return <Text>No reservation held.</Text>;
  return (
    <Table>
      <Head>
        <Cell><Text>patterns</Text></Cell>
        <Cell><Text>mode</Text></Cell>
        <Cell><Text>expires</Text></Cell>
        <Cell><Text>reason</Text></Cell>
      </Head>
      {props.reservations.map((r) => (
        <Row>
          <Cell><Text>{r.patterns.join(", ")}</Text></Cell>
          <Cell><Badge appearance={r.hard ? "important" : "default"} text={r.hard ? "hard" : "soft"} /></Cell>
          <Cell><Text>{r.expiresAt}</Text></Cell>
          <Cell><Text>{r.reason ?? "—"}</Text></Cell>
        </Row>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* "I'm working on it"                                                 */
/* ------------------------------------------------------------------ */

function pickedZones(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

/** Zones already predicted for this worksite — pre-ticked, the user confirms. */
export function predictedZoneIds(zones: Zone[], predicted: FootprintEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of predicted) {
    const zone = zoneForPath(zones, entry.path);
    if (zone !== undefined && !ids.includes(zone.id)) ids.push(zone.id);
  }
  return ids;
}

function IWorkOnIt(props: {
  issueKey: string;
  repoId: string;
  zones: Zone[];
  predicted: FootprintEntry[];
}) {
  const call = useActionRequest();
  const repoZones = props.zones.filter((z) => z.repoId === props.repoId);
  const preselected = predictedZoneIds(props.zones, props.predicted);
  return (
    <Form
      onSubmit={(data) => {
        call(ACTION_I_WORK_ON_IT, {
          issueKey: props.issueKey,
          repoId: props.repoId,
          zoneIds: pickedZones(data.zones),
        });
      }}
      submitButtonText="I'm working on it"
    >
      <CheckboxGroup
        label="Zones I am about to touch"
        name="zones"
        description="Pre-ticked from the predicted footprint; adjust before you start."
      >
        {repoZones.length === 0 ? (
          <Checkbox label="No zone declared on this repository" value="" />
        ) : (
          repoZones.map((z) => (
            <Checkbox
              label={`${z.name} · ${z.nature}`}
              value={z.id}
              defaultChecked={preselected.includes(z.id)}
            />
          ))
        )}
      </CheckboxGroup>
    </Form>
  );
}
