import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";

const router = Router();

// Audit jurnali: kim, qachon, nima qildi (login, playback, eksport, boshqaruv).
// Filtrlar: ?user=&action=&camera=&from=&to=
// Sahifalash: ?page=1&limit=50 -> { items, total, page, pages, limit }
router.get("/", requirePerm("audit.view"), (req, res) => {
  const { user, action, camera, from, to } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 10), 200);
  const where = [];
  const args = [];
  if (user) { where.push("a.username = ?"); args.push(String(user)); }
  if (action) { where.push("a.action LIKE ?"); args.push(`${action}%`); }
  if (camera) { where.push("a.camera_id = ?"); args.push(Number(camera)); }
  if (from) { where.push("a.created_at >= ?"); args.push(String(from)); }
  if (to) { where.push("a.created_at <= ?"); args.push(String(to)); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${w}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(Math.trunc(Number(req.query.page)) || 1, 1), pages);

  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, a.username, a.action, a.camera_id, c.name AS camera_name,
              a.details, a.ip, a.created_at
       FROM audit_log a LEFT JOIN cameras c ON c.id = a.camera_id
       ${w}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, (page - 1) * limit);

  res.json({
    items: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    total,
    page,
    pages,
    limit,
  });
});

export default router;
