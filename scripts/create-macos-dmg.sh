#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-}"
app_name="${2:-}"
dmg_name="${3:-}"
volume_icon="${4:-}"

if [[ -z "$release_dir" || -z "$app_name" || -z "$dmg_name" ]]; then
  echo "Usage: scripts/create-macos-dmg.sh <releaseDir> <appName> <dmgName> [volumeIcon]" >&2
  exit 1
fi

if [[ ! -d "$release_dir/$app_name.app" ]]; then
  echo "Missing app bundle: $release_dir/$app_name.app" >&2
  exit 1
fi

if [[ -n "$volume_icon" && ! -f "$volume_icon" ]]; then
  echo "Missing DMG volume icon: $volume_icon" >&2
  exit 1
fi

staging_dir="$(mktemp -d)"
content_dir="$staging_dir/content"
mount_dir="$staging_dir/mount"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_dir" >/dev/null || true
  fi
  rm -rf "$staging_dir"
}
trap cleanup EXIT

mkdir -p "$content_dir"
cp -R "$release_dir/$app_name.app" "$content_dir/"
ln -s /Applications "$content_dir/Applications"
if [[ -n "$volume_icon" ]]; then
  cp "$volume_icon" "$content_dir/.VolumeIcon.icns"
fi
rm -f "$dmg_name"

if [[ -z "$volume_icon" ]]; then
  hdiutil create -volname "$app_name" -srcfolder "$content_dir" -ov -format UDZO "$dmg_name"
  exit 0
fi

if ! command -v SetFile >/dev/null 2>&1; then
  echo "SetFile is required to set the DMG volume icon." >&2
  exit 1
fi

writable_dmg="$staging_dir/editable.dmg"
hdiutil create -volname "$app_name" -srcfolder "$content_dir" -ov -format UDRW "$writable_dmg"
mkdir -p "$mount_dir"
hdiutil attach -readwrite -nobrowse -mountpoint "$mount_dir" "$writable_dmg" >/dev/null
mounted=true
SetFile -a C "$mount_dir"
hdiutil detach "$mount_dir" >/dev/null
mounted=false
hdiutil convert "$writable_dmg" -format UDZO -o "$dmg_name" >/dev/null
