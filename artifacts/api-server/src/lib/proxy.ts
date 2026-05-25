import type { Response } from "express";
import { db } from "./supabase.js";

// ── SSE clients ───────────────────────────────────────────────────────────────
export const sseClients = new Set<Response>();

export function broadcastSSE(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// ── In-memory proxy log ───────────────────────────────────────────────────────
export interface ProxyLogRow {
  id: number; endpoint: string; app_id: string | null; sub_id: string | null;
  device_id: string | null; ip: string; status: string; reason: string;
  payload_preview: Record<string, unknown>; timestamp: string;
}

let proxyLogIdSeq = 1;
export const proxyMemLog: ProxyLogRow[] = [];
export const proxyMemStats = { accepted: 0, blocked: 0, todayAccepted: 0, todayBlocked: 0, today: "" };

export function resetTodayStats() {
  const d = new Date().toISOString().slice(0, 10);
  if (proxyMemStats.today !== d) {
    proxyMemStats.today = d;
    proxyMemStats.todayAccepted = 0;
    proxyMemStats.todayBlocked = 0;
  }
}

export function logProxyRequest(entry: {
  endpoint: string; app_id: string | null; sub_id: string | null;
  device_id: string | null; ip: string; status: string; reason: string;
  payload_preview: Record<string, unknown>;
}) {
  resetTodayStats();
  const row: ProxyLogRow = { ...entry, id: proxyLogIdSeq++, timestamp: new Date().toISOString() };
  broadcastSSE("proxy-event", row);
  proxyMemLog.unshift(row);
  if (proxyMemLog.length > 500) proxyMemLog.splice(500);
  if (entry.status === "accepted") { proxyMemStats.accepted++; proxyMemStats.todayAccepted++; }
  else { proxyMemStats.blocked++; proxyMemStats.todayBlocked++; }
}

// ── Proxy rule checking ───────────────────────────────────────────────────────
export interface RequestMeta {
  endpoint: "register" | "message" | "form" | "upsert" | "get" | "update";
  app_id?: string | null; sub_id?: string | null;
  device_id?: string | null; ip: string;
  message_type?: string | null;
}

export async function checkProxyRules(meta: RequestMeta): Promise<{ allowed: boolean; reason: string }> {
  const { data: rules } = await db.from("proxy_rules").select("*").order("id", { ascending: true });
  if (!rules || rules.length === 0) return { allowed: true, reason: "accepted" };

  const blockRules = rules.filter((r: { action: string }) => r.action === "block");
  const allowRules = rules.filter((r: { action: string }) => r.action === "allow");

  function matches(r: { field: string; value: string; endpoints: string }): boolean {
    if (r.endpoints !== "all" && r.endpoints !== meta.endpoint) return false;
    if (r.value === "*") return true;
    switch (r.field) {
      case "app_id":      return meta.app_id === r.value;
      case "sub_id":      return meta.sub_id === r.value;
      case "ip":          return meta.ip === r.value;
      case "device_id":   return meta.device_id === r.value;
      case "message_type":return meta.message_type === r.value;
      default: return false;
    }
  }

  for (const r of blockRules) {
    if (matches(r)) return { allowed: false, reason: `Blocked by rule #${r.id}: ${r.field}=${r.value}${r.note ? ` (${r.note})` : ""}` };
  }

  const relevantAllow = allowRules.filter((r: { endpoints: string }) => r.endpoints === "all" || r.endpoints === meta.endpoint);
  if (relevantAllow.length > 0 && !relevantAllow.some(matches))
    return { allowed: false, reason: "Whitelist mode: no allow rule matched" };

  return { allowed: true, reason: "accepted" };
}
