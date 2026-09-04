// Prefixes Vite's base path so /data/... fetches work both in local dev
// (base "/") and the GitHub Pages build (base "/avyski/").
export function dataUrl(path) {
  return import.meta.env.BASE_URL + path;
}
