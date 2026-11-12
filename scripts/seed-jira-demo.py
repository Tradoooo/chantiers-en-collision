#!/usr/bin/env python3
"""
seed-jira-demo.py — populate the demo Jira site with REAL data and drive the
deployed app end to end (triggers, CI footprints, agent hook sessions).

Reads credentials like scripts/deploy.sh:
  email : FORGE_EMAIL env or line 1 of ~/.atlassian-login
  site  : FORGE_SITE env or line 2 of ~/.atlassian-login
  token : FORGE_API_TOKEN env or ~/.atlassian-api-token
Web trigger + app tokens:
  CHANTIER_URL   : the ingest base URL (see docs/DEPLOY.md)
  CHANTIER_TOKEN : personal token (.tokens/personal.json → token)
  CHANTIER_PROJECT_TOKEN : project token (.tokens/project.json → token)

Steps: components → issues → In Progress transitions (fires the trigger)
→ CI attested footprints (project token) → one agent session open+touch
(personal token) → prints the live /status.
Stdlib only. Never prints a token.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path

HOME = Path.home()


def read_creds():
    email = os.environ.get("FORGE_EMAIL")
    site = os.environ.get("FORGE_SITE")
    token = os.environ.get("FORGE_API_TOKEN")
    login_file = HOME / ".atlassian-login"
    if (not email or not site) and login_file.exists():
        for line in login_file.read_text().splitlines():
            if line.startswith("email="):
                email = email or line.split("=", 1)[1].strip()
            if line.startswith("site="):
                site = site or line.split("=", 1)[1].strip()
    if not token:
        token = (HOME / ".atlassian-api-token").read_text().strip()
    if not email or not site or not token:
        sys.exit("missing Atlassian credentials")
    return email, site.replace("https://", "").split("/")[0], token


def api(site, email, token, method, path, body=None):
    url = f"https://{site}/rest/api/3{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    auth = b64encode(f"{email}:{token}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise SystemExit(f"{method} {path} → HTTP {e.code}: {detail}")


def wt(url, token, route, body, repo="acme/billing"):
    req = urllib.request.Request(f"{url}/{route}", data=json.dumps(body).encode(), method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Chantier-Repo", repo)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {"httpError": e.code, "body": e.read().decode()[:200]}


def ensure_components(site, email, token, project_id, names):
    existing = {c["name"] for c in api(site, email, token, "GET", f"/project/{project_id}/components")}
    ids = {}
    for name in names:
        if name in existing:
            comp = next(c for c in api(site, email, token, "GET", f"/project/{project_id}/components") if c["name"] == name)
            ids[name] = {"id": comp["id"]}
            continue
        created = api(site, email, token, "POST", "/component",
                      {"name": name, "project": "PROJ", "assigneeType": "PROJECT_LEAD"})
        ids[name] = {"id": created["id"]}
    return ids


def main():
    email, site, token = read_creds()
    wt_url = os.environ.get("CHANTIER_URL")
    personal = os.environ.get("CHANTIER_TOKEN")
    project_tok = os.environ.get("CHANTIER_PROJECT_TOKEN")
    tokens_dir = Path(__file__).resolve().parent.parent / ".tokens"
    if not personal and (tokens_dir / "personal.json").exists():
        personal = json.loads((tokens_dir / "personal.json").read_text())["token"]
    if not project_tok and (tokens_dir / "project.json").exists():
        project_tok = json.loads((tokens_dir / "project.json").read_text())["token"]
    if not wt_url or not personal or not project_tok:
        sys.exit("CHANTIER_URL + tokens required (see docs/DEPLOY.md)")

    project = api(site, email, token, "GET", "/project/PROJ")
    comps = ensure_components(site, email, token, project["id"], ["billing", "database", "auth", "i18n"])
    types = api(site, email, token, "GET", "/issue/createmeta/PROJ/issuetypes")
    type_list = types.get("issueTypes", types.get("values", []))
    wanted = ("task", "tâche", "story", "histoire")
    issue_type = next(
        (t["id"] for t in type_list if t["name"].lower() in wanted),
        type_list[0]["id"],
    )
    priorities = {p["name"]: p["id"] for p in api(site, email, token, "GET", "/priority")}

    plan = [
        ("Invoice total in cents", ["billing"], "High", "2026-11-20"),
        ("Rename the billing service", ["billing"], "Medium", "2026-11-24"),
        ("Renumber migrations", ["database"], "Highest", "2026-11-18"),
        ("Index on invoices", ["database"], "Medium", "2026-11-21"),
        ("Login rate limit", ["auth"], "Low", "2026-11-28"),
        ("total_cents migration", ["database", "billing"], "High", "2026-11-22"),
        ("Translate the invoices screen", ["i18n"], "Low", "2026-12-01"),
    ]
    keys = []
    for summary, comp_names, prio, due in plan:
        created = api(site, email, token, "POST", "/issue", {"fields": {
            "project": {"key": "PROJ"},
            "summary": summary,
            "issuetype": {"id": issue_type},
            "components": [comps[c] for c in comp_names],
            "priority": {"id": priorities.get(prio, priorities.get("Medium"))},
            "duedate": due,
        }})
        keys.append(created["key"])
        print(f"created {created['key']} — {summary}")

    def transition(key, name):
        aliases = {"In Progress": ("in progress", "en cours"), "Done": ("done", "terminé")}
        names = aliases.get(name, (name.lower(),))
        moves = api(site, email, token, "GET", f"/issue/{key}/transitions")
        target = next((t for t in moves["transitions"] if t["name"].lower() in names), None)
        if target:
            api(site, email, token, "POST", f"/issue/{key}/transitions",
                {"transition": {"id": target["id"]}})
            print(f"{key} → {name}")

    in_progress = [keys[0], keys[2], keys[3], keys[4]]
    for key in in_progress:
        transition(key, "In Progress")

    print("--- CI attested footprints (project token) ---")
    ci_files = {
        keys[0]: ("feature/total-cents", ["src/billing/invoice.ts", "src/billing/tax.ts"], True),
        keys[2]: ("feature/renumber", ["db/migrations/0101_renumber.sql"], False),
        keys[3]: ("feature/index", ["db/migrations/0102_index.sql"], False),
        keys[4]: ("feature/rate-limit", ["src/auth/login.ts"], False),
    }
    for key, (branch, files, pr) in ci_files.items():
        res = wt(wt_url, project_tok, "ci/footprint",
                 {"repoSlug": "acme/billing", "branch": branch, "issueKey": key, "files": files, "prOpen": pr})
        print(key, "→", json.dumps(res)[:160] if res else "(empty)")

    print("--- agent session (personal token): open + touch ---")
    opened = wt(wt_url, personal, "open",
                {"session_id": "seed-agent-1", "branch": f"feature/{keys[1]}-rename", "cwd": "/home/dev/billing"})
    print("open →", json.dumps(opened)[:300] if opened else "(empty)")
    touched = wt(wt_url, personal, "touch", {
        "session_id": "seed-agent-1",
        "hook_event_name": "PreToolUse",
        "tool_input": {"file_path": "/home/dev/billing/src/billing/invoice.ts"},
        "cwd": "/home/dev/billing",
    })
    print("touch →", json.dumps(touched)[:400] if touched else "(empty)")

    print("--- live status ---")
    status = wt(wt_url, personal, "status", {})
    print(json.dumps(status, indent=1)[:1200] if status else "(empty — needs the /status deploy)")


if __name__ == "__main__":
    main()
