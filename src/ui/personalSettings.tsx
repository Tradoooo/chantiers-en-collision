/**
 * ui/personalSettings — screen 5 "personal settings" (spec §16.5, §17
 * "Jetons personnels").
 *
 * Presentational only: my worksites, my agent sessions and my hook token
 * fingerprints arrive as typed props; token interactions go through the
 * action bridge (keys "tokens.generate" and "tokens.revoke").
 * Owner: workstream K.
 */

import ForgeUI, {
  Badge,
  Button,
  Cell,
  Code,
  Fragment,
  Head,
  Heading,
  Row,
  SectionMessage,
  Table,
  Text,
} from "@forge/ui";
import type { ActorSession, Worksite } from "../core/types";
import { minutesBetween } from "../core/time";
import { StateLozenge } from "./components";
import { useActionBridge } from "./projectSettings";
import type { ActionRouter } from "./issuePanel";

type MyWorksite = Worksite & { actorLabel: string; repoSlug?: string };

type TokenPrint = {
  tokenHash: string;
  scope: string;
  createdAt: string;
  lastUsedAt?: string;
};

function activityLabel(at: string, now?: string): string {
  return now ? `${minutesBetween(at, now)} min ago` : at;
}

function MyWorksitesTable(props: { worksites: MyWorksite[]; now?: string }) {
  if (props.worksites.length === 0) {
    return <Text>No worksite of yours on the ground right now.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>ticket</Text>
        </Cell>
        <Cell>
          <Text>repository</Text>
        </Cell>
        <Cell>
          <Text>state</Text>
        </Cell>
        <Cell>
          <Text>last activity</Text>
        </Cell>
      </Head>
      {props.worksites.map((worksite) => (
        <Row>
          <Cell>
            <Text>{worksite.issueKey}</Text>
          </Cell>
          <Cell>
            <Text>{worksite.repoSlug ?? "—"}</Text>
          </Cell>
          <Cell>
            <StateLozenge state={worksite.state} />
          </Cell>
          <Cell>
            <Text>{activityLabel(worksite.lastActivityAt, props.now)}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function MySessionsTable(props: { sessions: ActorSession[] }) {
  if (props.sessions.length === 0) {
    return <Text>No agent session recorded for you.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>client</Text>
        </Cell>
        <Cell>
          <Text>session</Text>
        </Cell>
        <Cell>
          <Text>agent</Text>
        </Cell>
        <Cell>
          <Text>last seen</Text>
        </Cell>
      </Head>
      {props.sessions.map((session) => (
        <Row>
          <Cell>
            <Text>{session.client}</Text>
          </Cell>
          <Cell>
            <Text>{session.sessionRef ?? "—"}</Text>
          </Cell>
          <Cell>
            <Text>{session.agentRef ?? "—"}</Text>
          </Cell>
          <Cell>
            <Text>{session.lastSeen}</Text>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function TokenRow(props: {
  token: TokenPrint;
  send: ReturnType<typeof useActionBridge>;
}) {
  const token = props.token;
  return (
    <Row>
      <Cell>
        <Code text={token.tokenHash.slice(0, 12)} language="text" />
      </Cell>
      <Cell>
        <Badge text={token.scope} appearance="default" />
      </Cell>
      <Cell>
        <Text>{token.createdAt}</Text>
      </Cell>
      <Cell>
        <Text>{token.lastUsedAt ?? "never"}</Text>
      </Cell>
      <Cell>
        <Button
          text="Revoke"
          appearance="danger"
          onClick={() =>
            props.send("tokens.revoke", { tokenHash: token.tokenHash })
          }
        />
      </Cell>
    </Row>
  );
}

function TokensTable(props: {
  tokens: TokenPrint[];
  send: ReturnType<typeof useActionBridge>;
}) {
  if (props.tokens.length === 0) {
    return <Text>No token yet.</Text>;
  }
  return (
    <Table>
      <Head>
        <Cell>
          <Text>fingerprint</Text>
        </Cell>
        <Cell>
          <Text>scope</Text>
        </Cell>
        <Cell>
          <Text>created</Text>
        </Cell>
        <Cell>
          <Text>last used</Text>
        </Cell>
        <Cell>
          <Text>revoke</Text>
        </Cell>
      </Head>
      {props.tokens.map((token) => (
        <TokenRow token={token} send={props.send} />
      ))}
    </Table>
  );
}

function TokenPanel(props: {
  tokens: TokenPrint[];
  newToken?: string;
  actions?: ActionRouter;
  send: ReturnType<typeof useActionBridge>;
}) {
  return (
    <Fragment>
      {props.newToken ? (
        <SectionMessage appearance="confirmation" title="New hook token">
          <Text>Shown ONCE — copy it now. The app only keeps a fingerprint.</Text>
          <Code text={props.newToken} language="text" />
        </SectionMessage>
      ) : null}
      <Button
        text="Generate token"
        appearance="primary"
        onClick={() => props.send("tokens.generate")}
      />
      <TokensTable tokens={props.tokens} send={props.send} />
    </Fragment>
  );
}

export function PersonalSettings(props: {
  myWorksites: MyWorksite[];
  mySessions: ActorSession[];
  tokens: TokenPrint[];
  newToken?: string;
  /**
   * Optional clock (ISO). GAP REPORT: the brief asks for "minutes ago" via
   * minutesBetween but its props signature carries no clock — the glue
   * should pass ctx.now(); without it raw timestamps are shown.
   */
  now?: string;
}) {
  const send = useActionBridge();
  return (
    <Fragment>
      <Heading size="large">Personal settings</Heading>
      <Heading size="medium">My worksites</Heading>
      <MyWorksitesTable worksites={props.myWorksites} now={props.now} />
      <Heading size="medium">My agent sessions</Heading>
      <MySessionsTable sessions={props.mySessions} />
      <Heading size="medium">Hook token</Heading>
      <TokenPanel
        tokens={props.tokens}
        newToken={props.newToken}
        send={send}
      />
    </Fragment>
  );
}
