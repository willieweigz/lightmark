#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
OUTPUT_DIR="${LIGHTMARK_OUTPUT_DIR:-$PROJECT_DIR/dist}"
APP_DIR="$OUTPUT_DIR/轻阅 Markdown.app"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

mkdir -p /private/tmp/lightmark-module-cache

/Library/Developer/CommandLineTools/usr/bin/swiftc \
  -swift-version 5 \
  -module-cache-path /private/tmp/lightmark-module-cache \
  -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
  -target arm64-apple-macosx13.0 \
  -O \
  -framework AppKit \
  -framework WebKit \
  "$PROJECT_DIR/Sources/LightMark/main.swift" \
  -o "$APP_DIR/Contents/MacOS/LightMark"

cp "$PROJECT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$PROJECT_DIR/Resources/preview.html" "$APP_DIR/Contents/Resources/preview.html"
cp "$PROJECT_DIR/Resources/marked.min.js" "$APP_DIR/Contents/Resources/marked.min.js"
cp "$PROJECT_DIR/Resources/purify.min.js" "$APP_DIR/Contents/Resources/purify.min.js"

codesign --force --deep --sign - "$APP_DIR"
echo "$APP_DIR"
