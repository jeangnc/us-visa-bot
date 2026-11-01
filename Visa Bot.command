#!/bin/zsh
# macOS: double-click in Finder to open the Visa Bot dashboard (starts it if needed).
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "  Node.js isn't installed — get it from https://nodejs.org and try again."; exit 1; }
[ -d node_modules ] || npm install --silent
node scripts/launch.js
