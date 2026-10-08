#!/usr/bin/env bash
# Writes a fake state.json for one scenario, the way momd would (temp file,
# then rename).
#
#   dev/state.sh normal|offline|viewer|control|message|sending|sent|failed|charging|
#                low|trouble|today|reminder|unread|stale|none
#
# today: two reminders later today, for the home screen card.
# reminder: the same, plus one due now.
# unread: 3 unread Telegram messages, for the badge on the Telegram tile.
# low: the battery at 12%, not charging. trouble: that, and no internet.
#
# dev/run.sh rewrites the last scenario every 10 seconds so it stays fresh.
set -euo pipefail

dir="${MOMOS_DEV_DIR:-/tmp/momos-dev}"
file="$dir/state.json"
mkdir -p "$dir"

now=$(($(date +%s) * 1000))
updated=$now
online=true
viewer=false
control=false
help='{"status":"idle","at":null}'
banner=null
battery='{"percent":64,"charging":false}'
reminders='{"today":[],"due":[]}'
telegram=""

# A reminder item the way momd writes it: reminder ID AT TEXT
reminder_item() {
  jq -cn --arg id "$1" --argjson at "$2" --arg text "$3" --arg label "$(date -d "@$(($2 / 1000))" '+%-I:%M %p')" \
    '{key: "\($id)@\($at)", id: $id, at: $at, label: $label, text: $text}'
}
today_list() {
  echo "[$(reminder_item doctor $((now + 2 * 3600000)) "Doctor appointment"),$(reminder_item pills $((now + 5 * 3600000)) "Take your evening pills")]"
}

scenario="${1:-normal}"
echo "$scenario" >"$dir/scenario"

case "$scenario" in
  normal) ;;
  offline) online=false ;;
  viewer) viewer=true ;;
  control) viewer=true; control=true ;;
  message) banner='{"id":"m1","kind":"message","text":"Sam says: I will call you in five minutes.","until":null}' ;;
  sending) help="{\"status\":\"sending\",\"at\":$now}" ;;
  sent) help="{\"status\":\"sent\",\"at\":$now}" ;;
  failed) help="{\"status\":\"failed\",\"at\":$now}" ;;
  charging) battery='{"percent":80,"charging":true}' ;;
  low) battery='{"percent":12,"charging":false}' ;;
  trouble) online=false; battery='{"percent":12,"charging":false}' ;;
  today) reminders="{\"today\":$(today_list),\"due\":[]}" ;;
  reminder) reminders="{\"today\":$(today_list),\"due\":[$(reminder_item call "$now" "Call Grace for her birthday")]}" ;;
  unread) telegram=',
  "telegram": { "unread": 3 }' ;;
  stale) updated=$((now - 120000)) ;;
  none) rm -f "$file"; exit 0 ;;
  *) echo "unknown scenario: $1" >&2; exit 2 ;;
esac

cat >"$file.tmp" <<EOF
{
  "version": 1,
  "updatedAt": $updated,
  "online": $online,
  "wifi": { "ssid": "Home", "signal": 70 },
  "battery": $battery,
  "viewer": { "connected": $viewer, "since": null, "control": $control },
  "help": $help,
  "banner": $banner,
  "lid": { "closed": false },
  "convex": "connected",
  "reminders": $reminders$telegram
}
EOF
mv "$file.tmp" "$file"
