const BASE = "/api";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data as T;
}

export interface AppIdRow {
  id: number;
  app_id: string;
  name: string | null;
  pin: string;
  status: "active" | "inactive" | "disabled";
  created_at: string;
  expires_at: string | null;
  device_count: number;
  active_count: number;
}

export interface AppIdListResponse {
  needs_setup: boolean;
  rows: AppIdRow[];
}

export interface DeviceRow {
  id: number;
  app_id: string;
  device_id: string;
  device_name: string | null;
  device_model: string | null;
  android_version: string | null;
  registered_at: string | null;
  is_active: boolean;
  last_seen: string | null;
  admin_id: string | null;
}

export interface Stats {
  total_apps: number;
  active_apps: number;
  expired_apps: number;
  total_devices: number;
  active_devices: number;
  recent_devices_7d: number;
}

export interface InitStatus {
  tables_exist: boolean;
  has_pat: boolean;
  app_ids_error: string | null;
  devices_error: string | null;
}

export const api = {
  initStatus: () => req<InitStatus>("/admin/init-status"),

  setup: (pat: string) =>
    req<{ ok: boolean; message: string }>("/admin/setup", {
      method: "POST",
      body: JSON.stringify({ pat }),
    }),

  stats: () => req<Stats>("/admin/stats"),

  generateAppId: () => req<{ app_id: string }>("/admin/generate-app-id"),

  listAppIds: () => req<AppIdListResponse>("/admin/app-ids"),

  createAppId: (body: { app_id: string; pin?: string; name?: string }) =>
    req<AppIdRow>("/admin/app-ids", { method: "POST", body: JSON.stringify(body) }),

  changePin: (appId: string, newPin: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/password`, {
      method: "PATCH",
      body: JSON.stringify({ new_password: newPin }),
    }),

  resetPin: (appId: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/reset-password`, { method: "POST" }),

  extendSession: (appId: string) =>
    req<{ ok: boolean; expires_at: string }>(`/admin/app-ids/${appId}/extend`, { method: "POST" }),

  setStatus: (appId: string, status: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  deleteAppId: (appId: string) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}`, { method: "DELETE" }),

  listDevices: (app_id?: string) =>
    req<DeviceRow[]>(`/admin/devices${app_id ? `?app_id=${encodeURIComponent(app_id)}` : ""}`),

  toggleDevice: (id: number, is_active: boolean) =>
    req<{ ok: boolean }>(`/admin/devices/${id}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ is_active }),
    }),

  deleteDevice: (id: number) =>
    req<{ ok: boolean }>(`/admin/devices/${id}`, { method: "DELETE" }),
};
