/**
 * ui/worksiteMap — screen 2 "map of worksites" (spec §16.2, §12).
 *
 * Presentational only: every value comes from typed props, the screen
 * never calls a service. Owner: workstream K.
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
import type {
  MapNode,
  Worksite,
  WorksiteMapData,
  ZoneNature,
} from "../core/types";
import { minutesBetween } from "../testing/clock";
import { DegreeLozenge, StateLozenge } from "./components";

type BadgeAppearance = "default" | "added" | "removed" | "important" | "primary";

type OccupiedWorksite = Worksite & { actorLabel: string };

/** Folders first, then patterns, then files — alphabetical inside a rank. */
const KIND_RANK: Record<MapNode["kind"], number> = { dir: 0, pattern: 1, file: 2 };

const NATURE_APPEARANCE: Record<ZoneNature, BadgeAppearance> = {
  ordinary: "default",
  exclusive: "important",
  hotspot: "added",
  frozen: "removed",
  "out-of-scope": "default",
};

const LEGEND =
  "D0 same named zone · D1 same directory · D2 same file · " +
  "D3 same file with a delete or a rename · D4 exclusive, frozen or reserved ground.";

function sortNodes(nodes: MapNode[]): MapNode[] {
  return [...nodes].sort((a, b) => {
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    return a.path.localeCompare(b.path);
  });
}

function depthOf(path: string): number {
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

/** Indented label: depth drives the prefix, the leaf name stays readable. */
function nodeLabel(node: MapNode): string {
  if (node.kind === "pattern") return node.path;
  const depth = depthOf(node.path);
  const leaf = node.path.split("/").filter(Boolean).pop() ?? node.path;
  if (depth === 0) return leaf;
  return `${"  ".repeat(depth - 1)}└─ ${leaf}`;
}

function zoneBadges(node: MapNode) {
  if (!node.zoneName && !node.zoneNature) {
    return <Text>—</Text>;
  }
  return (
    <Fragment>
      {node.zoneName ? <Badge text={node.zoneName} appearance="primary" /> : null}
      {node.zoneNature ? (
        <Badge text={node.zoneNature} appearance={NATURE_APPEARANCE[node.zoneNature]} />
      ) : null}
    </Fragment>
  );
}

function occupantLine(
  worksite: OccupiedWorksite | undefined,
  now: string,
) {
  if (!worksite) {
    return <Text>unknown session</Text>;
  }
  return (
    <Fragment>
      <Text>{`${worksite.issueKey} · ${worksite.actorLabel}`}</Text>
      <StateLozenge state={worksite.state} />
      <Text>{`${minutesBetween(worksite.lastActivityAt, now)} min ago`}</Text>
    </Fragment>
  );
}

function occupantsCell(
  node: MapNode,
  byId: Map<string, OccupiedWorksite>,
  now: string,
) {
  if (node.worksiteIds.length === 0) {
    return <Text>free</Text>;
  }
  return (
    <Fragment>
      {node.worksiteIds.map((id) => (
        <Fragment>{occupantLine(byId.get(id), now)}</Fragment>
      ))}
    </Fragment>
  );
}

export function WorksiteMap(props: { data: WorksiteMapData; now: string }) {
  const byId = new Map<string, OccupiedWorksite>();
  for (const worksite of props.data.worksites) byId.set(worksite.id, worksite);
  const nodes = sortNodes(props.data.nodes);

  return (
    <Fragment>
      <Heading size="large">{`Map of worksites — ${props.data.repoSlug}`}</Heading>
      <SectionMessage appearance="info" title="Degree legend">
        <Text>{LEGEND}</Text>
      </SectionMessage>
      <Table>
        <Head>
          <Cell>
            <Text>path</Text>
          </Cell>
          <Cell>
            <Text>degree</Text>
          </Cell>
          <Cell>
            <Text>zone</Text>
          </Cell>
          <Cell>
            <Text>occupants</Text>
          </Cell>
        </Head>
        {nodes.map((node) => (
          <Row>
            <Cell>
              <Text>{nodeLabel(node)}</Text>
            </Cell>
            <Cell>
              <DegreeLozenge degree={node.worstDegree} />
            </Cell>
            <Cell>{zoneBadges(node)}</Cell>
            <Cell>{occupantsCell(node, byId, props.now)}</Cell>
          </Row>
        ))}
      </Table>
    </Fragment>
  );
}
