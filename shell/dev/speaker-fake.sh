#!/usr/bin/env bash
# Fake `momctl speaker ...` for the momctl stubs, so the Speaker page can be
# tried without touching real Bluetooth. The scenario is in
# $MOMOS_DEV_DIR/speaker-scenario:
#
#   none      nothing saved; three speakers nearby in pairing mode (the default)
#   saved     Kitchen Speaker and Porch Speaker saved, neither connected
#   playing   the sound plays on Kitchen Speaker
#   computer  Kitchen Speaker is connected, the sound plays on the computer
#   silent    Carol's Soundbar is connected, but the sound stayed on the computer
#   off       no Bluetooth
#
# Connecting takes two seconds and moves to "playing"; Porch Speaker never
# answers, and Carol's Soundbar connects without sound ("silent"). `output`
# switches between "playing" and "computer", Disconnect moves to "saved",
# Forget to "none".
set -euo pipefail

dir="${MOMOS_DEV_DIR:-/tmp/momos-dev}"
mkdir -p "$dir"
scenario=$(cat "$dir/speaker-scenario" 2>/dev/null || echo none)

KITCHEN=11:22:33:44:55:66
PORCH=11:22:33:44:55:77
SOUNDBAR=AA:BB:CC:DD:EE:04
BUDS=AA:BB:CC:DD:EE:01

spk() { # address name kind saved connected output nearby signal
  printf '{"address":"%s","name":"%s","kind":"%s","saved":%s,"paired":%s,"connected":%s,"output":%s,"nearby":%s,"signal":%s}' \
    "$1" "$2" "$3" "$4" "$4" "$5" "$6" "$7" "$8"
}

list() {
  local scanning=$1 items=()
  case "$scenario" in
    none) ;;
    saved)
      items+=("$(spk $KITCHEN "Kitchen Speaker" speaker true false false false null)")
      items+=("$(spk $PORCH "Porch Speaker" speaker true false false false null)")
      ;;
    playing)
      items+=("$(spk $KITCHEN "Kitchen Speaker" speaker true true true false null)")
      items+=("$(spk $PORCH "Porch Speaker" speaker true false false false null)")
      ;;
    computer)
      items+=("$(spk $KITCHEN "Kitchen Speaker" speaker true true false false null)")
      items+=("$(spk $PORCH "Porch Speaker" speaker true false false false null)")
      ;;
    silent)
      items+=("$(spk $SOUNDBAR "Carol's Soundbar" speaker true true false false null)")
      ;;
  esac
  if [[ $scanning == yes ]]; then
    [[ $scenario == none ]] && items+=("$(spk $KITCHEN "Kitchen Speaker" speaker false false false true -48)")
    [[ $scenario == silent ]] || items+=("$(spk $SOUNDBAR "Carol's Soundbar" speaker false false false true -61)")
    items+=("$(spk $BUDS "Pixel Buds" headphones false false false true -70)")
  fi
  (IFS=,; echo "${items[*]}")
}

status() {
  local output='{"name":"Built-in Audio Analog Stereo","bluetooth":false,"address":null}'
  [[ $scenario == playing ]] && output="{\"name\":\"Kitchen Speaker\",\"bluetooth\":true,\"address\":\"$KITCHEN\"}"
  local adapter=on
  [[ $scenario == off ]] && adapter=none
  echo "{\"ok\":true,\"data\":{\"adapter\":\"$adapter\",\"output\":$output,\"speakers\":[$(list "$1")]}}"
}

name_of() {
  case "$1" in
    "$KITCHEN") echo "Kitchen Speaker" ;;
    "$PORCH") echo "Porch Speaker" ;;
    "$SOUNDBAR") echo "Carol's Soundbar" ;;
    "$BUDS") echo "Pixel Buds" ;;
    *) echo "" ;;
  esac
}

case "${1:-}" in
  "")
    status no
    ;;
  scan)
    if [[ $scenario == off ]]; then
      echo '{"ok":false,"error":"This computer has no Bluetooth.","reason":"no-bluetooth"}'
      exit 1
    fi
    sleep 2
    status yes
    ;;
  connect)
    sleep 2
    if [[ ${2:-} == "$PORCH" ]]; then
      echo '{"ok":false,"error":"Call failed: br-connection-page-timeout","reason":"connect"}'
      exit 1
    fi
    output=true
    if [[ ${2:-} == "$SOUNDBAR" ]]; then
      echo silent >"$dir/speaker-scenario"
      output=false
    else
      echo playing >"$dir/speaker-scenario"
    fi
    echo "{\"ok\":true,\"data\":{\"address\":\"${2:-}\",\"name\":\"$(name_of "${2:-}")\",\"connected\":true,\"paired\":true,\"output\":$output}}"
    ;;
  output)
    case "${2:-}" in
      computer) [[ $scenario == playing ]] && scenario=computer ;;
      "$KITCHEN") scenario=playing ;;
      *)
        echo '{"ok":false,"error":"no output for it","reason":"no-sound"}'
        exit 1
        ;;
    esac
    echo "$scenario" >"$dir/speaker-scenario"
    status no
    ;;
  disconnect)
    echo saved >"$dir/speaker-scenario"
    echo "{\"ok\":true,\"data\":{\"address\":\"${2:-}\",\"disconnected\":true}}"
    ;;
  forget)
    echo none >"$dir/speaker-scenario"
    echo "{\"ok\":true,\"data\":{\"address\":\"${2:-}\",\"forgotten\":true}}"
    ;;
  reconnect)
    echo '{"ok":true,"data":{"tried":[],"connected":null}}'
    ;;
  *)
    echo '{"ok":false,"error":"unknown speaker command","reason":"failed"}'
    exit 1
    ;;
esac
