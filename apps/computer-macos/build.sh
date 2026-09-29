#!/bin/sh
# Builds bb Computer.app: a release Swift binary wrapped in a signed app bundle
# whose main executable is the bb-computer-helper CLI. The daemon later places
# a matching cua-driver binary inside Contents/MacOS so the helper can spawn it
# as an embedded child (see DriverProcess.swift).
#
# Usage: ./build.sh [output-directory]
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/.build/bb-computer-app}"
APP_NAME="bb Computer.app"
BUNDLE_ID="app.getbb.computer"
EXECUTABLE_NAME="bb-computer-helper"

# Space-separated target triples' architectures, e.g. "arm64" or "arm64 x86_64"
# for a universal binary. Defaults to the host's own architecture.
ARCHS="${BB_COMPUTER_ARCHS:-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/arm64/')}"
ARCH_FLAGS=""
for arch in $ARCHS; do
  ARCH_FLAGS="$ARCH_FLAGS --arch $arch"
done

# shellcheck disable=SC2086
swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS

# shellcheck disable=SC2086
BUILT_BINARY="$(swift build --package-path "$SCRIPT_DIR" -c release $ARCH_FLAGS --show-bin-path)/BBComputerHelper"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/$APP_NAME/Contents/MacOS"
cp "$BUILT_BINARY" "$OUT_DIR/$APP_NAME/Contents/MacOS/$EXECUTABLE_NAME"

VERSION="${BB_COMPUTER_VERSION:-0.1.0}"
cat > "$OUT_DIR/$APP_NAME/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>bb Computer</string>
	<key>CFBundleExecutable</key>
	<string>$EXECUTABLE_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>bb Computer</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$VERSION</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSAppleEventsUsageDescription</key>
	<string>bb Computer automates other applications on your behalf when you use the Computer feature.</string>
</dict>
</plist>
PLIST
printf 'APPL????' > "$OUT_DIR/$APP_NAME/Contents/PkgInfo"

CODESIGN_IDENTITY="${BB_COMPUTER_SIGNING_IDENTITY:--}"
codesign --force --deep --sign "$CODESIGN_IDENTITY" "$OUT_DIR/$APP_NAME"

echo "Built $OUT_DIR/$APP_NAME (signed with identity: $CODESIGN_IDENTITY)"
