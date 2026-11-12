#!/usr/bin/env bash
#
# hook.sh — agent-client hook for "Chantiers en collision" (spec §9.3).
#
# WHAT IT DOES
#   open   (SessionStart) reads the current git branch, extracts the ticket key
#                         ([A-Z][A-Z0-9]+-[0-9]+) and opens the worksite on the
#                         app. The response is printed on stdout so the client
#                         injects the neighbour list into the agent's context.
#   close  (SessionEnd)   pauses the worksite. Best effort: this event only gets
#                         1.5 s, and dormancy is the safety net if it fails.
#
# INSTALLATION (once per repository)
#   1. Copy this file to  <repo>/.chantier/hook.sh  and make it executable:
#          mkdir -p .chantier && cp hook.sh .chantier/ && chmod +x .chantier/hook.sh
#   2. Merge templates/hook/settings.json into your client's settings file
#      (Claude Code: <repo>/.claude/settings.json), replacing <INSTALLATION> and
#      <APP_ID> in the PreToolUse URL. The app can generate both files for you:
#      Jira > project settings > Worksites > "Hook & CI".
#   3. Export your personal token — it stays on your machine, never committed:
#          export CHANTIER_TOKEN="<token from Jira > personal settings > My worksites>"
#          export CHANTIER_URL="https://<INSTALLATION>.webtrigger.atlassian.app/v2/<APP_ID>/ingest"
#
# VARIABLES
#   CHANTIER_URL    required — ingest base URL, without the trailing route
#   CHANTIER_TOKEN  required — personal token (the app stores only its sha256)
#   CHANTIER_REPO   optional — repository slug; defaults to git remote origin
#   CHANTIER_CLIENT optional — client name reported with the session (default: hook-script)
#
# FAIL-OPEN, ALWAYS. This script exits 0 whatever happens: missing variables, no
# git repository, no network, app down, app slow (3 s budget for open, 1.5 s for
# close), malformed response. The product advises; it never blocks an agent from
# working. Only the app itself can refuse an edit, and only in hard mode on a
# reserved or frozen zone.
#
# PRIVACY. Only the branch name, the ticket key, a session reference and the
# working directory leave the machine. Never file content.

# No `set -e`, no `set -u`: any error must fall through to `exit 0`.

CHANTIER_CLIENT="${CHANTIER_CLIENT:-hook-script}"
STDIN_JSON=""
RESPONSE=""

# ---------------------------------------------------------------- helpers ----

# Read the client event piped on stdin, if any (never block on a terminal).
read_stdin() {
  if [ -t 0 ]; then STDIN_JSON=""; return 0; fi
  STDIN_JSON="$(head -c 8192 2>/dev/null)" || STDIN_JSON=""
}

# Extract a string field from the event JSON: json_field session_id
json_field() {
  printf '%s' "$STDIN_JSON" \
    | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" \
    | head -n 1
}

# Escape a value for a JSON string body.
esc() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'
}

# Stable 12-char reference so `open` and `close` describe the same session.
session_ref() {
  local input="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$input" | sha256sum | cut -c1-12
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$input" | shasum -a 256 | cut -c1-12
  else
    printf 'ck%s' "$(printf '%s' "$input" | cksum | tr -d ' ')"
  fi
}

# owner/repo from the git remote, e.g. acme/billing
repo_slug() {
  local url slug
  url="$(git remote get-url origin 2>/dev/null)" || return 0
  [ -n "$url" ] || return 0
  case "$url" in
    *@*:*)  slug="${url#*:}" ;;
    *://*)  slug="${url#*://}"; slug="${slug#*/}" ;;
    *)      slug="$url" ;;
  esac
  printf '%s' "${slug%.git}"
}

# POST to the ingest endpoint. $1 route, $2 max-time seconds, $3 JSON body.
post() {
  curl -sS --max-time "$2" -X POST "${CHANTIER_URL%/}/$1" \
    -H "Authorization: Bearer $CHANTIER_TOKEN" \
    -H "Content-Type: application/json" \
    ${REPO_SLUG:+-H "X-Chantier-Repo: $REPO_SLUG"} \
    --data "$3" 2>/dev/null
}

# ------------------------------------------------------------------ setup ----

read_stdin
ACTION="${1:-open}"

# Nothing configured, no curl, not a git repository: stay silent, stay open.
command -v curl >/dev/null 2>&1 || exit 0
[ -n "$CHANTIER_URL" ] && [ -n "$CHANTIER_TOKEN" ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

REPO_SLUG="${CHANTIER_REPO:-$(repo_slug)}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || BRANCH=""
CWD="$(json_field cwd)"; [ -n "$CWD" ] || CWD="$PWD"
# Ticket key from the branch; empty is fine (spec §21: the worksite is then
# attached to the pilot and the branch, and the panel offers to link it later).
ISSUE_KEY="$(printf '%s' "$BRANCH" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -n 1)"
# Prefer the client's own session id; fall back to a stable local reference.
SESSION="$(json_field session_id)"
[ -n "$SESSION" ] || SESSION="$(session_ref "${CWD}|${BRANCH}")"
AGENT_REF="$(json_field agent_id)"

# ----------------------------------------------------------------- dispatch ---

case "$ACTION" in
  open)
    BODY="{\"sessionRef\":\"$(esc "$SESSION")\",\"branch\":\"$(esc "$BRANCH")\",\
\"issueKey\":\"$(esc "$ISSUE_KEY")\",\"cwd\":\"$(esc "$CWD")\",\
\"client\":\"$(esc "$CHANTIER_CLIENT")\"${AGENT_REF:+,\"agentRef\":\"$(esc "$AGENT_REF")\"}}"
    RESPONSE="$(post open 3 "$BODY")" || RESPONSE=""
    # stdout is injected into the agent's context by the client.
    [ -n "$RESPONSE" ] && printf '%s\n' "$RESPONSE"
    ;;
  close)
    REASON="$(json_field reason)"; [ -n "$REASON" ] || REASON="session-end"
    BODY="{\"sessionRef\":\"$(esc "$SESSION")\",\"reason\":\"$(esc "$REASON")\",\
\"branch\":\"$(esc "$BRANCH")\",\"issueKey\":\"$(esc "$ISSUE_KEY")\",\
\"cwd\":\"$(esc "$CWD")\",\"client\":\"$(esc "$CHANTIER_CLIENT")\"}"
    # 1.5 s budget for SessionEnd; output is not used, errors are swallowed.
    post close 1.5 "$BODY" >/dev/null 2>&1 || true
    ;;
  touch)
    # PreToolUse: the client passes the tool input on stdin. Only a write tool
    # carries a file path; the CONTENT never leaves the machine — just the path
    # (the old raw http hook posted the whole tool input, content included).
    FILE="$(json_field file_path)"
    [ -n "$FILE" ] || exit 0
    BODY="{\"session_id\":\"$(esc "$SESSION")\",\"tool_input\":{\"file_path\":\"$(esc "$FILE")\"},\
\"cwd\":\"$(esc "$CWD")\",\"hook_event_name\":\"PreToolUse\"}"
    RESPONSE="$(post touch 10 "$BODY")" || RESPONSE=""
    [ -n "$RESPONSE" ] && printf '%s\n' "$RESPONSE"
    ;;
  *)
    # Unknown action: do nothing, do not fail the agent.
    ;;
esac

exit 0
