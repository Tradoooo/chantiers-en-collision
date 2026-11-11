#!/usr/bin/env bash
# smoke-e2e.sh — end-to-end smoke of a DEPLOYED Forge app's `ingest` web trigger.
#
# The trigger never returns CI worksite state (src/glue/webtrigger.ts), so we
# assert on HTTP codes + the fail-open contract only:
#   - empty body            -> valid (agent keeps working)
#   - JSON object           -> valid (hook JSON / footprint ack)
#   - JSON with additionalContext on /touch -> must mention a PROJ-9xx ticket
#
# No real data: only the `src/smoke/*` path is used. Failure => exit 1 with the
# 1-based step number. Success => "SMOKE OK (8/8)".
#
# Env: CHANTIER_URL (ingest base, e.g. .../ingest), CHANTIER_TOKEN (project
# token for /ci/*, personal token for /open|/touch|/close), optional
# CHANTIER_PERSONAL_TOKEN (else CHANTIER_TOKEN is reused), CHANTIER_REPO (slug,
# default acme/smoke).

set -u

CHANTIER_URL="${CHANTIER_URL:-}"
CHANTIER_TOKEN="${CHANTIER_TOKEN:-}"
CHANTIER_REPO="${CHANTIER_REPO:-acme/smoke}"
PERSONAL="${CHANTIER_PERSONAL_TOKEN:-$CHANTIER_TOKEN}"

[ -n "$CHANTIER_URL" ]   || { echo 'SMOKE FAIL - config : CHANTIER_URL non défini' >&2; exit 1; }
[ -n "$CHANTIER_TOKEN" ] || { echo 'SMOKE FAIL - config : CHANTIER_TOKEN non défini' >&2; exit 1; }
command -v curl    >/dev/null 2>&1 || { echo 'SMOKE FAIL - config : curl requis' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'SMOKE FAIL - config : python3 requis' >&2; exit 1; }

URL="${CHANTIER_URL%/}"
SESSION="smoke-$RANDOM$RANDOM"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

STEP=0
CODE=""
fail() { echo "SMOKE FAIL - étape $STEP : $1" >&2; exit 1; }

# post <route> <token> <body>  -> sets CODE (http code) and writes body to $TMP
post() {
  local route="$1" token="$2" body="$3" rc=0
  CODE="$(curl -sS --max-time 10 -o "$TMP" -w '%{http_code}' -X POST "$URL/$route" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "X-Chantier-Repo: $CHANTIER_REPO" \
    -d "$body" 2>/dev/null)" || rc=$?
  [ "$rc" = "0" ] || return 1
}

# py_assert <mode>  — stdin = the response body. mode in {contract,hook,empty}.
#  contract: empty body OR a JSON object is valid (fail-open / ack / hook JSON)
#  hook:     like contract, and IF additionalContext is present it must name PROJ-9xx
#  empty:    the body must be empty (unknown route → 200 with no body)
py_assert() {
  python3 - "$1" < "$TMP" <<'PY'
import json, re, sys

mode = sys.argv[1]
raw = sys.stdin.read()

if raw.strip() == "":
    sys.exit(0)                    # empty body satisfies every contract

if mode == "empty":
    sys.exit(1)                    # a non-empty body cannot be "empty"

try:
    data = json.loads(raw)
except Exception:
    sys.exit(1)                    # non-JSON body on contract/hook modes

if not isinstance(data, dict):
    sys.exit(1)

if mode == "contract":
    sys.exit(0)

if mode == "hook":
    ctx = (data.get("hookSpecificOutput") or {}).get("additionalContext")
    if ctx and not re.search(r"PROJ-9\d\d", str(ctx)):
        sys.exit(1)
    sys.exit(0)

sys.exit(1)
PY
}

# --- bodies (smoke-only strings; repository + session are injected, no quotes to escape)
bFoot900="$(printf '{"repoSlug":"%s","branch":"PROJ-900-smoke","files":["src/smoke/a.ts"]}' "$CHANTIER_REPO")"
bFoot901="$(printf '{"repoSlug":"%s","branch":"PROJ-901-smoke","files":["src/smoke/a.ts"]}' "$CHANTIER_REPO")"
bOpen="$(printf '{"sessionRef":"%s","branch":"feature/PROJ-902-smoke"}' "$SESSION")"
bTouch="$(printf '{"session_id":"%s","tool_input":{"file_path":"%s/src/smoke/a.ts"},"cwd":"%s","hook_event_name":"PreToolUse"}' "$SESSION" "$PWD" "$PWD")"
bClose="$(printf '{"sessionRef":"%s","reason":"smoke"}' "$SESSION")"

# (1) attested footprint, branch PROJ-900 — /ci/footprint -> 200
STEP=1
post "ci/footprint" "$CHANTIER_TOKEN" "$bFoot900" || fail "POST /ci/footprint impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert contract || fail "contrat fail-open non respecté (footprint PROJ-900)"

# (2) attested footprint, branch PROJ-901, same file — /ci/footprint -> 200
STEP=2
post "ci/footprint" "$CHANTIER_TOKEN" "$bFoot901" || fail "POST /ci/footprint impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert contract || fail "contrat fail-open non respecté (footprint PROJ-901)"

# (3) re-send footprint PROJ-901 while PROJ-900 exists -> collision resolves
#     server-side; the trigger still only returns a code + ack (no worksite state).
STEP=3
post "ci/footprint" "$CHANTIER_TOKEN" "$bFoot901" || fail "POST /ci/footprint impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert contract || fail "contrat fail-open non respecté (collision PROJ-900/901)"

# (4) open a session — personal token — /open -> 200, empty or hook JSON
STEP=4
post "open" "$PERSONAL" "$bOpen" || fail "POST /open impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert contract || fail "contrat fail-open non respecté (/open)"

# (5) touch a path — /touch -> 200; if additionalContext, it must name PROJ-9xx
STEP=5
post "touch" "$PERSONAL" "$bTouch" || fail "POST /touch impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert hook || fail "additionalContext de /touch ne cite pas PROJ-9xx"

# (6) close the session — /close -> 200
STEP=6
post "close" "$PERSONAL" "$bClose" || fail "POST /close impossible"
[ "$CODE" = "200" ] || fail "attendu 200, reçu $CODE"
py_assert contract || fail "contrat fail-open non respecté (/close)"

# (7) unknown route -> 200 with an EMPTY body (fail-open, not a 404)
STEP=7
post "nope" "$PERSONAL" '{}' || fail "POST /nope impossible"
[ "$CODE" = "200" ] || fail "attendu 200 (fail-open), reçu $CODE"
py_assert empty || fail "route inconnue : corps non vide (attendu 200 vide)"

# (8) invalid token on /ci/* -> 401 (the pipeline must fix its token)
STEP=8
post "ci/footprint" "invalid-smoke-token" '{"repoSlug":"x","branch":"y","files":["z"]}' || fail "POST /ci/footprint impossible"
[ "$CODE" = "401" ] || fail "attendu 401 (jeton invalide /ci), reçu $CODE"

echo "SMOKE OK (8/8)"