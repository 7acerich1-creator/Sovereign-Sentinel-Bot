#!/bin/bash
# Prepare Gravity Claw for Railway deployment
# This copies Maven Crew into the build context so Docker can access it

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAVEN_SRC="$SCRIPT_DIR/../../maven_crew"
MAVEN_DEST="$SCRIPT_DIR/maven_crew"

echo "⚡ Preparing Gravity Claw deploy..."

# Copy Maven Crew into build context
if [ -d "$MAVEN_SRC" ]; then
  echo "📦 Copying Maven Crew into build context..."
  rm -rf "$MAVEN_DEST"
  cp -r "$MAVEN_SRC" "$MAVEN_DEST"
  # Remove __pycache__ and .env from the copy
  find "$MAVEN_DEST" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
  rm -f "$MAVEN_DEST/.env" 2>/dev/null || true
  echo "✅ Maven Crew staged."
else
  echo "⚠️  Maven Crew not found at $MAVEN_SRC — deploying bot-only."
  mkdir -p "$MAVEN_DEST"
fi

# Typecheck
echo "🔍 Running typecheck..."
cd "$SCRIPT_DIR"
npx tsc --noEmit

echo "🚀 Ready for: railway up --detach"
