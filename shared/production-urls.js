// Verified against publishing metadata. Never derive outbound links from a request
// host or workspace environment: agents can create accounts from Preview.
export const PRODUCTION_APP_URL = "https://factorflux.co";
export const PRODUCTION_PORTAL_URL = "https://factorflux.io/portal";

export function productionAppUrl(path = "/") {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Application links must use an absolute local path.");
  }
  const url = new URL(path, PRODUCTION_APP_URL);
  if (url.origin !== PRODUCTION_APP_URL) throw new Error("Invalid application link.");
  return url.href;
}

export function isProductionAppOrigin(value) {
  try {
    const url = new URL(value);
    return ["https://factorflux.co", "https://factorflux.io"].includes(url.origin) &&
      url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}
