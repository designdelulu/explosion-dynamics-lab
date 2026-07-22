#!/bin/sh

# One-way production workflow for Explosion Dynamics Lab.
# Source is always this standalone repository. The sibling website checkout is
# neither read nor written. Without a confirmed DreamHost shell account this
# script creates a reviewed SFTP upload package and verifies it over HTTPS.
set -eu

DEPLOY_SCRIPT=$0
case "$DEPLOY_SCRIPT" in
  /*) ;;
  *) DEPLOY_SCRIPT=$PWD/$DEPLOY_SCRIPT ;;
esac
while [ -L "$DEPLOY_SCRIPT" ]; do
  DEPLOY_LINK=$(readlink "$DEPLOY_SCRIPT")
  case "$DEPLOY_LINK" in
    /*) DEPLOY_SCRIPT=$DEPLOY_LINK ;;
    *) DEPLOY_SCRIPT=$(dirname "$DEPLOY_SCRIPT")/$DEPLOY_LINK ;;
  esac
done

DEPLOY_SCRIPT_DIR=$(CDPATH= cd "$(dirname "$DEPLOY_SCRIPT")" && pwd -P)
DEPLOY_SOURCE_DIR=$(CDPATH= cd "$DEPLOY_SCRIPT_DIR/.." && pwd -P)
DEPLOY_WORKSPACE_DIR=$(CDPATH= cd "$DEPLOY_SOURCE_DIR/.." && pwd -P)
DEPLOY_OUTPUT_PARENT=$DEPLOY_SOURCE_DIR/dist/production
DEPLOY_OUTPUT_DIR=$DEPLOY_OUTPUT_PARENT/explosion-dynamics-lab
DEPLOY_DUPLICATE_DIR=$DEPLOY_WORKSPACE_DIR/eric-barker-site/explosion-dynamics-lab
DEPLOY_PRODUCTION_URL=https://www.ericbarker.co/explosion-dynamics-lab/

if [ "${DEPLOY_SOURCE_DIR##*/}" != "explosion-dynamics-lab" ]; then
  printf 'Error: deploy-production.sh must live in the standalone explosion-dynamics-lab project.\n' >&2
  printf 'Resolved source: %s\n' "$DEPLOY_SOURCE_DIR" >&2
  exit 1
fi
if [ -e "$DEPLOY_DUPLICATE_DIR" ]; then
  printf 'Error: obsolete local website copy exists: %s\n' "$DEPLOY_DUPLICATE_DIR" >&2
  printf 'Reconcile and remove it; deployment must originate only from the standalone source.\n' >&2
  exit 1
fi

run_tests() {
  cd "$DEPLOY_SOURCE_DIR"
  node --check scripts/build-info.js
  node --check scripts/data.js
  node --check scripts/fluid-engine.js
  node --check scripts/renderer.js
  node --check scripts/exporter.js
  node --check scripts/app.js
  node --check tools/build-production.mjs
  node --check tools/verify-prepared-release.mjs
  node --check tools/verify-production.mjs
  node tools/smoke-test.mjs
  node tools/fluid-contract-test.mjs
  node tools/exporter-smoke-test.mjs
  node tools/developer-mode-contract-test.mjs
  node tools/static-audit.mjs
  node tools/release-contract-test.mjs
}

build_release() {
  cd "$DEPLOY_SOURCE_DIR"
  node tools/build-production.mjs
  node tools/verify-prepared-release.mjs
}

read_release_id() {
  node -p "JSON.parse(require('fs').readFileSync('$DEPLOY_OUTPUT_PARENT/deployment-receipt.json','utf8')).releaseId"
}

