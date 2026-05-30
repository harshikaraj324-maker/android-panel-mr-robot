import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/lib/api";
import type { MessageRow } from "@/lib/api";
import { useAdminStream } from "@/hooks/useAdminStream";
import { MessageSquare, Trash2, RefreshCw, Search, CheckCheck, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const COLS = [
  { label: "ID",           w: "60px"  },
  { label: "App ID",       w: "140px" },
  { label: "Sub ID",       w: "90px"  },
  { label: "From",         w: "100px" },
  { label: "To",           w: "100px" },
  { label: "Type",         w: "90px"  },
  { label: "Content",      w: "auto"  },
  { label: "Sent At",      w: "130px" },
  { label: "",             w: "70px"  },
];

export default function Messages() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const parentRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading, refetch } = useQuery({
    queryKey: ["messages"],
    queryFn: () => api.listMessages(),
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  useAdminStream({
    onMessage: (newMsg) => {
      qc.setQueryData<MessageRow[]>(["messages"], (prev = []) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [newMsg, ...prev];
      });
    },
  });

  const readMut = useMutation({
    mutationFn: (id: number) => api.markRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["messages"] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteMessage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "Deleted" });
      setDeleteId(null);
    },
  });

  const allMessages = messages as MessageRow[];
  const allAppIds = Array.from(new Set(allMessages.map((m) => m.app_id)));
  const unread = allMessages.filter((m) => !m.is_read).length;

  const filtered = allMessages.filter((m) => {
    const matchApp = appFilter === "all" || m.app_id === appFilter;
    const q = search.toLowerCase();
    return matchApp && (!q ||
      m.app_id.toLowerCase().includes(q) ||
      (m.sub_id ?? "").toLowerCase().includes(q) ||
      (m.from_id ?? "").toLowerCase().includes(q) ||
      (m.to_id ?? "").toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.message_type.toLowerCase().includes(q)
    );
  });

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Messages
            {unread > 0 && (
              <span className="text-xs bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-medium">{unread}</span>
            )}
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> LIVE
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length !== allMessages.length
              ? `${filtered.length} of ${allMessages.length} messages`
              : `${unread} unread · ${allMessages.length} total`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="App ID, Sub ID, From ID, content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-44 h-8 text-sm">
            <SelectValue placeholder="Filter by App" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Apps</SelectItem>
            {allAppIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {allMessages.length === 0 ? "No messages yet." : "No results match your filter."}
              </p>
              {allMessages.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Messages will appear here once received from Android apps.
                </p>
              )}
            </div>
          ) : (
            <div
              ref={parentRef}
              className="overflow-auto"
              style={{ height: "calc(100vh - 260px)", minHeight: 320 }}
            >
              <table style={{ tableLayout: "fixed", width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
                <colgroup>
                  {COLS.map((c, i) => <col key={i} style={{ width: c.w }} />)}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr className="border-b">
                    {COLS.map((c, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap bg-muted/60">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ display: "block", height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const m = filtered[vRow.index];
                    return (
                      <tr
                        key={m.id}
                        className={cn("border-b hover:bg-muted/30 transition-colors", !m.is_read && "bg-orange-50/50 dark:bg-orange-950/10")}
                        style={{
                          display: "table",
                          tableLayout: "fixed",
                          width: "100%",
                          position: "absolute",
                          top: 0,
                          left: 0,
                          transform: `translateY(${vRow.start}px)`,
                          height: `${vRow.size}px`,
                        }}
                      >
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono" style={{ width: COLS[0].w }}>
                          <span className="flex items-center gap-1">
                            {!m.is_read && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />}
                            {m.id}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 truncate" style={{ width: COLS[1].w }}>
                          <span className="font-mono text-xs font-bold text-primary">{m.app_id}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground truncate" style={{ width: COLS[2].w }}>{m.sub_id ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground truncate" style={{ width: COLS[3].w }}>{m.from_id ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground truncate" style={{ width: COLS[4].w }}>{m.to_id ?? "—"}</td>
                        <td className="px-4 py-2.5" style={{ width: COLS[5].w }}>
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">{m.message_type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs" style={{ width: COLS[6].w, overflow: "hidden" }}>
                          <p className="truncate" title={m.content}>{m.content}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap" style={{ width: COLS[7].w }}>{fmt(m.sent_at)}</td>
                        <td className="px-4 py-2.5" style={{ width: COLS[8].w }}>
                          <div className="flex items-center gap-0.5">
                            {!m.is_read && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-green-500" title="Mark as read"
                                onClick={() => readMut.mutate(m.id)}>
                                <CheckCheck className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteId(m.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>This message will be permanently removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
