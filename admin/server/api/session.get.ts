import { verifySession, SESSION_COOKIE } from "../utils/session";

// Klient (route middleware) shu yerdan "kirganmi yo'qmi" deb so'raydi.
export default defineEventHandler((event) => {
  return { authed: verifySession(getCookie(event, SESSION_COOKIE)) };
});