package_release() {
  run_tests
  build_release
  DEPLOY_RELEASE_ID=$(read_release_id)
  DEPLOY_PACKAGE_DIR=$DEPLOY_SOURCE_DIR/dist/packages
  DEPLOY_PACKAGE_PATH=$DEPLOY_PACKAGE_DIR/explosion-dynamics-lab-$DEPLOY_RELEASE_ID.tar.gz
  mkdir -p "$DEPLOY_PACKAGE_DIR"
  if [ -e "$DEPLOY_PACKAGE_PATH" ]; then
    printf 'Error: refusing to overwrite existing package: %s\n' "$DEPLOY_PACKAGE_PATH" >&2
    exit 1
  fi
  # The archive intentionally contains only the staged directory's contents.
  # Extracting it inside the confirmed live explosion-dynamics-lab/ directory
  # can therefore never create a nested explosion-dynamics-lab/ or dist/ tree.
  tar -czf "$DEPLOY_PACKAGE_PATH" -C "$DEPLOY_OUTPUT_DIR" .
  printf 'Production SFTP package ready.\n'
  printf '  source: %s\n' "$DEPLOY_SOURCE_DIR"
  printf '  upload directory: %s\n' "$DEPLOY_OUTPUT_DIR"
  printf '  archive: %s\n' "$DEPLOY_PACKAGE_PATH"
  shasum -a 256 "$DEPLOY_PACKAGE_PATH"
  printf 'REMOTE ROOT CONTRACT (contents only):\n'
  printf '  destination: panel-confirmed DreamHost web directory/explosion-dynamics-lab/\n'
  printf '  upload: the CONTENTS of %s/\n' "$DEPLOY_OUTPUT_DIR"
  printf '  never upload: the standalone source root, dist/, dist/production/, or an outer explosion-dynamics-lab/ wrapper\n'
  printf 'Upload releases/ and vendor-releases/ first; .htaccess and deployment-manifest.json next; index.html last.\n'
  printf 'Run "%s verify-active", remove obsolete/exposed development and nested-dist paths, then run "%s verify".\n' "$0" "$0"
}

verify_release() {
  cd "$DEPLOY_SOURCE_DIR"
  if [ "${1:-strict}" = "active" ]; then
    node tools/verify-production.mjs --base-url "$DEPLOY_PRODUCTION_URL" --skip-cleanup-check
  else
    node tools/verify-production.mjs --base-url "$DEPLOY_PRODUCTION_URL"
  fi
}

rsync_release() {
  if [ -z "${EDL_RSYNC_TARGET:-}" ]; then
    printf 'Error: EDL_RSYNC_TARGET is required for rsync mode.\n' >&2
    printf 'Use only a panel-confirmed user@host:/absolute/web-directory/explosion-dynamics-lab/ target.\n' >&2
    exit 1
  fi
  case "$EDL_RSYNC_TARGET" in
    *..*|~*|/*|*/dist/*|*/dist/production/*)
      printf 'Error: unsafe rsync target: %s\n' "$EDL_RSYNC_TARGET" >&2
      exit 1
      ;;
    *@*:*/*/explosion-dynamics-lab/) ;;
    *)
      printf 'Error: rsync target must be user@host:/absolute/path/explosion-dynamics-lab/.\n' >&2
      exit 1
      ;;
  esac

  if [ -n "${EDL_RSYNC_CONFIRM:-}" ]; then
    cd "$DEPLOY_SOURCE_DIR"
    node tools/verify-prepared-release.mjs
    DEPLOY_RELEASE_ID=$(read_release_id)
  else
    run_tests
    build_release
    DEPLOY_RELEASE_ID=$(read_release_id)
  fi
  printf 'One-way rsync dry run: %s -> %s\n' "$DEPLOY_OUTPUT_DIR/" "$EDL_RSYNC_TARGET"
  rsync -azcn --delete-after --itemize-changes "$DEPLOY_OUTPUT_DIR/" "$EDL_RSYNC_TARGET"
  if [ "${EDL_RSYNC_CONFIRM:-}" != "$DEPLOY_RELEASE_ID" ]; then
    printf 'Dry run only. Re-run with EDL_RSYNC_CONFIRM=%s after reviewing the exact target and deletions.\n' "$DEPLOY_RELEASE_ID"
    exit 2
  fi

  # Make the immutable files available before switching the root document.
  rsync -azc --exclude=.htaccess --exclude=deployment-manifest.json --exclude=index.html \
    "$DEPLOY_OUTPUT_DIR/" "$EDL_RSYNC_TARGET"
  rsync -azc "$DEPLOY_OUTPUT_DIR/.htaccess" "${EDL_RSYNC_TARGET}.htaccess"
  rsync -azc "$DEPLOY_OUTPUT_DIR/deployment-manifest.json" "${EDL_RSYNC_TARGET}deployment-manifest.json"
  rsync -azc "$DEPLOY_OUTPUT_DIR/index.html" "${EDL_RSYNC_TARGET}index.html"
  verify_release active

  # Cleanup occurs only after the new index and complete manifest verify live.
  rsync -azc --delete-after --itemize-changes "$DEPLOY_OUTPUT_DIR/" "$EDL_RSYNC_TARGET"
  verify_release
}

case "${1:-package}" in
  build)
    build_release
    ;;
  test)
    run_tests
    ;;
  package)
    package_release
    ;;
  verify)
    verify_release
    ;;
  verify-active)
    verify_release active
    ;;
  rsync)
    rsync_release
    ;;
  *)
    printf 'Usage: %s {build|test|package|verify-active|verify|rsync}\n' "$0" >&2
    exit 64
    ;;
esac
