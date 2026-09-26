#!/bin/sh
set -eu

SOURCE_DIR="$HOME/.local/bb"
RELEASE_REPO="hellogafaro/bb"
RELEASES_DIR="$HOME/.local/bb-releases"
CURRENT_LINK="$HOME/.local/bb-current"
NATIVE_PACKAGES="better-sqlite3,node-pty,@parcel/watcher"
LOG="$HOME/.local/bb-build-logs/reload.log"

usage() {
  cat <<'EOF'
Usage: bb-reload [--from-release [tag]]

  (no arguments)          Pull hellogafaro/bb main in ~/.local/bb, build it,
                          and restart bb-server.
  --from-release [tag]    Download bb-app-<version>.tgz from a hellogafaro/bb
                          GitHub release (default: the latest release), verify
                          its sha256, install it under ~/.local/bb-releases,
                          point ~/.local/bb-current at it, and restart
                          bb-server.
EOF
}

fail() {
  echo "$1" >&2
  exit 1
}

server_exec_start() {
  systemctl show -p ExecStart --value bb-server
}

restart_server() {
  running=$1
  pid=$(systemctl show -p MainPID --value bb-server)
  if [ "${pid:-0}" -gt 0 ]; then
    echo "Restarting BB (running threads are stopped gracefully first)..."
    kill "$pid"
  fi
  for _ in $(seq 1 300); do
    current=$(systemctl show -p MainPID --value bb-server)
    if [ "${current:-0}" -gt 0 ] && [ "$current" != "$pid" ] && curl -fs -o /dev/null http://127.0.0.1:38886/; then
      echo "BB is back on $running."
      exit 0
    fi
    sleep 1
  done
  fail "BB did not come back within 5 minutes. Check: journalctl -u bb-server -n 50"
}

reload_from_source() {
  cd "$SOURCE_DIR"
  for lock in "$HOME"/.local/share/pnpm/package-manager-store/*/tmp/engine-locks/*.lock; do
    [ -f "$lock/owner" ] || continue
    owner=$(cut -d- -f1 "$lock/owner")
    if ! kill -0 "$owner" 2>/dev/null; then
      echo "Removing stale pnpm lock left by exited process $owner..."
      rm -rf "$lock"
    fi
  done
  echo "Pulling hellogafaro/bb main..."
  git pull --ff-only origin main
  mkdir -p "$(dirname "$LOG")"
  echo "Installing dependencies..."
  pnpm install --ignore-scripts --prefer-offline > "$LOG" 2>&1 || { tail -20 "$LOG"; exit 1; }
  node scripts/ensure-native-modules.mjs >> "$LOG" 2>&1
  pnpm run prepare >> "$LOG" 2>&1
  echo "Building..."
  NODE_OPTIONS=--max-old-space-size=3072 pnpm exec turbo run build \
    --filter=@bb/scripts --filter=@bb/app --filter=@bb/server \
    --filter=@bb/host-daemon --filter=@bb/cli --filter=bb-app \
    --concurrency=2 --output-logs=errors-only
  case "$(server_exec_start)" in
    *"$CURRENT_LINK/"*)
      echo "Warning: bb-server starts from $CURRENT_LINK, so this restart keeps the installed release, not this build." >&2
      ;;
  esac
  restart_server "$(git log -1 --format='%h %s')"
}

install_release() {
  tarball_path=$1
  version=$2
  target="$RELEASES_DIR/$version"
  if [ -d "$target" ]; then
    echo "bb-app $version is already installed in $target."
    return
  fi
  mkdir -p "$RELEASES_DIR" "$(dirname "$LOG")"
  staging=$(mktemp -d "$RELEASES_DIR/.$version.XXXXXX")
  printf '{\n  "private": true\n}\n' > "$staging/package.json"
  echo "Installing bb-app $version and building its native add-ons..."
  if ! (cd "$staging" && npm_config_ignore_scripts=false npm install \
    --allow-scripts="$NATIVE_PACKAGES" --omit=dev --no-audit --no-fund \
    "$tarball_path") > "$LOG" 2>&1; then
    tail -20 "$LOG"
    rm -rf "$staging"
    fail "npm install of bb-app $version failed. Full log: $LOG"
  fi
  if ! (cd "$staging" && node -e '
const bbRequire = require("node:module").createRequire(`${process.cwd()}/node_modules/bb-app/package.json`);
new (bbRequire("better-sqlite3"))(":memory:").close();
bbRequire("node-pty");
bbRequire("@parcel/watcher");
') >> "$LOG" 2>&1; then
    tail -20 "$LOG"
    rm -rf "$staging"
    fail "bb-app $version native add-ons did not load. Full log: $LOG"
  fi
  mv "$staging" "$target"
}

reload_from_release() {
  tag=$1
  command -v gh > /dev/null || fail "--from-release needs the GitHub CLI (gh)."
  if [ -z "$tag" ]; then
    tag=$(gh release view --repo "$RELEASE_REPO" --json tagName --jq .tagName)
  fi
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  echo "Downloading bb-app from $RELEASE_REPO release $tag..."
  gh release download "$tag" --repo "$RELEASE_REPO" --dir "$work" \
    --pattern 'bb-app-*.tgz' --pattern 'bb-app-*.tgz.sha256'
  set -- "$work"/bb-app-*.tgz
  [ $# -eq 1 ] && [ -f "$1" ] || fail "Release $tag must contain exactly one bb-app-<version>.tgz."
  tarball_path=$1
  tarball=$(basename "$tarball_path")
  [ -f "$tarball_path.sha256" ] || fail "Release $tag has no $tarball.sha256."
  expected=$(cut -d' ' -f1 "$tarball_path.sha256")
  actual=$(sha256sum "$tarball_path" | cut -d' ' -f1)
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "Checksum mismatch for $tarball from release $tag."
  echo "Verified $tarball sha256 $actual."
  version=${tarball#bb-app-}
  version=${version%.tgz}
  case "$version" in
    '' | *[!0-9A-Za-z.+-]*) fail "Unexpected bb-app version '$version' in $tarball." ;;
  esac

  install_release "$tarball_path" "$version"

  if [ -e "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ]; then
    fail "$CURRENT_LINK exists and is not a symlink; refusing to replace it."
  fi
  ln -s "$RELEASES_DIR/$version" "$CURRENT_LINK.new.$$"
  mv -Tf "$CURRENT_LINK.new.$$" "$CURRENT_LINK"
  echo "$CURRENT_LINK now points at $RELEASES_DIR/$version."

  case "$(server_exec_start)" in
    *"$CURRENT_LINK/"*) ;;
    *)
      fail "bb-server does not start from $CURRENT_LINK, so it was not restarted. Point its ExecStart at $CURRENT_LINK/node_modules/bb-app/dist/bb-app.js first."
      ;;
  esac
  restart_server "bb-app $version from release $tag"
}

main() {
  case "${1:-}" in
    "")
      reload_from_source
      ;;
    --from-release)
      [ $# -le 2 ] || { usage >&2; exit 2; }
      reload_from_release "${2:-}"
      ;;
    -h | --help)
      usage
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
