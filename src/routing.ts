export const API_VERSION_PREFIX = "/v1";

export function stripV1Prefix(pathname: string): string | null {
  if (pathname === API_VERSION_PREFIX) {
    return "/";
  }
  if (pathname.startsWith(`${API_VERSION_PREFIX}/`)) {
    return pathname.slice(API_VERSION_PREFIX.length);
  }
  return null;
}
