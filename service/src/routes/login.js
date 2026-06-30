import { Router } from "express";
import { checkAdminPassword, issueAdminToken } from "../auth.js";

const router = Router();

// Brauzerdagi admin SPA shu yerga parol yuboradi. To'g'ri bo'lsa JWT token
// qaytaramiz; SPA uni saqlab, keyingi so'rovlarda Bearer sifatida yuboradi.
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Serverda ADMIN_PASSWORD sozlanmagan" });
  }
  if (!checkAdminPassword(password)) {
    return res.status(401).json({ error: "Noto'g'ri parol" });
  }
  res.json({ token: issueAdminToken() });
});

export default router;
