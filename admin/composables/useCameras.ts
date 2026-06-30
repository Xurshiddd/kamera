// Brauzer faqat Nuxt'ning o'z /api route'lariga murojaat qiladi.
// Ular orqasida (serverda) service'ga API kalit bilan boriladi.
export function useCameras() {
  const list = (): Promise<Camera[]> => $fetch("/api/cameras");

  const add = (payload: NewCamera): Promise<Camera> =>
    $fetch("/api/cameras", { method: "POST", body: payload });

  const remove = (id: number) =>
    $fetch(`/api/cameras/${id}`, { method: "DELETE" });

  const refreshUrls = (slug: string): Promise<Camera> =>
    $fetch(`/api/cameras/${slug}/token`);

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
