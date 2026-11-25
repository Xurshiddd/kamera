// SPA gateway'ning /api yo'liga (same-origin) so'rov yuboradi.
// Avtorizatsiya — admin Bearer tokeni (useApi qo'shadi).
export function useCameras() {
  const { call } = useApi();

  const list = (): Promise<Camera[]> => call("/api/cameras");

  const get = (id: number | string): Promise<CameraDetail> =>
    call(`/api/cameras/${id}`);

  const add = (payload: NewCamera): Promise<Camera> =>
    call("/api/cameras", { method: "POST", body: payload });

  const update = (id: number | string, payload: NewCamera): Promise<Camera> =>
    call(`/api/cameras/${id}`, { method: "PUT", body: payload });

  const remove = (id: number) => call(`/api/cameras/${id}`, { method: "DELETE" });

  // Bir xil IP'li kameralar: qaysi biri qoladi / qaysilari o'chadi.
  const duplicates = (): Promise<{ groups: DupGroup[]; total: number }> =>
    call("/api/cameras/duplicates");

  const cleanDuplicates = (): Promise<{ ok: boolean; removed: number }> =>
    call("/api/cameras/duplicates/clean", { method: "POST" });

  return { list, get, add, update, remove, duplicates, cleanDuplicates };
}

export interface DupItem {
  id: number;
  name: string;
  nvr_name: string | null;
  channel: number | null;
  source: "nvr" | "scan" | "manual";
  created_at?: string;
}

export interface DupGroup {
  ip: string;
  keep: DupItem;
  remove: DupItem[];
}

export interface NewCamera {
  name: string;
  // To'g'ridan IP kamera uchun (NVR kamerasida kerak emas)
  ip?: string;
  port?: number;
  login?: string;
  parol?: string; // edit'da bo'sh qoldirilsa serverda eskisi qoladi
  rtspPath?: string;
  order?: number | null; // ko'rsatish tartibi; null = tartibsizlar keyin chiqadi
  isPublic?: boolean; // mehmon (loginsiz) sahifada ko'rinadimi
  // NVR kanali (berilsa ip/login/parol kerak emas)
  nvrId?: number | null;
  channel?: number | null;
  stream?: "main" | "sub";
}

export type Codec = "h264" | "hevc" | null;

export interface Camera {
  id: number;
  name: string;
  slug: string;
  ip?: string;
  codec?: Codec;
  order?: number | null;
  is_public?: boolean;
  nvr_id?: number | null;
  nvr_name?: string | null;
  channel?: number | null;
  stream?: "main" | "sub";
  source?: "scan" | null; // 'scan' = tarmoq skaneri orqali qo'shilgan
  hls: string;
  auth_blocked?: boolean; // kamera parolni rad etgan — oqim kutyapti
  created_at?: string;
}

// Tahrirlash formasi uchun to'liq yozuv (parol QAYTARILMAYDI).
export interface CameraDetail extends Camera {
  port: number | null;
  login: string | null;
  rtsp_path: string | null;
}
