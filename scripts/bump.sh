#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/bump.sh <version>"
  echo "Example: ./scripts/bump.sh 0.2.0"
  exit 1
fi

VERSION="$1"

# Update tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json

# Update Cargo.toml
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

# Update Cargo.lock
(cd src-tauri && cargo update -p floaty-mcfloatface 2>/dev/null || true)

echo "Bumped to v${VERSION}"
echo ""
echo "Next steps:"
echo "  git add -A && git commit -m \"chore: bump version to ${VERSION}\""
echo "  git tag v${VERSION}"
echo "  git push origin main --tags"
