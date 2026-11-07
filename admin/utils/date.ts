// Sana formati loyiha bo'ylab: KUN.OY.YIL (masalan 07.11.2026).
// Ichkarida (API, URL) ISO "YYYY-MM-DD" ishlatiladi — faqat ko'rsatish shu formatda.

const p2 = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD..." -> "DD.MM.YYYY"
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

// "DD.MM.YYYY" (yoki D.M.YYYY, / - bilan) -> "YYYY-MM-DD" | null
export function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${p2(mo)}-${p2(d)}`;
}

// Date -> "DD.MM.YYYY HH:MM[:SS]" (mahalliy vaqt)
export function fmtDateTime(d: Date, seconds = true): string {
  const t = `${p2(d.getHours())}:${p2(d.getMinutes())}` + (seconds ? `:${p2(d.getSeconds())}` : "");
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${t}`;
}

// Server (SQLite datetime('now'), UTC) "YYYY-MM-DD HH:MM:SS" -> mahalliy "DD.MM.YYYY HH:MM:SS"
export function fmtUtc(s: string | null | undefined, seconds = true): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
  return isNaN(d.getTime()) ? s : fmtDateTime(d, seconds);
}

// Bugungi sana ISO ko'rinishida (mahalliy).
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
