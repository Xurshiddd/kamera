export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return serviceFetch("/api/cameras", { method: "POST", body });
});
