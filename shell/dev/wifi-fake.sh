#!/usr/bin/env bash
# Fake `momctl wifi ...` for the momctl stubs, so the Internet connection
# page can be tried without touching real networks. The scenario is in
# $MOMOS_DEV_DIR/wifi-scenario:
#
#   home     connected to "Smith Home" (the default)
#   away     not connected, networks nearby
#   portal   connected to "Harbor Hotel Guest", which wants a sign-in
#
# A password with "wrong" in it fails like a wrong password; anything else
# joins after two seconds.
set -euo pipefail

dir="${MOMOS_DEV_DIR:-/tmp/momos-dev}"
scenario=$(cat "$dir/wifi-scenario" 2>/dev/null || echo home)

current=null
conn=full
inuse_home=false
inuse_hotel=false
case "$scenario" in
  home) current='{"name":"Smith Home","signal":82,"strength":"strong"}'; inuse_home=true ;;
  away) conn=none ;;
  portal) current='{"name":"Harbor Hotel Guest","signal":64,"strength":"good"}'; conn=portal; inuse_hotel=true ;;
esac

net() { # name signal strength kind known inUse
  printf '{"name":"%s","signal":%s,"strength":"%s","kind":"%s","secure":%s,"known":%s,"inUse":%s}' \
    "$1" "$2" "$3" "$4" "$([[ $4 == open ]] && echo false || echo true)" "$5" "$6"
}

case "${1:-}" in
  "")
    echo "{\"ok\":true,\"data\":{\"connectivity\":\"$conn\",\"wifi\":{\"ssid\":null,\"signal\":null,\"device\":\"wlan0\"},\"devices\":[]}}"
    ;;
  scan)
    [[ ${2:-} == --fresh ]] && sleep 2
    nets=(
      "$(net "Smith Home" 82 strong password true "$inuse_home")"
      "$(net "Harbor Hotel Guest" 64 good open true "$inuse_hotel")"
      "$(net "Ann's iPhone" 71 strong password false false)"
      "$(net "Carol and Jim" 48 good password false false)"
      "$(net "Library Free WiFi" 30 weak open false false)"
    )
    if [[ $scenario == portal ]]; then
      nets=("${nets[1]}" "${nets[0]}" "${nets[2]}" "${nets[3]}" "${nets[4]}")
    fi
    list=$(IFS=,; echo "${nets[*]}")
    echo "{\"ok\":true,\"data\":{\"connectivity\":\"$conn\",\"portal\":$([[ $conn == portal ]] && echo true || echo false),\"radio\":true,\"device\":\"wlan0\",\"current\":$current,\"networks\":[$list]}}"
    ;;
  connect)
    password=""
    if [[ " $* " == *" --password-stdin "* ]]; then IFS= read -r password || true; fi
    sleep 2
    if [[ $password == *wrong* ]]; then
      echo '{"ok":false,"error":"Secrets were required, but not provided.","reason":"password"}'
      exit 1
    fi
    echo "{\"ok\":true,\"data\":{\"connected\":true,\"name\":\"$2\",\"saved\":true,\"connectivity\":\"$conn\",\"portal\":$([[ $conn == portal ]] && echo true || echo false)}}"
    ;;
  forget)
    echo "{\"ok\":true,\"data\":{\"forgotten\":\"$2\",\"profiles\":1}}"
    ;;
  portal)
    echo "{\"ok\":true,\"data\":{\"connectivity\":\"$conn\",\"portal\":$([[ $conn == portal ]] && echo true || echo false)}}"
    ;;
  *)
    echo '{"ok":false,"error":"unknown wifi command","reason":"failed"}'
    exit 1
    ;;
esac
