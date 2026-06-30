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
    `ffmpeg -rtsp_transport tcp -i "${source}" ` +
    // H264 + baseline/yuv420p = barcha brauzerlarda o'ynaydi
    `-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p ` +
    `-an ` + // audio'siz (G711 baribir HLS'da ishlamaydi, soddaroq va yengilroq)
    `-f rtsp "${out}"`
  );
}

export async function addPath(camera) {
  const res = await fetch(`${API}/v3/config/paths/add/${camera.slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runOnDemand: buildTranscodeCmd(camera),
      runOnDemandRestart: true,
      runOnDemandStartTimeout: "15s", // ffmpeg + kamera ulanishi uchun
      runOnDemandCloseAfter: "10s", // hech kim ko'rmasa 10s da to'xtaydi
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
