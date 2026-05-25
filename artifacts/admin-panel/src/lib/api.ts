const BASE = "/api";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface AppIdRow {
  id: number;
  app_id: string;
  admin_label: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  device_count: number;
  active_count: number;
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
  total_devices: number;
  active_devices: number;
  recent_devices_7d: number;
}

export interface InitResult {
  ok: boolean;
  tables_exist: boolean;
  app_ids_error: string | null;
  devices_error: string | null;
  sql_to_run: string | null;
}

export const api = {
  init: () => req<InitResult>("/admin/init", { method: "POST" }),
  stats: () => req<Stats>("/admin/stats"),

  listAppIds: () => req<AppIdRow[]>("/admin/app-ids"),
  createAppId: (body: { app_id: string; password: string; admin_label?: string; expires_at?: string }) =>
    req<AppIdRow>("/admin/app-ids", { method: "POST", body: JSON.stringify(body) }),
  changePassword: (appId: string, body: { current_password: string; new_password: string }) =>
    req<{ ok: boolean; message: string }>(`/admin/app-ids/${appId}/password`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  toggleAppId: (appId: string, is_active: boolean) =>
    req<{ ok: boolean }>(`/admin/app-ids/${appId}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ is_active }),
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
