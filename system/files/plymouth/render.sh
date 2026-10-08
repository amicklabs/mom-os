#!/bin/bash
# Renders the images in momos/ for the MomOS boot splash. Run it after
# changing a color or the wordmark, then commit the PNGs:
#
#   system/files/plymouth/render.sh [PREVIEW.png]
#
# With a file name it also writes a 1366x768 preview of the splash as it
# looks with the password prompt up. Needs ImageMagick 7 (magick) and
# Omarchy's Plymouth theme, for the password field.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out="$here/momos"
fonts="$here/../../../shell/fonts"

# The background is also set in momos.script and momos.plymouth; keep them in
# step. Warm near-black, with the wordmark in the paper color of her Morning
# theme.
bg='#1F1A16'
ink='#F2ECE2'
soft='#8C8174'

# "MOM OS" in Newsreader, the serif of her greeting and clock, letterspaced.
magick -background none -fill "$ink" -font "$fonts/Newsreader16pt-Regular.ttf" \
  -pointsize 132 -kerning 22 label:'MOM OS' -trim +repage \
  -bordercolor none -border 12 "$out/logo.png"

# The progress bar and its track, 300x6 with round ends.
magick -size 300x6 xc:none -fill "$soft" -draw 'roundrectangle 0,0 299,5 3,3' \
  -channel A -evaluate multiply 0.35 +channel "$out/progress_box.png"
magick -size 300x6 xc:none -fill "$ink" -draw 'roundrectangle 0,0 299,5 3,3' "$out/progress_bar.png"

# The password field, lock and bullets: Omarchy's (MIT), recolored the way
# omarchy-plymouth-set does it. Only snapshot boot entries made before the
# disk keyfile still ask for the passphrase.
omarchy=${OMARCHY_PLYMOUTH:-/usr/share/plymouth/themes/omarchy}
for f in entry lock bullet; do
  magick "$omarchy/$f.png" -channel RGB +level-colors "$ink,$ink" +channel "$out/$f.png"
done

if [[ -n ${1:-} ]]; then
  magick -size 1366x768 "xc:$bg" \
    "$out/logo.png" -gravity center -geometry +0-40 -composite \
    "$out/entry.png" -gravity center -geometry +0+70 -composite \
    \( "$out/lock.png" -resize x38 \) -gravity center -geometry -175+70 -composite \
    "$1"
fi
