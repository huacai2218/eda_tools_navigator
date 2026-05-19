#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION_VALUE="$(tr -d '[:space:]' < VERSION)"
STAMP="$(date +%Y%m%d-%H%M%S)"
PACKAGE_NAME="eda-tools-reader-${VERSION_VALUE}-${STAMP}.tar.gz"
DIST_DIR="$ROOT_DIR/dist"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$DIST_DIR"
mkdir -p "$STAGING_DIR/eda-tools-reader"

copy_path() {
  local src="$1"
  if [ -e "$src" ]; then
    cp -R "$src" "$STAGING_DIR/eda-tools-reader/"
  fi
}

copy_path "VERSION"
copy_path "README.md"
copy_path "requirements.txt"
copy_path "server.py"
copy_path ".env.example"
copy_path ".gitignore"
copy_path "static"
copy_path "scripts"

find "$STAGING_DIR/eda-tools-reader" -name ".DS_Store" -delete
find "$STAGING_DIR/eda-tools-reader" -name "__pycache__" -type d -prune -exec rm -rf {} +

tar -czf "$DIST_DIR/$PACKAGE_NAME" -C "$STAGING_DIR" "eda-tools-reader"

echo "$DIST_DIR/$PACKAGE_NAME"

