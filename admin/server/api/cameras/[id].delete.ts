export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  return serviceFetch(`/api/cameras/${id}`, { method: "DELETE" });
});
