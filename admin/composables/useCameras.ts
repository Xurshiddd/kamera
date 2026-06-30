// Static SPA to'g'ridan service'ga (boshqa serverdagi IP/domen) ulanadi.
// Avtorizatsiya — admin Bearer tokeni (useApi qo'shadi).
export function useCameras() {
  const { call } = useApi();

  const list = (): Promise<Camera[]> => call("/api/cameras");

  const add = (payload: NewCamera): Promise<Camera> =>
    call("/api/cameras", { method: "POST", body: payload });

  const remove = (id: number) => call(`/api/cameras/${id}`, { method: "DELETE" });

  const refreshUrls = (slug: string): Promise<Camera> =>
    call(`/api/cameras/${slug}/token`);

  return { list, add, remove, refreshUrls };
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
  webrtc: string;
  embed: string;
  created_at?: string;
}
