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

  return { list, get, add, update, remove };
}

export interface NewCamera {
  name: string;
  ip: string;
  port?: number;
  login: string;
  parol: string; // edit'da bo'sh qoldirilsa serverda eskisi qoladi
  rtspPath?: string;
  order?: number | null; // ko'rsatish tartibi; null = tartibsizlar keyin chiqadi
}

export type Codec = "h264" | "hevc" | null;

export interface Camera {
  id: number;
  name: string;
  slug: string;
  ip?: string;
  codec?: Codec;
  order?: number | null;
  hls: string;
  created_at?: string;
}

// Tahrirlash formasi uchun to'liq yozuv (parol QAYTARILMAYDI).
export interface CameraDetail extends Camera {
  port: number;
  login: string;
  rtsp_path: string;
}
