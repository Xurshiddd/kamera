// Mijoz IP'sini aniqlash. Zanjir: mijoz -> Hestia -> gateway -> service.
// Hestia haqiqiy mijoz IP'sini XFF oxiriga qo'shadi, gateway esa Hestia
// IP'sini qo'shadi -> haqiqiy mijoz OXIRIDAN BITTA OLDINGI element.
// (Mijoz o'zi soxta XFF yuborsa u ro'yxat BOSHIGA tushadi — ta'sir qilmaydi.)
export function clientIp(req) {
  const xff = (req.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length >= 2) return xff[xff.length - 2];
  return xff[0] || req.socket.remoteAddress || "nomalum";
}

// Har so'rovga req.clientIp qo'yadi (login himoyasi va audit uchun).
export function clientIpMiddleware(req, res, next) {
  req.clientIp = clientIp(req);
  next();
}
