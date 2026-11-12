#!/usr/bin/env bash
# deploy-site.sh — build the demo site and publish it to the gh-pages branch.
#
# GitHub Pages serves the `gh-pages` branch directly (no Actions needed —
# useful while the self-hosted dispatch is degraded). Run after any change
# to site/ or to the engine that the demo bundles:
#
#   npm run deploy:site
#
# The site is then public at:
#   https://baptistefaisy.github.io/chantiers-en-collision/
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${TMPDIR:-/tmp}/chantiers-gh-pages"
SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"

cd "$REPO_DIR"
echo "==> build"
node scripts/verify.mjs --only check:site

echo "==> gh-pages worktree"
git worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT"
git worktree add --detach "$WT" HEAD >/dev/null
cd "$WT"
git checkout -q -B gh-pages
find . -maxdepth 1 ! -name '.git' ! -name '.' -exec rm -rf {} +
cp -r "$REPO_DIR/site/dist/." .

git add -A
if git diff --cached --quiet; then
  echo "==> site unchanged — nothing to publish"
else
  git -c user.name=BaptisteFaisy -c user.email=baptiste.faisy@gmail.com \
    -c core.autocrlf=input commit -q -m "site: deploy from ${SHA}"
  git push -q -f origin gh-pages
  echo "==> published gh-pages from ${SHA}"
fi

cd "$REPO_DIR"
git worktree remove --force "$WT" 2>/dev/null || true
echo "==> https://baptistefaisy.github.io/chantiers-en-collision/"
