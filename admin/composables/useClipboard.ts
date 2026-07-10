// Nusxa olish. navigator.clipboard faqat HTTPS (yoki localhost) da ishlaydi —
// http://172.16.0.23:3000 kabi manzillarda undefined bo'ladi. Shuning uchun
// eski, hamma joyda ishlaydigan execCommand("copy") zaxira yo'li ham bor.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* pastdagi fallback'ga o'tamiz */
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
