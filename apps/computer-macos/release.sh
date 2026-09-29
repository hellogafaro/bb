#!/bin/sh
# Builds just the bb-computer-helper executable (not the .app bundle — the
# daemon assembles that itself, see computer-app-bundle.ts) and packages it
# into the tar.gz that computer-helper-provisioning.ts downloads and
# checksum-verifies. Used by .github/workflows/build-computer-helper.yml;
# also runnable locally to reproduce a release asset byte-for-byte.
#
# Usage: BB_COMPUTER_HELPER_VERSION=0.1.0 ./release.sh [output-directory]
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/.build/release-asset}"
VERSION="${BB_COMPUTER_HELPER_VERSION:?set BB_COMPUTER_HELPER_VERSION, e.g. 0.1.0}"
ARCH="$(uname -m)"

ARCH_FLAGS=""
if [ "${BB_COMPUTER_ARCHS:-}" != "" ]; then
  for arch in $BB_COMPUTER_ARCHS; do
    ARCH_FLAGS="$ARCH_FLAGS --arch $arch"
  done
fi

# shellcheck disable=SC2086
swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS
# shellcheck disable=SC2086
BIN_PATH="$(swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS --show-bin-path)"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$BIN_PATH/BBComputerHelper" "$OUT_DIR/bb-computer-helper"
chmod 755 "$OUT_DIR/bb-computer-helper"

ASSET_NAME="bb-computer-helper-$VERSION-darwin-$ARCH.tar.gz"
tar -czf "$OUT_DIR/$ASSET_NAME" -C "$OUT_DIR" bb-computer-helper

SHA256="$(shasum -a 256 "$OUT_DIR/$ASSET_NAME" | awk '{print $1}')"
echo "asset: $OUT_DIR/$ASSET_NAME"
echo "sha256: $SHA256"
echo ""
if [ "$ARCH" = "arm64" ]; then PLATFORM_KEY="darwin-arm64"; else PLATFORM_KEY="darwin-x64"; fi
echo "Add to COMPUTER_HELPER_PINS in apps/host-daemon/src/computer/computer-helper-provisioning.ts:"
echo "  \"$PLATFORM_KEY\": { version: \"$VERSION\", asset: \"$ASSET_NAME\", sha256: \"$SHA256\" },"
