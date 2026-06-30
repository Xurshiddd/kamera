import jwt from "jsonwebtoken";

const API_KEY = process.env.SERVICE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const TTL = Number(process.env.TOKEN_TTL_SECONDS || 60);

// Admin panel -> service so'rovlarini API kalit bilan himoyalaymiz.
// Admin panel har so'rovda "x-api-key" sarlavhasini yuboradi.
export function requireApiKey(req, res, next) {
  const key = req.get("x-api-key");
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: "Noto'g'ri API kalit" });
  }
  next();
}

// Ma'lum bir kamera (slug) uchun qisqa muddatli tomosha tokeni beramiz.
export function issueStreamToken(slug) {
  return jwt.sign({ slug }, JWT_SECRET, { expiresIn: TTL });
}

// MediaMTX auth-callback ichida tokenni tekshiramiz: haqiqiymi + shu kameragami.
export function verifyStreamToken(token, slug) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.slug === slug;
  } catch {
    return false;
  }
}
