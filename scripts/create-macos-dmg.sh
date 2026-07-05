#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-}"
app_name="${2:-}"
dmg_name="${3:-}"

if [[ -z "$release_dir" || -z "$app_name" || -z "$dmg_name" ]]; then
  echo "Usage: scripts/create-macos-dmg.sh <releaseDir> <appName> <dmgName>" >&2
  exit 1
fi

if [[ ! -d "$release_dir/$app_name.app" ]]; then
  echo "Missing app bundle: $release_dir/$app_name.app" >&2
  exit 1
fi

staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

cp -R "$release_dir/$app_name.app" "$staging_dir/"
ln -s /Applications "$staging_dir/Applications"
rm -f "$dmg_name"

hdiutil create \
  -volname "$app_name" \
  -srcfolder "$staging_dir" \
  -ov \
  -format UDZO \
  "$dmg_name"
