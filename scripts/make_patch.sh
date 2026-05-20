#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION_VALUE="$(tr -d '[:space:]' < VERSION)"
VERSION_PATTERN="${VERSION_VALUE//./\\.}"
RELEASE_NOTES_FILE="$ROOT_DIR/RELEASE_NOTES.md"
STAMP="$(date +%Y%m%d-%H%M%S)"
PACKAGE_NAME="eda-tools-reader-patch-${VERSION_VALUE}-${STAMP}.tar.gz"
DIST_DIR="$ROOT_DIR/dist"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$DIST_DIR"
mkdir -p "$STAGING_DIR/eda-tools-reader-patch"

if [ ! -f "$RELEASE_NOTES_FILE" ]; then
  echo "Missing RELEASE_NOTES.md. Add release notes before creating a patch package." >&2
  exit 1
fi

if ! grep -Eq "^##[[:space:]]+${VERSION_PATTERN}([[:space:]]|$)" "$RELEASE_NOTES_FILE"; then
  echo "RELEASE_NOTES.md must include an entry for version ${VERSION_VALUE}." >&2
  echo "Add a heading like: ## ${VERSION_VALUE} - YYYY-MM-DD" >&2
  exit 1
fi

copy_path() {
  local src="$1"
  if [ -e "$src" ]; then
    cp -R "$src" "$STAGING_DIR/eda-tools-reader-patch/"
  fi
}

copy_path "VERSION"
copy_path "RELEASE_NOTES.md"
copy_path "README.md"
copy_path "requirements.txt"
copy_path "server.py"
copy_path ".env.example"
copy_path ".gitignore"
copy_path "static"
copy_path "scripts"

find "$STAGING_DIR/eda-tools-reader-patch" -name ".DS_Store" -delete
find "$STAGING_DIR/eda-tools-reader-patch" -name "__pycache__" -type d -prune -exec rm -rf {} +

tar -czf "$DIST_DIR/$PACKAGE_NAME" -C "$STAGING_DIR" "eda-tools-reader-patch"

echo "$DIST_DIR/$PACKAGE_NAME"
