#!/bin/bash
# App Store screenshots of Oksigenia Aty: the same six scenes as the Google Play listing, on a 6.9" iPhone simulator
# (1320 x 2868) set to Spanish, Canary time and light appearance, against a demo site with made-up data.
#
# Run by oksigenia-ios.yml when it is started by hand with a site. Environment:
#   APP           the built .app
#   SITE          https address of the demo site
#   COURSE        id of the course shown in the second scene
#   TOKEN         mobile token of the demo user, and PRIVATETOKEN its private token (repository secrets)
#   OUT           where the screenshots go (dist/store)
#
# The app signs in through its URL scheme with the token, then each scene is opened with an app link
# (oksigeniaaty://link=...), so nothing is typed. The only tap is the app's own confirmation before adding the site,
# done with idb by the button's label. A scene that does not appear leaves the screen as it was and an accessibility dump
# in the logs, and the script fails at the end.
set -uo pipefail
OUT=${OUT:-dist/store}
LOGS=$(dirname "$OUT")/logs
mkdir -p "$OUT" "$LOGS"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
FAILED=0

# The demo's dates and hours are Canary time; the simulator takes the host's zone when it boots.
sudo systemsetup -settimezone Atlantic/Canary > /dev/null 2>&1 || echo "Time zone not set"

RUNTIME=$(xcrun simctl list runtimes --json | jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | last.identifier')
TYPE=$(xcrun simctl list devicetypes --json | jq -r '[.devicetypes[] | select(.name | test("^iPhone 1[6-9] Pro Max$"))] | last.identifier')
DEV=$(xcrun simctl create "Aty store" "$TYPE" "$RUNTIME")
echo "Device: $TYPE on $RUNTIME ($DEV)"

xcrun simctl boot "$DEV"
xcrun simctl bootstatus "$DEV" -b > /dev/null
xcrun simctl spawn "$DEV" defaults write 'Apple Global Domain' AppleLanguages -array es-ES
xcrun simctl spawn "$DEV" defaults write 'Apple Global Domain' AppleLocale -string es_ES
xcrun simctl shutdown "$DEV"
xcrun simctl boot "$DEV"
xcrun simctl bootstatus "$DEV" -b > /dev/null
xcrun simctl ui "$DEV" appearance light
xcrun simctl status_bar "$DEV" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

xcrun simctl install "$DEV" "$APP"
if command -v applesimutils > /dev/null; then
  perl -e 'alarm shift; exec @ARGV' 180 applesimutils --byId "$DEV" --bundle "$BUNDLE_ID" \
    --setPermissions 'notifications=YES' || echo "Notifications not granted beforehand"
fi

idb_companion --udid "$DEV" > "$LOGS/idb-companion.log" 2>&1 &
sleep 8
idb connect localhost 10882 > /dev/null

# The accessibility tree of the screen, as JSON.
describe() { idb ui describe-all --json 2> /dev/null; }

# Prints the centre "x y" of the first element whose label or value contains the text, or nothing.
find_text() {
  describe | python3 -c '
import json, sys
want = sys.argv[1].lower()
raw = sys.stdin.read().strip()
try:
    items = json.loads(raw)
except ValueError:
    items = [json.loads(l) for l in raw.splitlines() if l.strip().startswith("{")]
if isinstance(items, dict):
    items = [items]
for e in items:
    text = " ".join(str(e.get(k) or "") for k in ("AXLabel", "AXValue", "title", "label")).lower()
    f = e.get("frame") or {}
    if want in text and f.get("width"):
        print(round(f["x"] + f["width"] / 2), round(f["y"] + f["height"] / 2))
        break
' "$1"
}

# Waits up to $2 seconds for the text; returns 1 if it never shows.
wait_text() {
  local until=$((SECONDS + $2))
  while (( SECONDS < until )); do
    [ -n "$(find_text "$1")" ] && return 0
    sleep 2
  done
  return 1
}

tap_text() {
  local at
  wait_text "$1" "$2" || return 1
  at=$(find_text "$1")
  # shellcheck disable=SC2086
  idb ui tap $at
}

# shot NAME TEXT SECONDS: once TEXT is on the screen, lets images and fonts settle and takes the screenshot.
shot() {
  if wait_text "$2" "$3"; then
    sleep 6
  else
    echo "$1: «$2» did not appear"
    describe > "$LOGS/store-$1.json"
    FAILED=1
  fi
  xcrun simctl io "$DEV" screenshot "$OUT/$1.png" > /dev/null
}

open_link() {
  xcrun simctl openurl "$DEV" "oksigeniaaty://link=$SITE$1"
}

# 3. The first screen: connect to your platform, with the QR button.
xcrun simctl launch "$DEV" "$BUNDLE_ID" > /dev/null
shot qr "QR" 120

# 1. Signed in with the token: the app asks before adding a site, then lands on the site's home.
xcrun simctl openurl "$DEV" "oksigeniaaty://$SITE?token=$TOKEN&privatetoken=$PRIVATETOKEN"
tap_text "Abrir el sitio" 60 || { echo "No confirmation to tap"; describe > "$LOGS/store-confirm.json"; }
shot inicio "Hola" 120

# 2. A course in the centre's colours.
open_link "/course/view.php?id=$COURSE"
shot marca "Módulo 1" 60

# 4. The notifications.
open_link "/message/output/popup/notifications.php"
shot avisos "Notificaciones" 60

# 5. The month in the calendar.
open_link "/calendar/view.php?view=month"
shot agenda "Calendario" 60

# 6. My courses.
open_link "/my/courses.php"
shot cursos "Mis cursos" 60

xcrun simctl spawn "$DEV" log show --last 15m --style compact --predicate 'process CONTAINS "Oksigenia"' \
  > "$LOGS/store-app.log" 2> /dev/null || true
for f in "$OUT"/*.png; do echo "$(basename "$f"): $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"; done
xcrun simctl shutdown "$DEV" || true
xcrun simctl delete "$DEV" || true
exit "$FAILED"
