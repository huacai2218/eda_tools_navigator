#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(pwd)"
SERVICE_NAME="eda-tools-reader"
RESTART_SERVICE="auto"
PACKAGE=""
PYTHON_BOOTSTRAP_BIN="${PYTHON_BIN:-python3.9}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/apply_patch.sh <patch.tar.gz> [options]

Options:
  --app-dir DIR          Project directory to patch. Default: current directory.
  --service NAME         systemd service name. Default: eda-tools-reader.
  --restart              Restart service after patch.
  --no-restart           Do not restart service.
  -h, --help             Show help.

The patch preserves raw/, data/, .env, .venv, backups/, and dist/.
The patch process is offline-safe: it does not create a venv or install Python dependencies.
Run python3.9 server.py --reindex separately when raw/wiki indexes need rebuilding.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --restart)
      RESTART_SERVICE="yes"
      shift
      ;;
    --no-restart)
      RESTART_SERVICE="no"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [ -n "$PACKAGE" ]; then
        echo "Only one patch package can be provided." >&2
        exit 2
      fi
      PACKAGE="$1"
      shift
      ;;
  esac
done

if [ -z "$PACKAGE" ]; then
  usage
  exit 2
fi

APP_DIR="$(cd "$APP_DIR" && pwd)"
PACKAGE="$(cd "$(dirname "$PACKAGE")" && pwd)/$(basename "$PACKAGE")"

if [ ! -f "$PACKAGE" ]; then
  echo "Patch package not found: $PACKAGE" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/server.py" ]; then
  echo "APP_DIR does not look like eda-tools-reader: $APP_DIR" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Extracting patch package..."
tar -xzf "$PACKAGE" -C "$TMP_DIR"

if [ -d "$TMP_DIR/eda-tools-reader-patch" ]; then
  PATCH_DIR="$TMP_DIR/eda-tools-reader-patch"
elif [ -d "$TMP_DIR/eda-tools-reader" ]; then
  PATCH_DIR="$TMP_DIR/eda-tools-reader"
else
  PATCH_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
fi

if [ ! -f "$PATCH_DIR/server.py" ]; then
  echo "Invalid patch package: server.py not found." >&2
  exit 1
fi

mkdir -p "$APP_DIR/backups"
BACKUP_FILE="$APP_DIR/backups/pre-patch-$(date +%Y%m%d-%H%M%S).tar.gz"

echo "Creating code backup: $BACKUP_FILE"
tar -czf "$BACKUP_FILE" -C "$APP_DIR" \
  --exclude="./manuals" \
  --exclude="./raw" \
  --exclude="./data" \
  --exclude="./.env" \
  --exclude="./.venv" \
  --exclude="./backups" \
  --exclude="./dist" \
  --exclude="./__pycache__" \
  .

cd "$APP_DIR"

echo "Applying patch files..."
copy_item() {
  local item="$1"
  if [ -e "$PATCH_DIR/$item" ]; then
    rm -rf "$APP_DIR/$item"
    cp -R "$PATCH_DIR/$item" "$APP_DIR/$item"
  fi
}

copy_item "VERSION"
copy_item "RELEASE_NOTES.md"
copy_item "README.md"
copy_item "requirements.txt"
copy_item "server.py"
copy_item ".env.example"
copy_item ".gitignore"
copy_item "static"
copy_item "scripts"

chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true

PYTHON_BIN="$PYTHON_BOOTSTRAP_BIN"
if [ -x "$APP_DIR/.venv/bin/python" ]; then
  PYTHON_BIN="$APP_DIR/.venv/bin/python"
elif ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "$PYTHON_BOOTSTRAP_BIN not found and .venv/bin/python is not available; cannot run syntax check." >&2
  exit 1
fi

echo "Checking Python syntax..."
"$PYTHON_BIN" -m py_compile server.py

service_exists() {
  command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1
}

if [ "$RESTART_SERVICE" = "auto" ]; then
  if service_exists; then
    RESTART_SERVICE="yes"
  else
    RESTART_SERVICE="no"
  fi
fi

if [ "$RESTART_SERVICE" = "yes" ]; then
  echo "Restarting service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl --no-pager --lines=20 status "$SERVICE_NAME"
else
  echo "Service restart skipped."
fi

echo "Patch complete."
echo "Preserved: raw/, data/, .env"
echo "Backup: $BACKUP_FILE"
