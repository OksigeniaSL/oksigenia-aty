#!/bin/bash
# Tests of the notification service extension (resources/ios/NotificationService): the C sealed box against libsodium,
# with random boxes that PyNaCl makes on the spot, and the Swift handling of the notices of Tests/notices.json. On a Mac
# (the CI runs it in oksigenia-ios.yml) or on Linux with Swift.
#
#   bash scripts/oksigenia-nse-tests.sh
#
# Needs a C compiler, swiftc and Python 3; PyNaCl goes into a throwaway virtual environment if Python lacks it.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=resources/ios/NotificationService
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PYTHON=${PYTHON:-python3}
if ! "$PYTHON" -c 'import nacl' 2> /dev/null; then
    "$PYTHON" -m venv "$WORK/venv"
    "$WORK/venv/bin/pip" install --quiet pynacl
    PYTHON="$WORK/venv/bin/python"
fi

CC=${CC:-cc}
# Out-of-bounds reads and undefined behaviour fail the test, not only wrong results.
read -r -a SANITIZE <<< "${SANITIZE:--fsanitize=address,undefined -fno-sanitize-recover=all}"
"$CC" -std=c99 -O1 -g -Wall -Wextra -Werror "${SANITIZE[@]}" -I"$DIR" \
    "$DIR/AtySealedBox.c" "$DIR/Tests/sealed_box_test.c" -o "$WORK/sealed-box-test"
"$PYTHON" "$DIR/Tests/make-vectors.py" 300 > "$WORK/vectors.txt"
"$WORK/sealed-box-test" < "$WORK/vectors.txt"

"$CC" -std=c99 -O2 -Wall -Wextra -Werror -c "$DIR/AtySealedBox.c" -o "$WORK/AtySealedBox.o"
swiftc -O -warnings-as-errors -import-objc-header "$DIR/AtySealedBox.h" \
    "$DIR/AtyNotice.swift" "$DIR/Tests/main.swift" "$WORK/AtySealedBox.o" -o "$WORK/notice-tests"
"$WORK/notice-tests" "$DIR/Tests/notices.json"
