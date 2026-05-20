#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(pwd)"
SERVICE_NAME="eda-tools-reader"
RESTART_SERVICE="auto"
RUN_REINDEX="false"
INSTALL_DEPS="true"
PACKAGE=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/upgrade.sh <release.tar.gz> [options]

Options:
  --app-dir DIR          Project directory to upgrade. Default: current directory.
  --service NAME         systemd service name. Default: eda-tools-reader.
  --restart              Restart service after upgrade.
  --no-restart           Do not restart service.
  --reindex              Run python server.py --reindex after upgrade.
  --skip-deps            Skip pip install. Use when dependencies are already installed.
  -h, --help             Show help.

The upgrade preserves raw/, data/, .env, .venv, backups/, and dist/.
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
    --reindex)
      RUN_REINDEX="true"
      shift
      ;;
    --skip-deps)
      INSTALL_DEPS="false"
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
        echo "Only one release package can be provided." >&2
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
  echo "Release package not found: $PACKAGE" >&2
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

echo "Extracting release package..."
tar -xzf "$PACKAGE" -C "$TMP_DIR"

if [ -d "$TMP_DIR/eda-tools-reader" ]; then
  RELEASE_DIR="$TMP_DIR/eda-tools-reader"
else
  RELEASE_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
fi

if [ ! -f "$RELEASE_DIR/server.py" ]; then
  echo "Invalid release package: server.py not found." >&2
  exit 1
fi

mkdir -p "$APP_DIR/backups"
BACKUP_FILE="$APP_DIR/backups/pre-upgrade-$(date +%Y%m%d-%H%M%S).tar.gz"

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

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

if [ "$INSTALL_DEPS" = "true" ]; then
  echo "Installing Python dependencies..."
  .venv/bin/python -m pip install -r "$RELEASE_DIR/requirements.txt"
else
  echo "Dependency installation skipped."
fi

echo "Updating application code..."
copy_item() {
  local item="$1"
  if [ -e "$RELEASE_DIR/$item" ]; then
    rm -rf "$APP_DIR/$item"
    cp -R "$RELEASE_DIR/$item" "$APP_DIR/$item"
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

rm -f "$APP_DIR/Dockerfile" "$APP_DIR/docker-compose.yml"
chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true

echo "Checking Python syntax..."
.venv/bin/python -m py_compile server.py

if [ "$RUN_REINDEX" = "true" ]; then
  echo "Rebuilding index..."
  .venv/bin/python server.py --reindex
fi

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

echo "Upgrade complete."
echo "Preserved: raw/, data/, .env"
echo "Backup: $BACKUP_FILE"
