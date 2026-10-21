// The verified administrator key belongs only to this page's in-memory connection.
let accessKey = "";
const listeners = new Set<() => void>();
export const getDashboardAccessKey = () => accessKey;
export function setDashboardAccessKey(value: string): void {
  if (value === accessKey) return;
  accessKey = value;
  for (const listener of listeners) listener();
}
export function subscribeAdminConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function dashboardWebSocketProtocols(key: string): string[] {
  const bytes = new TextEncoder().encode(key);
  if (!bytes.length || bytes.length > 4096) throw new Error("Administrator connection unavailable.");
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return ["jbgh-admin", "jbgh-auth." + encoded];
}
