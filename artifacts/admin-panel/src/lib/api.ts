const BASE = "/api";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data as T;
}

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
  from_id: string | null; content: string; message_type: string;
  sent_at: string; is_read: boolean;
}

export interface SettingRow { id: number; app_id: string; key: string; value: string; updated_at: string; }

export interface Stats {
  total_apps: number; active_apps: number; inactive_apps: number; expired_apps: number;
  total_devices: number; active_devices: number; recent_devices_7d: number;
  total_sessions: number; active_sessions: number; unread_messages: number;
}

export const api = {
  stats: () => req<Stats>("/admin/stats"),
  generateAppId: () => req<{ app_id: string }>("/admin/generate-app-id"),

  // Apps
  listAppIds: () => req<AppIdListResponse>("/admin/app-ids"),
  createAppId: (body: { app_id: string; pin?: string; name?: string }) =>
    req<AppIdRow>("/admin/app-ids", { method: "POST", body: JSON.stringify(body) }),
  changePin: (appId: string, newPin: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/password`, { method: "PATCH", body: JSON.stringify({ new_password: newPin }) }),
  resetPin: (appId: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/reset-password`, { method: "POST" }),
  extendSession: (appId: string) =>
    req<{ ok: boolean; expires_at: string }>(`/admin/app-ids/${appId}/extend`, { method: "POST" }),
  setStatus: (appId: string, status: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/toggle`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteAppId: (appId: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}`, { method: "DELETE" }),

  // Devices
  listDevices: (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams(); if (filters?.app_id) p.set("app_id", filters.app_id); if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<DeviceRow[]>(`/admin/devices${p.toString() ? `?${p}` : ""}`);
  },
  createDevice: (body: Partial<DeviceRow>) => req<DeviceRow>("/admin/devices", { method: "POST", body: JSON.stringify(body) }),
  toggleDevice: (id: number, is_active: boolean) =>
    req<{ ok: boolean }>(`/admin/devices/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
  deleteDevice: (id: number) => req<{ ok: boolean }>(`/admin/devices/${id}`, { method: "DELETE" }),

  // Sessions
  listSessions: (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams(); if (filters?.app_id) p.set("app_id", filters.app_id); if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<SessionRow[]>(`/admin/sessions${p.toString() ? `?${p}` : ""}`);
  },
  invalidateSession: (id: number) => req<{ ok: boolean }>(`/admin/sessions/${id}/invalidate`, { method: "POST" }),
  deleteSession: (id: number) => req<{ ok: boolean }>(`/admin/sessions/${id}`, { method: "DELETE" }),
  deleteAllSessions: (appId: string) => req<{ ok: boolean }>(`/admin/sessions/app/${appId}/all`, { method: "DELETE" }),

  // Form Data
  listFormData: (filters?: { app_id?: string; sub_id?: string; form_type?: string }) => {
    const p = new URLSearchParams(); if (filters?.app_id) p.set("app_id", filters.app_id); if (filters?.sub_id) p.set("sub_id", filters.sub_id); if (filters?.form_type) p.set("form_type", filters.form_type);
    return req<FormDataRow[]>(`/admin/form-data${p.toString() ? `?${p}` : ""}`);
  },
  deleteFormData: (id: number) => req<{ ok: boolean }>(`/admin/form-data/${id}`, { method: "DELETE" }),

  // Messages
  listMessages: (filters?: { app_id?: string; sub_id?: string }) => {
    const p = new URLSearchParams(); if (filters?.app_id) p.set("app_id", filters.app_id); if (filters?.sub_id) p.set("sub_id", filters.sub_id);
    return req<MessageRow[]>(`/admin/messages${p.toString() ? `?${p}` : ""}`);
  },
  sendMessage: (body: { app_id: string; sub_id?: string; content: string; message_type?: string }) =>
    req<MessageRow>("/admin/messages", { method: "POST", body: JSON.stringify(body) }),
  markRead: (id: number) => req<{ ok: boolean }>(`/admin/messages/${id}/read`, { method: "PATCH" }),
  deleteMessage: (id: number) => req<{ ok: boolean }>(`/admin/messages/${id}`, { method: "DELETE" }),

  // Settings
  listSettings: (app_id?: string) => req<SettingRow[]>(`/admin/settings${app_id ? `?app_id=${encodeURIComponent(app_id)}` : ""}`),
  saveSetting: (app_id: string, key: string, value: string) =>
    req<{ ok: boolean }>("/admin/settings", { method: "PUT", body: JSON.stringify({ app_id, key, value }) }),
  deleteSetting: (id: number) => req<{ ok: boolean }>(`/admin/settings/${id}`, { method: "DELETE" }),
};
