import db from "./db.js";
import { addPath } from "./mediamtx.js";

// MediaMTX'ga API orqali qo'shilgan yo'llar u qayta ishga tushganda yo'qoladi.
// Shuning uchun service ishga tushganda DB'dagi hamma kamerani qaytadan push qilamiz.
export async function syncCameras() {
  const cameras = db.prepare("SELECT * FROM cameras").all();
  let ok = 0;
  for (const c of cameras) {
    try {
      await addPath(c);
      ok++;
    } catch {
      // bitta kamera ulanmasa boshqalari to'xtab qolmasin
    }
  }
  console.log(`[sync] ${ok}/${cameras.length} kamera MediaMTX'ga qayta ulandi`);
}
