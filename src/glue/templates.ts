/**
 * glue/templates — the files the project settings screen hands out:
 * the agent-client hook settings (from `templates/hook/settings.json`, with the
 * real web trigger URL instantiated) and one CI step per provider (spec §10:
 * "the CI step is one command").
 * Owner: workstream I (glue).
 *
 * The hook template is IMPORTED (resolveJsonModule), not copied: one source of
 * truth with `templates/hook/settings.json` (owned by workstream L).
 */

import hookSettings from "../../templates/hook/settings.json";

/** Placeholder URL in the template → the installation's real ingest URL. */
const TEMPLATE_URL = /https:\/\/[^"]*\/ingest/g;

/** The hook settings file, with `<INSTALLATION>`/`<APP_ID>` replaced. */
export function hooksSettingsFile(ingestUrl: string): string {
  const json = JSON.stringify(hookSettings, null, 2);
  return json.replace(TEMPLATE_URL, ingestUrl.replace(/\/+$/, ""));
}

/** Portable `git diff --name-only` → a JSON array of paths (no jq needed). */
const FILES_JSON =
  'FILES_JSON=$(git diff --name-only "origin/$BASE...HEAD" | ' +
  "awk 'BEGIN{printf \"[\"} {if(NR>1)printf \",\"; gsub(/\\\\/,\"\\\\\\\\\"); gsub(/\"/,\"\\\\\\\"\"); " +
  "printf \"\\\"%s\\\"\", $0} END{printf \"]\"}')";

const ISSUE_KEY_FROM_BRANCH =
  "ISSUE_KEY=$(printf '%s' \"$BRANCH\" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -n 1)";

function postFootprint(repo: string, extra: string): string {
  return (
    `curl -sf -X POST "$CHANTIER_URL/ci/footprint" \\\n` +
    `  -H "Authorization: Bearer $CHANTIER_TOKEN" -H 'Content-Type: application/json' \\\n` +
    `  -d "{\\"repoSlug\\":\\"${repo}\\",\\"branch\\":\\"$BRANCH\\",\\"baseBranch\\":\\"$BASE\\",` +
    `\\"issueKey\\":\\"$ISSUE_KEY\\",\\"files\\":$FILES_JSON${extra}}" || true`
  );
}

/** The files the project settings screen hands out, with their target name. */
export interface CiSnippet {
  name: string;
  content: string;
}

/** `files` are the paths changed since the divergence point (caller computes). */
export function ciSnippets(ingestUrl: string): CiSnippet[] {
  const url = ingestUrl.replace(/\/+$/, "");
  return [
    { name: "bitbucket-pipelines.yml", content: bitbucketSnippet(url) },
    { name: ".github/workflows/ci.yml", content: githubSnippet(url) },
    { name: ".gitlab-ci.yml", content: gitlabSnippet(url) },
  ];
}

function bitbucketSnippet(url: string): string {
  return `# bitbucket-pipelines.yml — attested footprint (Chantiers en collision)
- step:
    name: Chantier footprint
    script:
      - export CHANTIER_URL="${url}"
      - export BASE="$BITBUCKET_REPO_MAIN_BRANCH" BRANCH="$BITBUCKET_BRANCH"
      - git fetch origin "$BASE"
      - ${FILES_JSON}
      - ${ISSUE_KEY_FROM_BRANCH}
      - ${postFootprint("$BITBUCKET_REPO_FULL_NAME", "")}
`;
}

function githubSnippet(url: string): string {
  return `# .github/workflows/ci.yml — attested footprint (Chantiers en collision)
- name: Chantier footprint
  env:
    CHANTIER_URL: ${url}
    CHANTIER_TOKEN: \${{ secrets.CHANTIER_TOKEN }}   # project token
  run: |
    export BASE="\${GITHUB_BASE_REF:-main}" BRANCH="$GITHUB_HEAD_REF"
    git fetch --no-tags --depth=50 origin "$BASE"
    ${FILES_JSON}
    ${ISSUE_KEY_FROM_BRANCH}
    ${postFootprint("$GITHUB_REPOSITORY", ',\\"prOpen\\":true')}
`;
}

function gitlabSnippet(url: string): string {
  return `# .gitlab-ci.yml — attested footprint (Chantiers en collision)
chantier-footprint:
  stage: test
  variables:
    CHANTIER_URL: ${url}
    BASE: $CI_DEFAULT_BRANCH
    BRANCH: $CI_COMMIT_REF_NAME
  script:
    - git fetch origin "$BASE"
    - ${FILES_JSON}
    - ${ISSUE_KEY_FROM_BRANCH}
    - ${postFootprint("$CI_PROJECT_PATH", "")}
`;
}
