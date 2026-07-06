// MediaMTX HTTP API bilan ishlovchi klient.
// Kamera qo'shilganda "shu RTSP manzilni shu nom (slug) ostida tort" deymiz,
// o'chirilganda esa yo'lni olib tashlaymiz.

const API = process.env.MEDIAMTX_API || "http://127.0.0.1:9997";

// RTSP manzilini login/parol bilan yasaymiz.
// Diqqat: bu manzil faqat server ichida qoladi, tashqariga CHIQMAYDI.
export function buildRtspSource(c) {
  return `rtsp://${encodeURIComponent(c.login)}:${encodeURIComponent(
    c.parol
  )}@${c.ip}:${c.port}/${c.rtsp_path}`;
}

// Ko'p IP-kameralar H265 (HEVC) beradi. Brauzerlar esa HLS orqali H265'ni
// o'ynata olmaydi. Shu sabab MediaMTX ichidagi ffmpeg bilan H264'ga o'giramiz.
// Bu "runOnDemand" — faqat kimdir ko'rganda ishlaydi, hech kim ko'rmasa to'xtaydi.
//
// Diqqat: ffmpeg MediaMTX'ning O'ZIGA (localhost:8554) qayta nashr qiladi, shu
// sabab MediaMTX image'ida ffmpeg bo'lishi shart (bluenviron/mediamtx:*-ffmpeg).
function buildTranscodeCmd(camera) {
  const source = buildRtspSource(camera);
  const out = `rtsp://localhost:8554/${camera.slug}`;
  // NVIDIA GPU (RTX 3070) pipeline: NVDEC dekod -> scale_npp (GPU) -> h264_nvenc.
  // CPU deyarli bo'sh qoladi (dekod+scale+enkod hammasi GPU'da).
  return (
    // -hwaccel cuda: HEVC/H264 dekodni GPU (NVDEC)'da, kadrlar GPU xotirasida qoladi.
    // +genpts: buzuq timestamp'larni qayta hosil qilamiz (HLS "gap"ni oldini oladi).
    `ffmpeg -hwaccel cuda -hwaccel_output_format cuda -rtsp_transport tcp -fflags +genpts -i "${source}" ` +
    // GPU'da 720p ga kichraytirish (scale_npp = NVIDIA NPP filtri).
    `-vf scale_npp=-2:720 ` +
    // NVENC (GPU) enkod. p4 preset + ll (low-latency) + high profil + cq 24 (sifat).
    `-c:v h264_nvenc -preset p4 -tune ll -profile:v high -rc vbr -cq 24 ` +
    // Doimiy 15fps + har 2s (30 kadr) da keyframe -> teng HLS segmentlari, "gap" yo'q.
    `-r 15 -g 30 -force_key_frames "expr:gte(t,n_forced*2)" ` +
    // Ovoz: kamera G.711 -> AAC (HLS + barcha brauzerlar uchun). Ovoz bo'lmasa zararsiz.
    `-c:a aac -b:a 128k -ar 48000 ` +
    `-f rtsp "${out}"`
  );
}

export async function addPath(camera) {
  const res = await fetch(`${API}/v3/config/paths/add/${camera.slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Always-on: yo'l yaratilishi bilan ffmpeg ishga tushadi va DOIM ishlab
      // turadi (kimdir ko'radimi-yo'qmi — farqi yo'q). Shu sabab "Jonli ko'rish"
      // bosilishi bilan oqim DARROV ochiladi (sovuq start / kutish yo'q).
      // Kamchilik: har bir kamera 24/7 transkod bo'ladi -> doimiy CPU yuki.
      runOnInit: buildTranscodeCmd(camera),
      runOnInitRestart: true, // ffmpeg yiqilsa/kamera uzilsa — qayta ishga tushadi
    }),
  });
  // Yo'l allaqachon bor bo'lsa MediaMTX xato beradi — buni e'tiborsiz qoldiramiz.
  if (!res.ok && res.status !== 400) {
    throw new Error(`MediaMTX addPath xato: ${res.status}`);
  }
}

export async function deletePath(slug) {
  await fetch(`${API}/v3/config/paths/delete/${slug}`, {
    method: "DELETE",
  }).catch(() => {});
}
