import { verifySession, SESSION_COOKIE } from "../utils/session";

// Server tomon himoyasi: /api/cameras* route'lariga faqat kirgan foydalanuvchi
// murojaat qila oladi. (Klient middleware'i sahifa o'tishini, bu esa to'g'ridan
// API chaqiruvini himoyalaydi.)
export default defineEventHandler((event) => {
  const url = event.path || "";
  if (!url.startsWith("/api/cameras")) return;

  if (!verifySession(getCookie(event, SESSION_COOKIE))) {
    throw createError({ statusCode: 401, statusMessage: "Avtorizatsiya kerak" });
  }
});
