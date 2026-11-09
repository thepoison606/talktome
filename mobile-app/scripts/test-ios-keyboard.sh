#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
xcrun swiftc modules/ptt-hardware/ios/TalkToMeKeyboardKey.swift scripts/tests/keyboard.swift -o "$test_dir/keyboard-test"
"$test_dir/keyboard-test"
