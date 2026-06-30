export default defineEventHandler((event) => {
  // bu yerda param qiymati kameraning slug'i bo'ladi
  const slug = getRouterParam(event, "id");
  return serviceFetch(`/api/cameras/${slug}/token`);
});
