#!/bin/sh
# Builds bb-webauthn-helper: a release Swift binary that bridges an explicit
# navigator.credentials.get/create() request from BB's desktop browser to
# AuthenticationServices. Requires the com.apple.developer.web-browser.public-key-credential
# entitlement on the signed BB desktop app to do anything useful; see
# apps/desktop/src/webauthn-native/webauthn-native-entitlement.ts for the
# runtime gate and apps/desktop/build/entitlements.mac.webauthn.plist for the
# entitlement itself.
#
# Usage: ./build.sh [output-directory]
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/.build/bb-webauthn-helper}"
EXECUTABLE_NAME="bb-webauthn-helper"

# Space-separated target triples' architectures, e.g. "arm64" or "arm64 x86_64"
# for a universal binary. Defaults to the host's own architecture.
ARCHS="${BB_WEBAUTHN_HELPER_ARCHS:-$(uname -m)}"
ARCH_FLAGS=""
for arch in $ARCHS; do
  ARCH_FLAGS="$ARCH_FLAGS --arch $arch"
done

# shellcheck disable=SC2086
swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS

# shellcheck disable=SC2086
BUILT_BINARY="$(swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS --show-bin-path)/BBWebauthnHelper"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$BUILT_BINARY" "$OUT_DIR/$EXECUTABLE_NAME"

echo "Built $OUT_DIR/$EXECUTABLE_NAME"
