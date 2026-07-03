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
  return (
    // +genpts: kamera timestamp'lari buzuq/uzuq bo'lsa ham qayta hosil qilamiz —
    // aks holda HLS segmentlari orasida "gap" bo'lib, pleyer qotib qoladi.
    `ffmpeg -rtsp_transport tcp -fflags +genpts -i "${source}" ` +
    // Main stream (masalan 3200x1800) web uchun juda og'ir (~2 yadro/kamera).
    // 720p ga kichraytiramiz: kuzatuv uchun yetarli sifat, eng yengil CPU.
    // -2 = enni nisbatga qarab avtomatik (juft songa yaxlitlab).
    `-vf scale=-2:720 ` +
    // H264 high profil + CRF 20 = sifatli tasvir (barcha zamonaviy brauzerlar
    // "high" profilni o'ynaydi). veryfast = ultrafast'dan ancha sifatli, lekin
    // hali ham tez. -crf 20 = ko'zga sifatli (kichik son = yuqori sifat).
    `-c:v libx264 -preset veryfast -tune zerolatency -profile:v high -pix_fmt yuv420p -crf 20 ` +
    // Doimiy 15fps (CFR) + har 2s (30 kadr) da keyframe: MediaMTX toza, teng
    // segmentlar yasaydi -> "fragGap" yo'qoladi, efir darrov ochiladi.
    `-r 15 -g 30 -keyint_min 30 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*2)" ` +
    `-an ` + // audio'siz (G711 baribir HLS'da ishlamaydi, soddaroq va yengilroq)
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
