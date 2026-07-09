// SPA gateway'ning /api yo'liga (same-origin) so'rov yuboradi.
// Avtorizatsiya — admin Bearer tokeni (useApi qo'shadi).
export function useCameras() {
  const { call } = useApi();

  const list = (): Promise<Camera[]> => call("/api/cameras");

  const add = (payload: NewCamera): Promise<Camera> =>
    call("/api/cameras", { method: "POST", body: payload });

  const remove = (id: number) => call(`/api/cameras/${id}`, { method: "DELETE" });

  return { list, add, remove };
}

export interface NewCamera {
  name: string;
  ip: string;
  port?: number;
  login: string;
  parol: string;
  rtspPath?: string;
}

export interface Camera {
  id: number;
  name: string;
  slug: string;
  ip?: string;
  hls: string;
  created_at?: string;
}
