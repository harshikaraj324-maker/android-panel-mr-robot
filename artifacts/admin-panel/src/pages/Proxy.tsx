import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProxyRule, ProxyLogEntry, ProxyStats } from "@/lib/api";
import {
  Shield, ShieldX, ShieldCheck, Plus, Trash2, RefreshCw,
  Wifi, WifiOff, Circle, Filter, Activity, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/api";

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Live Log Entry ─────────────────────────────────────────────────────────
function LogRow({ entry }: { entry: ProxyLogEntry }) {
  const [open, setOpen] = useState(false);
  const accepted = entry.status === "accepted";
  return (
    <div className={cn("border-b last:border-0 text-xs font-mono", accepted ? "hover:bg-green-50/30 dark:hover:bg-green-950/10" : "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/60")}>
      <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer" onClick={() => setOpen(!open)}>
        <Circle className={cn("w-1.5 h-1.5 flex-shrink-0", accepted ? "text-green-500 fill-green-500" : "text-red-500 fill-red-500")} />
        <span className="text-muted-foreground w-16 flex-shrink-0">{fmtTime(entry.timestamp)}</span>
        <span className={cn("px-1 rounded text-[9px] font-bold uppercase flex-shrink-0", accepted ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400")}>
          {accepted ? "OK" : "BLOCK"}
        </span>
        <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 w-32 truncate">{entry.endpoint.replace("/api/", "")}</span>
        <span className="font-bold text-primary flex-shrink-0 w-40 truncate">{entry.app_id ?? "—"}</span>
        <span className="text-muted-foreground flex-shrink-0 w-24 truncate">{entry.sub_id ?? "—"}</span>
        <span className="text-muted-foreground flex-shrink-0 w-24 truncate">{entry.ip}</span>
        <span className={cn("ml-auto flex-shrink-0 truncate max-w-[180px]", !accepted && "text-red-600 dark:text-red-400")}>{entry.reason}</span>
        {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
      </div>
      {open && (
        <div className="px-3 pb-2 pl-10">
          <pre className="text-[10px] bg-muted/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(entry.payload_preview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Add Rule Form ──────────────────────────────────────────────────────────
function AddRuleForm({ onAdded }: { onAdded: () => void }) {
  const [action, setAction]     = useState<"block" | "allow">("block");
  const [field, setField]       = useState<ProxyRule["field"]>("app_id");
  const [value, setValue]       = useState("");
  const [endpoints, setEndpoints] = useState<ProxyRule["endpoints"]>("all");
  const [note, setNote]         = useState("");
  const { toast } = useToast();

  const addMut = useMutation({
    mutationFn: () => api.addProxyRule({ action, field, value: value.trim(), endpoints, note }),
    onSuccess: () => { setValue(""); setNote(""); onAdded(); toast({ title: `Rule added — ${action === "block" ? "🚫 Block" : "✅ Allow"} rule set` }); },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const fieldPlaceholder: Record<ProxyRule["field"], string> = {
    app_id: "e.g. SKY-APP-2026-X9F3 or *",
    sub_id: "e.g. ZUDAEACF or *",
    ip: "e.g. 192.168.1.10 or *",
    message_type: "e.g. New SMS or TEST or *",
    device_id: "e.g. abc123-device or *",
    all: "* (matches everything)",
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Action</label>
          <Select value={action} onValueChange={(v) => setAction(v as "block" | "allow")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block">🚫 Block (blacklist)</SelectItem>
              <SelectItem value="allow">✅ Allow only (whitelist)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Endpoint</label>
          <Select value={endpoints} onValueChange={(v) => setEndpoints(v as ProxyRule["endpoints"])}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All endpoints</SelectItem>
              <SelectItem value="register">Register device</SelectItem>
              <SelectItem value="message">Send message</SelectItem>
              <SelectItem value="form">Submit form</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Filter by</label>
          <Select value={field} onValueChange={(v) => setField(v as ProxyRule["field"])}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="app_id">App ID</SelectItem>
              <SelectItem value="sub_id">Sub ID</SelectItem>
              <SelectItem value="ip">IP Address</SelectItem>
              <SelectItem value="message_type">Message Type</SelectItem>
              <SelectItem value="device_id">Device ID</SelectItem>
              <SelectItem value="all">All (wildcard)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Value</label>
          <Input
            className="h-8 text-xs"
            placeholder={fieldPlaceholder[field]}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={field === "all"}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Note (optional)</label>
        <Input className="h-8 text-xs" placeholder="Kyon block kar rahe ho..." value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <Button size="sm" className="w-full" onClick={() => addMut.mutate()}
        disabled={!value.trim() && field !== "all" || addMut.isPending}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        {action === "block" ? "Block Rule Add Karo" : "Allow Rule Add Karo"}
      </Button>

      <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 leading-relaxed">
        <strong>Block:</strong> Matching requests ko reject kar do (403) &nbsp;|&nbsp;
        <strong>Allow:</strong> Sirf matching requests ko hi accept karo (baaki sab block)
        <br />Use <strong>*</strong> to match any value.
      </div>
    </div>
  );
}

export default function Proxy() {
  const [liveEntries, setLiveEntries] = useState<ProxyLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "accepted" | "blocked">("all");
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);
  const [clearLogOpen, setClearLogOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const liveContainerRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Historic log
  const { data: logData, refetch: refetchLog } = useQuery({
    queryKey: ["proxy-log", logFilter],
    queryFn: () => api.getProxyLog(logFilter === "all" ? undefined : logFilter),
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["proxy-stats"],
    queryFn: () => api.getProxyStats(),
    refetchInterval: 5000,
  });

  const { data: rules = [], refetch: refetchRules } = useQuery({
    queryKey: ["proxy-rules"],
    queryFn: () => api.listProxyRules(),
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: number) => api.deleteProxyRule(id),
    onSuccess: () => { refetchRules(); refetchStats(); setDeleteRuleId(null); toast({ title: "Rule deleted" }); },
  });

  const clearLogMut = useMutation({
    mutationFn: () => api.clearProxyLog(),
    onSuccess: () => { setLiveEntries([]); refetchLog(); refetchStats(); setClearLogOpen(false); toast({ title: "Log cleared" }); },
  });

  // SSE connection
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) { eventSourceRef.current.close(); }
    const token = getToken();
    if (!token) return;

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${base}/api/admin/proxy/stream?token=${token}`);
    eventSourceRef.current = es;

    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("proxy-event", (e) => {
      const entry = JSON.parse(e.data) as ProxyLogEntry;
      setLiveEntries((prev) => [entry, ...prev].slice(0, 200));
      // Auto-scroll to top
      if (liveContainerRef.current) liveContainerRef.current.scrollTop = 0;
    });
    es.onerror = () => { setConnected(false); };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => { eventSourceRef.current?.close(); };
  }, [connectSSE]);

  const displayedLog = liveEntries.length > 0 ? liveEntries : (logData?.entries ?? []);
  const filtered = logFilter === "all" ? displayedLog : displayedLog.filter((e) => e.status === logFilter);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Proxy Gateway
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Android apps ka data yahan se guzarta hai — real-time accept/block karo
          </p>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border", connected ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400" : "border-muted text-muted-foreground")}>
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? "Live Stream" : "Disconnected"}
          {!connected && <button className="ml-1 underline" onClick={connectSSE}>Reconnect</button>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Today Accepted", value: stats?.today_accepted ?? 0, color: "text-green-600" },
          { label: "Today Blocked",  value: stats?.today_blocked ?? 0,  color: "text-red-500" },
          { label: "Active Rules",   value: stats?.active_rules ?? 0,   color: "text-primary" },
          { label: "Live Clients",   value: stats?.connected_clients ?? 0, color: "text-blue-500" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="py-0">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={cn("text-2xl font-bold mt-0.5", color)}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Rules */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary" /> Filter Rules
              </CardTitle>
              <p className="text-[10px] text-muted-foreground">
                {(rules as ProxyRule[]).filter((r) => r.action === "block").length} block · {(rules as ProxyRule[]).filter((r) => r.action === "allow").length} allow rules
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <AddRuleForm onAdded={() => { refetchRules(); refetchStats(); }} />
            </CardContent>
          </Card>

          {/* Existing rules */}
          {(rules as ProxyRule[]).length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">Active Rules</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {(rules as ProxyRule[]).map((r) => (
                  <div key={r.id} className={cn("flex items-start gap-2 rounded-lg border p-2.5 text-xs", r.action === "block" ? "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/10" : "border-green-200 bg-green-50/50 dark:border-green-900/40 dark:bg-green-950/10")}>
                    {r.action === "block" ? <ShieldX className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" /> : <ShieldCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={cn("font-bold uppercase text-[9px]", r.action === "block" ? "text-red-600" : "text-green-700")}>{r.action}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono font-semibold">{r.field}={r.value}</span>
                        {r.endpoints !== "all" && <span className="text-muted-foreground">on {r.endpoints}</span>}
                      </div>
                      {r.note && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{r.note}</p>}
                    </div>
                    <button onClick={() => setDeleteRuleId(r.id)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Live Log */}
        <div className="lg:col-span-2 space-y-3">
          <Card className="flex flex-col" style={{ height: "calc(100vh - 200px)", minHeight: "400px" }}>
            <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Live Request Log
                  {connected && <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Select value={logFilter} onValueChange={(v) => setLogFilter(v as typeof logFilter)}>
                    <SelectTrigger className="h-6 text-[10px] w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { refetchLog(); refetchStats(); }}>
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive hover:text-destructive px-2" onClick={() => setClearLogOpen(true)}>
                    Clear
                  </Button>
                </div>
              </div>
              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 pt-1 text-[9px] uppercase tracking-wide text-muted-foreground font-semibold font-mono">
                <span className="w-1.5" />
                <span className="w-16">Time</span>
                <span className="w-10">St</span>
                <span className="w-32">Endpoint</span>
                <span className="w-40">App ID</span>
                <span className="w-24">Sub ID</span>
                <span className="w-24">IP</span>
                <span className="ml-auto">Reason</span>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden">
              <div ref={liveContainerRef} className="h-full overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Activity className="w-8 h-8 text-muted-foreground/20 mb-2" />
                    <p className="text-xs text-muted-foreground">
                      {connected ? "Android apps se koi request nahi aayi abhi..." : "Stream disconnect hai"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Yahan real-time data aata rahega jaise Android app request karega
                    </p>
                  </div>
                ) : (
                  filtered.map((entry) => <LogRow key={`${entry.id}-${entry.timestamp}`} entry={entry} />)
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete rule dialog */}
      <AlertDialog open={deleteRuleId !== null} onOpenChange={(o) => !o && setDeleteRuleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rule delete karna chahte ho?</AlertDialogTitle>
            <AlertDialogDescription>Yeh rule hata diya jayega. Undo nahi hoga.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRuleId && deleteRuleMut.mutate(deleteRuleId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear log dialog */}
      <AlertDialog open={clearLogOpen} onOpenChange={setClearLogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pura log clear karna chahte ho?</AlertDialogTitle>
            <AlertDialogDescription>Sab {logData?.total ?? 0} entries delete ho jayenge.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => clearLogMut.mutate()}>Clear All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
