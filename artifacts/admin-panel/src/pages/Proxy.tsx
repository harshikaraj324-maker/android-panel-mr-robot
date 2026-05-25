import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProxyLogEntry, ProxyStats } from "@/lib/api";
import {
  Shield, RefreshCw,
  Wifi, WifiOff, Circle, Activity, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export default function Proxy() {
  const [liveEntries, setLiveEntries] = useState<ProxyLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "accepted" | "blocked">("all");
  const [clearLogOpen, setClearLogOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const liveContainerRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: logData, refetch: refetchLog } = useQuery({
    queryKey: ["proxy-log", logFilter],
    queryFn: () => api.getProxyLog(logFilter === "all" ? undefined : logFilter),
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["proxy-stats"],
    queryFn: () => api.getProxyStats(),
    refetchInterval: 5000,
  });

  const clearLogMut = useMutation({
    mutationFn: () => api.clearProxyLog(),
    onSuccess: () => { setLiveEntries([]); refetchLog(); refetchStats(); setClearLogOpen(false); toast({ title: "Log cleared" }); },
  });

  // SSE connection with auto-reconnect
  const connectSSE = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }

    const token = getToken();
    if (!token) return;

    const base = window.location.origin;
    const url = `${base}/api/admin/proxy/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      reconnectDelay.current = 1000; // reset backoff on success
    });

    es.addEventListener("proxy-event", (e) => {
      const entry = JSON.parse(e.data) as ProxyLogEntry;
      setLiveEntries((prev) => [entry, ...prev].slice(0, 200));
      if (liveContainerRef.current) liveContainerRef.current.scrollTop = 0;
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
      // Exponential backoff: 1s → 2s → 4s → 8s → max 30s
      const delay = Math.min(reconnectDelay.current, 30_000);
      reconnectDelay.current = Math.min(delay * 2, 30_000);
      reconnectTimerRef.current = setTimeout(connectSSE, delay);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      eventSourceRef.current?.close();
    };
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
            All Android app traffic passes through here — monitor requests in real time
          </p>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border", connected ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400" : "border-muted text-muted-foreground")}>
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? "Live Stream" : "Disconnected"}
          {!connected && <button className="ml-1 underline" onClick={connectSSE}>Reconnect</button>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Today Accepted", value: stats?.today_accepted ?? 0, color: "text-green-600" },
          { label: "Today Blocked",  value: stats?.today_blocked ?? 0,  color: "text-red-500" },
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

      {/* Full-width Live Log */}
      <Card className="flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: "400px" }}>
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
                  {connected ? "No requests received yet..." : "Stream disconnected"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Real-time data will appear here as Android apps make requests
                </p>
              </div>
            ) : (
              filtered.map((entry) => <LogRow key={`${entry.id}-${entry.timestamp}`} entry={entry} />)
            )}
          </div>
        </CardContent>
      </Card>

      {/* Clear log dialog */}
      <AlertDialog open={clearLogOpen} onOpenChange={setClearLogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear entire log?</AlertDialogTitle>
            <AlertDialogDescription>All {logData?.total ?? 0} entries will be permanently deleted.</AlertDialogDescription>
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
