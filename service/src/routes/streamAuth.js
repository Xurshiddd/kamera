import { Router } from "express";

const router = Router();

// IP loopback'mi (ya'ni serverning o'zidan)?
function isLoopback(ip) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    (typeof ip === "string" && ip.startsWith("127."))
  );
}

// MediaMTX har bir oqim ko'rish/nashr urinishida shu endpoint'ga so'rov yuboradi.
// Bu yerda "ha/yo'q" deymiz. 200 = ruxsat, 401 = rad.
//
// Diqqat: bu endpoint API kalit bilan HIMOYALANMAYDI, chunki uni MediaMTX'ning
// o'zi (localhost'dan) chaqiradi. Himoya — token tekshiruvi.
router.post("/stream-auth", (req, res) => {
  const { action, ip } = req.body || {};

  // Ichki transcoding (ffmpeg) H264 oqimni localhost'dan PUSH qiladi.
  // Faqat serverning o'zidan (loopback) kelgan publish'ga ruxsat beramiz.
  // Tashqaridan hech kim oqim push qila olmaydi.
  if (action === "publish") {
    return isLoopback(ip) ? res.sendStatus(200) : res.sendStatus(401);
  }

  // Ko'rish (read/playback) ochiq — MediaMTX config'ida bu action'lar auth'dan
  // chiqarilgan, shu sabab bu yergacha odatda kelmaydi. Kelsa ham ruxsat beramiz:
  // HLS URL login/parolsiz, istalgan saytda ishlashi kerak.
  res.sendStatus(200);
});

export default router;
