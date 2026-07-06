# MediaMTX + NVENC (NVIDIA GPU) ffmpeg.
# mediamtx binarni rasmiy image'dan olamiz, uni NVENC'li ffmpeg image'iga qo'yamiz.
# Shunda mediamtx'ning runOnInit ffmpeg'i GPU (h264_nvenc, scale_npp, NVDEC) ishlatadi.

FROM bluenviron/mediamtx:latest-ffmpeg AS mtx

FROM jrottenberg/ffmpeg:6.1-nvidia2204
# mediamtx (static Go binar) — NVENC ffmpeg image ustiga
COPY --from=mtx /mediamtx /usr/local/bin/mediamtx

# mediamtx runOnInit "ffmpeg ..." ni PATH'dan topadi (bu image'da /usr/local/bin/ffmpeg = NVENC'li)
ENTRYPOINT ["/usr/local/bin/mediamtx"]
CMD ["/mediamtx.yml"]
