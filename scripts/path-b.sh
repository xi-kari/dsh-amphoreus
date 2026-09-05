#!/usr/bin/env bash
set -euo pipefail

SERVER_PID=""
OUT=""
JAR=""
TMP_ROOT=""
DSH=(node --import tsx/esm apps/cli/src/bin.ts)

stop_server() {
  if [[ -z "$SERVER_PID" ]]; then
    return
  fi
  kill "$SERVER_PID" 2>/dev/null || true
  for _ in {1..40}; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    taskkill //PID "$SERVER_PID" //F >/dev/null 2>&1 || true
  fi
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

cleanup_sensitive() {
  local file
  for file in "$JAR" "$OUT"; do
    if [[ -n "$TMP_ROOT" && "$file" == "$TMP_ROOT/"* ]]; then
      rm -f -- "$file"
    fi
  done
}

trap 'stop_server; cleanup_sensitive' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="$(cd "$PKG/../.." && pwd)"
DEV="${PATH_B_DEV:-$WORKSPACE/deepseek-harness-dev}"
ASSETS="${PATH_B_ASSETS:-$WORKSPACE/deepseek插件开发}"
MAIN_HOME="${PATH_B_MAIN_HOME:-$WORKSPACE/.dsh-home}"

if command -v cygpath >/dev/null 2>&1; then
  DEV="$(cygpath -u "$DEV")"
  ASSETS_WIN="$(cygpath -m "$ASSETS")"
  MAIN_HOME_WIN="$(cygpath -m "$MAIN_HOME")"
else
  ASSETS_WIN="$ASSETS"
  MAIN_HOME_WIN="$MAIN_HOME"
fi

export DSH_HOME="${PATH_B_DSH_HOME:-$MAIN_HOME_WIN}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export DSH_TELEMETRY_DISABLED=1
export PATH="$WORKSPACE/local-deployment/bin:/c/Program Files/nodejs:/mingw64/bin:/usr/bin:/c/Users/cangm/AppData/Local/Programs/Python/Python310:/c/WINDOWS/System32:/c/WINDOWS:/c/WINDOWS/System32/Wbem:/c/WINDOWS/System32/WindowsPowerShell/v1.0"

PROFILE_WIN="$DSH_HOME/profiles/amphdemo"
if command -v cygpath >/dev/null 2>&1; then
  PROFILE="$(cygpath -u "$PROFILE_WIN")"
  MAIN_HOME="$(cygpath -u "$MAIN_HOME_WIN")"
else
  PROFILE="$PROFILE_WIN"
  MAIN_HOME="$MAIN_HOME_WIN"
fi

mkdir -p /c/tmp
TMP_ROOT="$(mktemp -d /c/tmp/dsh-amphoreus-path-b.XXXXXX)"
TARBALL_NAME="dsh-amphoreus-0.2.0.tgz"
TARBALL_COPY="$TMP_ROOT/$TARBALL_NAME"
OUT="$TMP_ROOT/amphdemo.out"
ERR="$TMP_ROOT/amphdemo.err"
JAR="$TMP_ROOT/jar"
CI_DIR="$TMP_ROOT/ci"

WEB_MANIFEST="$MAIN_HOME/profiles/web/package.json"
WEB_PATCH="$MAIN_HOME/profiles/web/cordis.patch.yml"
WEB_MANIFEST_BEFORE=""
WEB_PATCH_BEFORE=""
if [[ -f "$WEB_MANIFEST" ]]; then
  WEB_MANIFEST_BEFORE="$(sha256sum "$WEB_MANIFEST" | cut -d' ' -f1)"
fi
if [[ -f "$WEB_PATCH" ]]; then
  WEB_PATCH_BEFORE="$(sha256sum "$WEB_PATCH" | cut -d' ' -f1)"
fi

if netstat -ano | grep -E '127\.0\.0\.1:3090[[:space:]].*LISTENING' >/dev/null; then
  echo "path-b: port 3090 is already listening" >&2
  exit 1
fi

cd "$PKG"
test "$(node -p "require('./package.json').version")" = "0.2.0"
npm run release:check
npm pack --ignore-scripts --registry https://registry.npmjs.org >/dev/null
test -f "$PKG/$TARBALL_NAME"
cp "$PKG/$TARBALL_NAME" "$TARBALL_COPY"
rm -f "$PKG/$TARBALL_NAME"
test -f "$TARBALL_COPY"
echo "package: $TARBALL_NAME"

cd "$DEV"
"${DSH[@]}" plugin --profile amphdemo install

node - "$PROFILE/package.json" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const profile = JSON.parse(fs.readFileSync(file, 'utf8'))
profile.dsh ??= {}
profile.dsh.profile ??= {}
profile.dsh.profile.bundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
]
fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`)
NODE
printf '[]\n' > "$PROFILE/cordis.patch.yml"

if command -v cygpath >/dev/null 2>&1; then
  TARBALL_ARG="$(cygpath -m "$TARBALL_COPY")"
else
  TARBALL_ARG="$TARBALL_COPY"
fi
"${DSH[@]}" plugin --profile amphdemo add "$TARBALL_ARG" \
  > >(tee "$TMP_ROOT/add.out") \
  2> >(tee "$TMP_ROOT/add.err" >&2)
if grep -q 'declares no dsh.bundle' "$TMP_ROOT/add.err"; then
  echo "path-b: tarball did not reconcile as a bundle" >&2
  exit 1
fi

node - "$PROFILE/package.json" <<'NODE'
const fs = require('node:fs')
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const bundles = profile.dsh?.profile?.bundles ?? []
if (profile.dependencies?.['dsh-amphoreus'] === undefined) process.exit(1)
if (bundles.at(-1) !== 'dsh-amphoreus') process.exit(2)
console.log(`reconcile: ${bundles.join(' -> ')}`)
NODE

for package_name in \
  @deepseek-ai/cordis \
  @deepseek-ai/dsh-home-paths \
  @deepseek-ai/dsh-llm \
  @deepseek-ai/dsh-skill \
  @deepseek-ai/dsh-storage-domain \
  @deepseek-ai/schemastery
do
  test ! -e "$PROFILE/node_modules/$package_name"
done
for package_name in yaml zod dsh-amphoreus; do
  test -e "$PROFILE/node_modules/$package_name"
done
echo "profile peers: installation fallback only; direct: yaml zod dsh-amphoreus"

"${DSH[@]}" --profile amphdemo --dump-config \
  > "$TMP_ROOT/dump.out" \
  2> "$TMP_ROOT/dump.err"
grep -n 'id: amphoreus' "$TMP_ROOT/dump.out" | head -1
grep -n '^# == dsh-amphoreus$' "$TMP_ROOT/dump.out" | head -1
grep -n "dshHomePath('amphoreus')" "$TMP_ROOT/dump.out" | head -1

cat > "$PROFILE/cordis.patch.yml" <<YAML
- id: amphoreus
  config:
    skillRoots: ['~/.claude/skills', '~/.codex/skills']
    dataDir: !!js dshHomePath('amphoreus')
    assetsRoot: '$ASSETS_WIN'
YAML

"${DSH[@]}" --profile amphdemo --no-open --host 127.0.0.1 --port 3090 \
  > "$OUT" 2> "$ERR" &
SERVER_PID=$!

for _ in {1..120}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$ERR" >&2
    exit 1
  fi
  if grep -q 'dsh web: http://' "$OUT"; then
    break
  fi
  sleep 0.5
done
grep -q 'dsh web: http://' "$OUT"
# shellcheck disable=SC2016
if grep -E 'run `pnpm run build`|ERR_MODULE_NOT_FOUND|loaded without registering' "$ERR"; then
  exit 1
fi

for package_name in \
  @deepseek-ai/cordis \
  @deepseek-ai/dsh-home-paths \
  @deepseek-ai/dsh-llm \
  @deepseek-ai/dsh-skill \
  @deepseek-ai/dsh-storage-domain \
  @deepseek-ai/schemastery
do
  test -e "$DSH_HOME/profiles/node_modules/$package_name"
done
echo "fallback: six peer packages resolved"

LAUNCH_URL="$(grep -o 'dsh web: http://[^ ]*' "$OUT" | tail -1 | sed 's/^dsh web: //')"
test -n "$LAUNCH_URL"
AUTH_STATUS="$(curl -s -g --noproxy '*' -c "$JAR" -o /dev/null -w '%{http_code}' "$LAUNCH_URL")"
case "$AUTH_STATUS" in
  200|303) ;;
  *) echo "path-b: unexpected auth status $AUTH_STATUS" >&2; exit 1 ;;
esac

INDEX="$(curl -s --noproxy '*' -b "$JAR" http://127.0.0.1:3090/)"
BOOT_COUNT="$(printf '%s' "$INDEX" | grep -c '__AMPHOREUS_BOOT__')"
test "$BOOT_COUNT" -ge 1

# shellcheck disable=SC2016
STATE_SUMMARY="$(curl -s --noproxy '*' -b "$JAR" http://127.0.0.1:3090/amphoreus/api/state | node -e '
const fs = require("node:fs")
const state = JSON.parse(fs.readFileSync(0, "utf8"))
const summary = `${state.suite?.level} ${state.seats?.length} ${state.effectiveConfig?.assetsConfigured}`
console.log(summary)
if (summary !== "L0 13 true") process.exit(1)
')"

BUNDLE_URL="$(printf '%s' "$INDEX" | grep -o '/plugins/??dsh-amphoreus/client.js[^" ]*' | head -1 | sed 's/&amp;/\&/g')"
test -n "$BUNDLE_URL"
curl -s -g --noproxy '*' -b "$JAR" "http://127.0.0.1:3090$BUNDLE_URL" -o "$TMP_ROOT/client.js"
BUNDLE_PREFIX="$(head -c 40 "$TMP_ROOT/client.js")"
case "$BUNDLE_PREFIX" in
  'window.__ModuleLoader__.load({'*) ;;
  *) echo "path-b: browser bundle wrapper mismatch" >&2; exit 1 ;;
esac
MARK_STATUS="$(curl -s --noproxy '*' -b "$JAR" -o /dev/null -w '%{http_code}' http://127.0.0.1:3090/amphoreus/workbench/mark.svg)"
test "$MARK_STATUS" = "200"
echo "http: auth=$AUTH_STATUS boot=$BOOT_COUNT state='$STATE_SUMMARY' bundle='$BUNDLE_PREFIX' mark=$MARK_STATUS"

git clone --quiet --no-hardlinks "$PKG" "$CI_DIR"
cp "$PKG/package.json" "$PKG/package-lock.json" "$CI_DIR/"
cp "$PKG/src/client/conversation-feed.ts" "$CI_DIR/src/client/conversation-feed.ts"
cd "$CI_DIR"
npm ci --ignore-scripts --registry https://registry.npmjs.org
test -f node_modules/@deepseek-ai/dsh-client-web/lib/types/platform.d.ts
test ! -f node_modules/@deepseek-ai/dsh-client-web/src/platform.ts
echo "npm-ci dependency shape: dsh-client-web d.ts=true src=false"
npm test
npm run build
npm run verify:dist

stop_server
for _ in {1..40}; do
  if ! netstat -ano | grep -E '127\.0\.0\.1:3090[[:space:]].*LISTENING' >/dev/null; then
    break
  fi
  sleep 0.25
done
if netstat -ano | grep -E '127\.0\.0\.1:3090[[:space:]].*LISTENING' >/dev/null; then
  echo "path-b: port 3090 remains listening" >&2
  exit 1
fi

cd "$DEV"
"${DSH[@]}" plugin --profile amphdemo remove dsh-amphoreus
node - "$PROFILE/package.json" <<'NODE'
const fs = require('node:fs')
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const bundles = profile.dsh?.profile?.bundles ?? []
if (profile.dependencies?.['dsh-amphoreus'] !== undefined) process.exit(1)
if (bundles.includes('dsh-amphoreus')) process.exit(2)
if (!bundles.includes('@deepseek-ai/dsh-base')) process.exit(3)
if (!bundles.includes('@deepseek-ai/dsh-web-app')) process.exit(4)
console.log(`cleanup: ${bundles.join(' -> ')}`)
NODE

if [[ -n "$WEB_MANIFEST_BEFORE" ]]; then
  test "$WEB_MANIFEST_BEFORE" = "$(sha256sum "$WEB_MANIFEST" | cut -d' ' -f1)"
fi
if [[ -n "$WEB_PATCH_BEFORE" ]]; then
  test "$WEB_PATCH_BEFORE" = "$(sha256sum "$WEB_PATCH" | cut -d' ' -f1)"
fi
echo "main web profile: unchanged"
echo "path-b artifacts: $TMP_ROOT"
echo "path-b: OK"
