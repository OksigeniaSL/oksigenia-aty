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
# The app signs in through its URL scheme with the token, and each scene opens with an app link
# (oksigeniaaty://link=...), so nothing is typed. The simulator of the runner is slow (no GPU), so nothing goes by the
# clock: after each link the screen is read again and again with macOS's text recognition (scripts/oksigenia-ocr.swift;
# the app is web content, which the accessibility tree does not show) until the scene's own text is there, and whatever
# stands in between is answered with idb: iOS's «Abrir» each time a link opens the app, and the app's «Abrir el sitio»
# before it adds a site. A scene that never comes is still shot as the screen stands, and the script fails at the end.
set -uo pipefail
OUT=${OUT:-dist/store}
LOGS=$(dirname "$OUT")/logs
mkdir -p "$OUT" "$LOGS"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
FAILED=0
log() { echo "$(date -u +%T) $*"; }

OCR=$(mktemp -d)/ocr
swiftc -O "$(dirname "$0")/oksigenia-ocr.swift" -o "$OCR" || exit 1
SCREEN=$(mktemp -d)/screen.png

# The demo's dates and hours are Canary time; the simulator takes the host's zone when it boots.
sudo systemsetup -settimezone Atlantic/Canary > /dev/null 2>&1 || log "Time zone not set"

RUNTIME=$(xcrun simctl list runtimes --json | jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | last.identifier')
TYPE=$(xcrun simctl list devicetypes --json | jq -r '[.devicetypes[] | select(.name | test("^iPhone 1[6-9] Pro Max$"))] | last.identifier')
DEV=$(xcrun simctl create "Aty store" "$TYPE" "$RUNTIME")
log "Device: $TYPE on $RUNTIME"

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
    --setPermissions 'notifications=YES' || log "Notifications not granted beforehand"
fi

idb_companion --udid "$DEV" > "$LOGS/idb-companion.log" 2>&1 &
sleep 8
idb connect localhost 10882 > /dev/null

# reach TEXT SECONDS: reads the screen until TEXT is on it, answering iOS's «Abrir» and the app's «Abrir el sitio» on the
# way, and waiting while «Cargando» is shown. Those go first: the scene's text may already be on the screen beneath them.
# Returns 1 if TEXT never comes.
reach() {
  local want=$1 until=$((SECONDS + $2)) hit
  while (( SECONDS < until )); do
    if xcrun simctl io "$DEV" screenshot "$SCREEN" > /dev/null 2>&1 \
      && hit=$("$OCR" "$SCREEN" "=Abrir" "Abrir el sitio" "Cargando" "$want"); then
      # shellcheck disable=SC2086
      set -- $hit
      case $1 in
        4) return 0 ;;
        3) ;;
        *) log "tapping «$([ "$1" = 1 ] && echo Abrir || echo 'Abrir el sitio')»"
           idb ui tap $(($2 / 3)) $(($3 / 3))      # the screenshot is at 3x; idb taps in points
           sleep 3 ;;
      esac
    fi
    sleep 2
  done
  return 1
}

# scene NAME URL TEXT: opens the URL (none for the first screen) and, once the scene's TEXT is there, lets images and
# fonts settle and takes the screenshot.
scene() {
  local pid=
  if [ -n "$2" ]; then
    # simctl openurl waits until iOS's prompt is answered, so it runs in the background while reach() answers it.
    xcrun simctl openurl "$DEV" "$2" > /dev/null 2>&1 &
    pid=$!
    sleep 5                                     # the previous screen may hold the next scene's text
  fi
  if reach "$3" 420; then
    log "$1: «$3» on the screen"
    sleep 8
  else
    log "$1: «$3» never came"
    FAILED=1
  fi
  xcrun simctl io "$DEV" screenshot "$OUT/$1.png" > /dev/null
  [ -z "$pid" ] || wait "$pid" 2> /dev/null || true
}

link() { echo "oksigeniaaty://link=$SITE$1"; }

# 3. The first screen: connect to your platform, with the QR button.
xcrun simctl launch "$DEV" "$BUNDLE_ID" > /dev/null
scene qr "" "Escanear código QR"

# 1. Signed in with the token: the app asks before adding the site, then lands on the site's home.
scene inicio "oksigeniaaty://$SITE?token=$TOKEN&privatetoken=$PRIVATETOKEN" "Hola"

# 6. The courses: the home no longer ends with course cards (Aty plugin 0.5.60, the home of 13 November 2026), so the
# scene is the app's «Mis cursos» page, opened by its link.
scene cursos "$(link /my/courses.php)" "Mis cursos"

# 2. A course in the centre's colours; 4. the notifications; 5. the month.
scene marca "$(link "/course/view.php?id=$COURSE")" "Participantes"
scene avisos "$(link /message/output/popup/notifications.php)" "Notificaciones"
scene agenda "$(link "/calendar/view.php?view=month")" "Calendario"

for f in "$OUT"/*.png; do log "$(basename "$f"): $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"; done
xcrun simctl shutdown "$DEV" || true
xcrun simctl delete "$DEV" || true
exit "$FAILED"
