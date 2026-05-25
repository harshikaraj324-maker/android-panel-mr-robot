import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DeviceRow, SessionRow, MessageRow } from "@/lib/api";
import { useState } from "react";
import { Smartphone, ArrowLeft, Trash2, RefreshCw, Clock, MessageSquare, Activity } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Tab = "devices" | "sessions" | "messages";

export default function AppDetail() {
  const { appId } = useParams<{ appId: string }>();
  const [tab, setTab] = useState<Tab>("devices");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading: dl, refetch: rd } = useQuery({ queryKey: ["devices", appId], queryFn: () => api.listDevices({ app_id: appId }), refetchInterval: 8000 });
  const { data: sessions = [], isLoading: sl } = useQuery({ queryKey: ["sessions", appId], queryFn: () => api.listSessions({ app_id: appId }), refetchInterval: 8000 });
  const { data: messages = [], isLoading: ml } = useQuery({ queryKey: ["messages", appId], queryFn: () => api.listMessages({ app_id: appId }), refetchInterval: 5000 });

  const toggleDevice = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => api.toggleDevice(id, is_active),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices", appId] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const deleteDevice = useMutation({
    mutationFn: (id: number) => api.deleteDevice(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices", appId] }); qc.invalidateQueries({ queryKey: ["stats"] }); toast({ title: "Device deleted" }); setDeleteId(null); },
  });

  const invalidateSess = useMutation({
    mutationFn: (id: number) => api.invalidateSession(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions", appId] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const deleteAllSess = useMutation({
    mutationFn: () => api.deleteAllSessions(appId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions", appId] }); qc.invalidateQueries({ queryKey: ["stats"] }); toast({ title: "All sessions cleared" }); },
  });

  const readMsg = useMutation({
    mutationFn: (id: number) => api.markRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["messages", appId] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const tabs = [
    { key: "devices" as Tab, label: "Devices", count: (devices as DeviceRow[]).length, icon: Smartphone },
    { key: "sessions" as Tab, label: "Sessions", count: (sessions as SessionRow[]).filter((s) => s.is_valid).length, icon: Activity },
    { key: "messages" as Tab, label: "Messages", count: (messages as MessageRow[]).filter((m) => !m.is_read).length, icon: MessageSquare },
  ];

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/apps">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">App Detail</p>
          <h2 className="text-base font-bold font-mono text-primary">{appId}</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => rd()}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(({ key, label, count, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="w-3.5 h-3.5" />{label}
            {count > 0 && <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", tab === key ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>{count}</span>}
          </button>
        ))}
      </div>

      {/* ── Devices Tab ─────────────────────────────────────── */}
      {tab === "devices" && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Registered Devices
              <span className="text-muted-foreground font-normal">({(devices as DeviceRow[]).length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dl ? (
              <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : (devices as DeviceRow[]).length === 0 ? (
              <div className="flex flex-col items-center py-12">
                <Smartphone className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No devices registered yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/40">
                    {["Device Name / ID", "Sub ID", "Model", "Android", "Registered", "Last Seen", "Active", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y">
                    {(devices as DeviceRow[]).map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-xs">{d.device_name ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[160px]">{d.device_id}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{d.sub_id ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.device_model ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.android_version ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(d.registered_at)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(d.last_seen)}</td>
                        <td className="px-4 py-2.5"><Switch checked={d.is_active} onCheckedChange={(v) => toggleDevice.mutate({ id: d.id, is_active: v })} /></td>
                        <td className="px-4 py-2.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(d.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Sessions Tab ─────────────────────────────────────── */}
      {tab === "sessions" && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Login Sessions
              <span className="text-muted-foreground font-normal">({(sessions as SessionRow[]).length})</span>
            </CardTitle>
            {(sessions as SessionRow[]).length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => deleteAllSess.mutate()}>Clear All</Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {sl ? (
              <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : (sessions as SessionRow[]).length === 0 ? (
              <div className="flex flex-col items-center py-12"><Clock className="w-10 h-10 text-muted-foreground/30 mb-3" /><p className="text-sm text-muted-foreground">No sessions yet.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/40">
                    {["Status", "Sub ID", "IP", "Login Time", "Last Active", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y">
                    {(sessions as SessionRow[]).map((s) => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", s.is_valid ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                            {s.is_valid ? "Active" : "Expired"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.sub_id ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.ip ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(s.login_time)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(s.last_active)}</td>
                        <td className="px-4 py-2.5">
                          {s.is_valid && <Button variant="ghost" size="sm" className="h-7 text-xs text-orange-500 hover:text-orange-600" onClick={() => invalidateSess.mutate(s.id)}>Invalidate</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Messages Tab ─────────────────────────────────────── */}
      {tab === "messages" && (
        <div className="space-y-2">
          {ml ? (
            <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : (messages as MessageRow[]).length === 0 ? (
            <Card><CardContent className="flex flex-col items-center py-12">
              <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No messages for this app yet.</p>
            </CardContent></Card>
          ) : (
            (messages as MessageRow[]).map((m) => (
              <Card key={m.id} className={cn(!m.is_read && "border-primary/30")}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {!m.is_read && <span className="w-2 h-2 rounded-full bg-orange-500" />}
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground capitalize">{m.message_type}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{fmt(m.sent_at)}</span>
                    </div>
                    <p className="text-sm">{m.content}</p>
                  </div>
                  {!m.is_read && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600 flex-shrink-0" onClick={() => readMsg.mutate(m.id)}>Mark Read</Button>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Delete device confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this device?</AlertDialogTitle>
            <AlertDialogDescription>This device will be permanently removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteDevice.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
