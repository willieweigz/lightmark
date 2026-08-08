#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
OUTPUT_DIR="${LIGHTMARK_OUTPUT_DIR:-$PROJECT_DIR/dist}"
APP_DIR="$OUTPUT_DIR/轻阅 Markdown.app"
MINIMUM_MACOS="${LIGHTMARK_MINIMUM_MACOS:-13.0}"
ARCHS_INPUT="${LIGHTMARK_ARCHS:-$(uname -m)}"
ARCHS=("${(@s:,:)ARCHS_INPUT}")
SWIFTC="${LIGHTMARK_SWIFTC:-$(xcrun --sdk macosx --find swiftc)}"
SDK_PATH="${LIGHTMARK_SDK_PATH:-$(xcrun --sdk macosx --show-sdk-path)}"
MODULE_CACHE_ROOT="${LIGHTMARK_MODULE_CACHE_DIR:-${TMPDIR:-/private/tmp}/lightmark-module-cache}"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$MODULE_CACHE_ROOT"

BINARIES=()
for ARCH in "${ARCHS[@]}"; do
  ARCH_BINARY="$OUTPUT_DIR/LightMark-$ARCH"
  mkdir -p "$MODULE_CACHE_ROOT/$ARCH"
  "$SWIFTC" \
    -swift-version 5 \
    -module-cache-path "$MODULE_CACHE_ROOT/$ARCH" \
    -sdk "$SDK_PATH" \
    -target "$ARCH-apple-macosx$MINIMUM_MACOS" \
    -O \
    -framework AppKit \
    -framework WebKit \
    "$PROJECT_DIR/Sources/LightMark/main.swift" \
    -o "$ARCH_BINARY"
  BINARIES+=("$ARCH_BINARY")
done

if (( ${#BINARIES[@]} == 1 )); then
  cp "$BINARIES[1]" "$APP_DIR/Contents/MacOS/LightMark"
else
  lipo -create "${BINARIES[@]}" -output "$APP_DIR/Contents/MacOS/LightMark"
fi
rm -f "${BINARIES[@]}"

cp "$PROJECT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$PROJECT_DIR/Resources/LightMark.icns" "$APP_DIR/Contents/Resources/LightMark.icns"
cp "$PROJECT_DIR/Resources/preview.html" "$APP_DIR/Contents/Resources/preview.html"
cp "$PROJECT_DIR/Resources/marked.min.js" "$APP_DIR/Contents/Resources/marked.min.js"
cp "$PROJECT_DIR/Resources/purify.min.js" "$APP_DIR/Contents/Resources/purify.min.js"

codesign --force --deep --sign - "$APP_DIR"
echo "$APP_DIR"
