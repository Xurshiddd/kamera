import db from "./db.js";
import { addPath, probeCodec } from "./mediamtx.js";

// MediaMTX'ga API orqali qo'shilgan yo'llar u qayta ishga tushganda yo'qoladi.
// Shuning uchun service ishga tushganda DB'dagi hamma kamerani qaytadan push qilamiz.
//
// Ayni paytda har kameraning VIDEO kodegini qayta aniqlaymiz (kamera sozlamasi
// o'zgargan bo'lishi mumkin): H264 bo'lsa transkod qilinmaydi (CPU ~0),
// H265 bo'lsa H264 ga o'giriladi (brauzer H265 o'ynay olmaydi).
export async function syncCameras() {
  const cameras = db.prepare("SELECT * FROM cameras").all();
  const update = db.prepare("UPDATE cameras SET codec = ? WHERE id = ?");

  // Kodeklarni PARALLEL aniqlaymiz — ketma-ket bo'lsa 8 kamera bir necha daqiqa
  // kutilardi (har biriga 15s gacha timeout).
  await Promise.all(
    cameras.map(async (c) => {
      const codec = await probeCodec(c);
      if (codec && codec !== c.codec) update.run(codec, c.id);
      if (codec) c.codec = codec; // aniqlanmasa (kamera o'chiq) eski qiymat qoladi
    })
  );

  let ok = 0;
  for (const c of cameras) {
    try {
      await addPath(c);
      ok++;
    } catch {
      // bitta kamera ulanmasa boshqalari to'xtab qolmasin
    }
  }

  const h264 = cameras.filter((c) => c.codec === "h264").length;
  const hevc = cameras.filter((c) => c.codec === "hevc").length;
  const noma = cameras.length - h264 - hevc;
  console.log(
    `[sync] ${ok}/${cameras.length} kamera MediaMTX'ga qayta ulandi | ` +
      `kodek: ${h264} H264 (transkodsiz), ${hevc} H265 (transkod), ${noma} noma'lum`
  );
}
