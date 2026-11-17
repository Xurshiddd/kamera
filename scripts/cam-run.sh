#!/bin/sh
# =============================================================================
#  MediaMTX runOnInit o'rami:  sh /cam-run.sh <slug> ffmpeg <args...>
#
#  ffmpeg'ni ishga tushiradi va uning loglarini o'tkazib turadi. Kamera
#  login/parolni rad etsa (RTSP 401), MediaMTX odatdagidek bir necha soniyadan
#  keyin qayta urinadi — Hikvision esa bir necha xato logindan keyin kamerani
#  BLOKLAYDI. Shuning uchun 401 bo'lsa CAM_AUTH_WAIT soniya (sukut: 30 daqiqa)
#  kutamiz va /hls/.guard/<slug> belgisini qo'yamiz (service holat sahifasida
#  "parol noto'g'ri" deb ko'rsatadi).
#
#  MediaMTX buyruqni o'z jarayon guruhida ishga tushiradi va to'xtatganda butun
#  guruhga signal yuboradi — ffmpeg ham, sleep ham birga to'xtaydi.
# =============================================================================
slug="$1"
shift
dir=/hls/.guard
flag="$dir/$slug"
mkdir -p "$dir"
rm -f "$flag"

# Faqat stderr (loglar) quvurga; stdout ishlatilmaydi. -nostats bo'lishi shart
# (aks holda progress qatorlari \r bilan tugaydi va read ularni yig'ib boradi).
"$@" 2>&1 >/dev/null | while IFS= read -r line; do
  printf '%s\n' "$line" >&2
  case "$line" in
    *"401 Unauthorized"* | *"401 (Unauthorized)"*) : >"$flag" ;;
  esac
done

if [ -e "$flag" ]; then
  wait_s="${CAM_AUTH_WAIT:-1800}"
  echo "[cam-guard] $slug: kamera login/parolni rad etdi (401) — bloklanmasligi uchun ${wait_s} s qayta urinilmaydi" >&2
  sleep "$wait_s"
fi
