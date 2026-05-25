import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SessionRow } from "@/lib/api";
import { Clock, Trash2, RefreshCw, Search, ShieldOff, Loader2, MonitorSmartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Sessions() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: sessions = [], isLoading, refetch } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions(),
  });

  const invalidateMut = useMutation({
    mutationFn: (id: number) => api.invalidateSession(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); toast({ title: "Session invalidated" }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteSession(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const appIds = Array.from(new Set((sessions as SessionRow[]).map((s) => s.app_id)));

  const filtered = (sessions as SessionRow[]).filter((s) => {
    const matchApp = appFilter === "all" || s.app_id === appFilter;
    const q = search.toLowerCase();
    return matchApp && (!q || s.app_id.toLowerCase().includes(q) || (s.sub_id ?? "").toLowerCase().includes(q) || (s.ip ?? "").toLowerCase().includes(q));
  });

  const validCount = (sessions as SessionRow[]).filter((s) => s.is_valid).length;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Sessions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{validCount} active · {sessions.length} total login sessions</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="App ID, Sub ID, IP..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-44 h-8 text-sm">
            <SelectValue placeholder="Filter by App" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Apps</SelectItem>
            {appIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <Clock className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{sessions.length === 0 ? "No sessions yet." : "No results match your filter."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {["Status", "App ID", "Sub ID", "IP", "User Agent", "Login Time", "Last Active", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", s.is_valid ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                          {s.is_valid ? "Active" : "Expired"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold">{s.app_id}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.sub_id ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{s.ip ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate" title={s.user_agent ?? ""}>
                        {s.user_agent ? <span className="flex items-center gap-1"><MonitorSmartphone className="w-3 h-3 flex-shrink-0" />{s.user_agent.slice(0, 40)}...</span> : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(s.login_time)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(s.last_active)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {s.is_valid && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-orange-500" title="Invalidate"
                              onClick={() => invalidateMut.mutate(s.id)} disabled={invalidateMut.isPending}>
                              <ShieldOff className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMut.mutate(s.id)} disabled={deleteMut.isPending}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
