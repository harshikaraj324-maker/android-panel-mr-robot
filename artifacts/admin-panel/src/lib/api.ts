const BASE = "/api";

// Token management
export function getToken(): string | null { return localStorage.getItem("admin_token"); }
export function setToken(t: string) { localStorage.setItem("admin_token", t); }
export function clearToken() { localStorage.removeItem("admin_token"); }

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    ...options,
  });
  if (res.status === 401) { clearToken(); window.location.reload(); throw new Error("Unauthorized"); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AppIdRow {
  id: number; app_id: string; name: string | null; pin: string;
  status: "active" | "inactive" | "disabled";
  created_at: string; expires_at: string;
  device_count: number; active_count: number; active_sessions: number;
}
export interface AppIdListResponse { needs_setup: boolean; rows: AppIdRow[]; }
export interface DeviceRow {
  id: number; app_id: string; sub_id: string | null; device_id: string;
  device_name: string | null; device_model: string | null; android_version: string | null;
  registered_at: string; is_active: boolean; last_seen: string | null;
}
export interface SessionRow {
  id: number; app_id: string; sub_id: string | null;
  login_time: string; last_active: string;
  user_agent: string | null; ip: string | null; is_valid: boolean;
}
export interface FormDataRow {
  id: number; app_id: string; sub_id: string | null;
  form_type: string; data: Record<string, unknown>; submitted_at: string;
}
export interface MessageRow {
  id: number; app_id: string; sub_id: string | null;
  from_id: string | null; to_id: string | null;
  content: string; message_type: string;
  sent_at: string; is_read: boolean;
}
export interface Stats {
  total_apps: number; active_apps: number; inactive_apps: number; expired_apps: number;
  total_devices: number; active_devices: number; recent_devices_7d: number;
  total_sessions: number; active_sessions: number; unread_messages: number;
  proxy_blocked_today: number; proxy_accepted_today: number;
}
export interface ProxyRule {
  id: number;
  action: "block" | "allow";
  field: "app_id" | "sub_id" | "ip" | "message_type" | "device_id" | "all";
  value: string;
  endpoints: "all" | "register" | "message" | "form";
  note: string;
  created_at: string;
}
export interface ProxyLogEntry {
  id: number; timestamp: string; endpoint: string;
  app_id: string | null; sub_id: string | null; device_id: string | null;
  ip: string; status: "accepted" | "blocked"; reason: string;
  payload_preview: Record<string, unknown>;
}
export interface ProxyStats {
  total: number; blocked: number; accepted: number;
  today_total: number; today_blocked: number; today_accepted: number;
  active_rules: number; block_rules: number; allow_rules: number;
  connected_clients: number;
}
export interface ProxyLogResponse {
  entries: ProxyLogEntry[]; total: number; blocked: number; accepted: number;
}

// ── API client ────────────────────────────────────────────────────────────────
export const api = {
  login:          (password: string) => req<{ token: string }>("/admin/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout:         () => req<{ ok: boolean }>("/admin/logout", { method: "POST" }),
  changePassword: (old_password: string, new_password: string) =>
    req<{ ok: boolean }>("/admin/change-password", { method: "POST", body: JSON.stringify({ old_password, new_password }) }),

  stats:          () => req<Stats>("/admin/stats"),
  generateAppId:  () => req<{ app_id: string }>("/admin/generate-app-id"),

  // App IDs
  listAppIds:    () => req<AppIdListResponse>("/admin/app-ids"),
  createAppId:   (body: { app_id: string; pin?: string; name?: string }) =>
    req<AppIdRow>("/admin/app-ids", { method: "POST", body: JSON.stringify(body) }),
  changePin:     (appId: string, newPin: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/password`, { method: "PATCH", body: JSON.stringify({ new_password: newPin }) }),
  resetPin:      (appId: string) => req<{ ok: boolean }>(`/admin/app-ids/${appId}/reset-password`, { method: "POST" }),
  extendSession: (appId: string) => req<{ ok: boolean; expires_at: string }>(`/admin/app-ids/${appId}/extend`, { method: "POST" }),
  setStatus:     (appId: string, status: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/toggle`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteAppId:   (appId: string) => req<{ ok: boolean }>(`/admin/app-ids/${appId}`, { method: "DELETE" }),

  // Devices
  listDevices:   (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams();
    if (filters?.app_id) p.set("app_id", filters.app_id);
    if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<DeviceRow[]>(`/admin/devices${p.toString() ? `?${p}` : ""}`);
  },
  toggleDevice:  (id: number, is_active: boolean) =>
    req<{ ok: boolean }>(`/admin/devices/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
  deleteDevice:  (id: number) => req<{ ok: boolean }>(`/admin/devices/${id}`, { method: "DELETE" }),

  // Sessions
  listSessions:    (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams();
    if (filters?.app_id) p.set("app_id", filters.app_id);
    if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<SessionRow[]>(`/admin/sessions${p.toString() ? `?${p}` : ""}`);
  },
  invalidateSession: (id: number) => req<{ ok: boolean }>(`/admin/sessions/${id}/invalidate`, { method: "POST" }),
  deleteSession:     (id: number) => req<{ ok: boolean }>(`/admin/sessions/${id}`, { method: "DELETE" }),
  deleteAllSessions: (appId: string) => req<{ ok: boolean }>(`/admin/sessions/app/${appId}/all`, { method: "DELETE" }),

  // Form Data
  listFormData:  (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams();
    if (filters?.app_id) p.set("app_id", filters.app_id);
    if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<FormDataRow[]>(`/admin/form-data${p.toString() ? `?${p}` : ""}`);
  },
  deleteFormData: (id: number) => req<{ ok: boolean }>(`/admin/form-data/${id}`, { method: "DELETE" }),

  // Messages
  listMessages: (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams();
    if (filters?.app_id) p.set("app_id", filters.app_id);
    if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<MessageRow[]>(`/admin/messages${p.toString() ? `?${p}` : ""}`);
  },
  markRead:      (id: number) => req<{ ok: boolean }>(`/admin/messages/${id}/read`, { method: "PATCH" }),
  deleteMessage: (id: number) => req<{ ok: boolean }>(`/admin/messages/${id}`, { method: "DELETE" }),

  // DB setup
  getDbStatus: () => req<{ tables_ready: boolean; error: string | null; setup_sql: string | null }>("/admin/db-status"),
  runSetup: () => req<{ ok: boolean; error?: string; setup_sql?: string }>("/admin/run-setup", { method: "POST" }),

  // Proxy
  listProxyRules: () => req<ProxyRule[]>("/admin/proxy/rules"),
  addProxyRule:   (body: Omit<ProxyRule, "id" | "created_at">) =>
    req<ProxyRule>("/admin/proxy/rules", { method: "POST", body: JSON.stringify(body) }),
  deleteProxyRule: (id: number) => req<{ ok: boolean }>(`/admin/proxy/rules/${id}`, { method: "DELETE" }),
  getProxyLog:    (status?: "accepted" | "blocked") =>
    req<ProxyLogResponse>(`/admin/proxy/log${status ? `?status=${status}` : ""}`),
  clearProxyLog:  () => req<{ ok: boolean }>("/admin/proxy/log", { method: "DELETE" }),
  getProxyStats:  () => req<ProxyStats>("/admin/proxy/stats"),
};
