#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping macOS DMG Finder metadata on non-macOS host."
  exit 0
fi

if ! command -v SetFile >/dev/null 2>&1; then
  echo "SetFile is required to hide the .app extension in the DMG." >&2
  exit 1
fi

DMG_DIR="${1:-src-tauri/target/release/bundle/dmg}"
APP_NAME="${2:-Talktome Bridge.app}"

DMG_FILES=()
while IFS= read -r dmg_file; do
  DMG_FILES+=("$dmg_file")
done < <(find "$DMG_DIR" -maxdepth 1 -type f -name "*.dmg" | sort)
if [[ "${#DMG_FILES[@]}" -eq 0 ]]; then
  echo "No DMG found in $DMG_DIR" >&2
  exit 1
fi

DMG_PATH="${DMG_FILES[$((${#DMG_FILES[@]} - 1))]}"
TMP_DIR="$(mktemp -d)"
RW_DMG="$TMP_DIR/editable.dmg"
FIXED_DMG="$TMP_DIR/fixed.dmg"
MOUNT_POINT="$TMP_DIR/mount"
mkdir -p "$MOUNT_POINT"

cleanup() {
  if mount | grep -q "on $MOUNT_POINT "; then
    hdiutil detach "$MOUNT_POINT" >/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Hiding .app extension in $(basename "$DMG_PATH")"
hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" >/dev/null

hdiutil attach -readwrite -nobrowse -mountpoint "$MOUNT_POINT" "$RW_DMG" >/dev/null

if [[ ! -d "$MOUNT_POINT/$APP_NAME" ]]; then
  echo "$APP_NAME not found in DMG." >&2
  exit 1
fi

SetFile -a E "$MOUNT_POINT/$APP_NAME"
hdiutil detach "$MOUNT_POINT" >/dev/null

hdiutil convert "$RW_DMG" -format UDZO -o "$FIXED_DMG" >/dev/null
mv "$FIXED_DMG" "$DMG_PATH"
echo "Updated $DMG_PATH"
