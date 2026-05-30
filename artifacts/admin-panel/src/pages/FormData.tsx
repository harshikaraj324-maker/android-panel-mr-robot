import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/lib/api";
import type { FormDataRow } from "@/lib/api";
import { useAdminStream } from "@/hooks/useAdminStream";
import { FileText, Trash2, RefreshCw, Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DataViewer({ data }: { data: Record<string, unknown> | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(data ?? {});
  const preview = entries.slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{preview}{entries.length > 2 ? ` +${entries.length - 2} more` : ""}</p>
      <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5">
        {expanded ? <><ChevronUp className="w-3 h-3" /> Hide</> : <><ChevronDown className="w-3 h-3" /> View all</>}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 bg-muted rounded text-[10px] font-mono overflow-x-auto max-w-[300px] max-h-32">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

const COLS = [
  { label: "App ID",       w: "140px" },
  { label: "Sub ID",       w: "90px"  },
  { label: "Form Type",    w: "120px" },
  { label: "Data",         w: "auto"  },
  { label: "Submitted At", w: "130px" },
  { label: "",             w: "46px"  },
];

export default function FormData() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const qc = useQueryClient();
  const { toast } = useToast();
  const parentRef = useRef<HTMLDivElement>(null);

  const { data: formData = [], isLoading, refetch } = useQuery({
    queryKey: ["form-data"],
    queryFn: () => api.listFormData(),
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  useAdminStream({
    onFormData: (newForm) => {
      qc.setQueryData<FormDataRow[]>(["form-data"], (prev = []) => {
        if (prev.some((f) => f.id === newForm.id)) return prev;
        return [newForm, ...prev];
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteFormData(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["form-data"] }); toast({ title: "Deleted" }); },
  });

  const allData = formData as FormDataRow[];
  const appIds = Array.from(new Set(allData.map((f) => f.app_id)));
  const formTypes = Array.from(new Set(allData.map((f) => f.form_type)));

  const filtered = allData.filter((f) => {
    const matchApp = appFilter === "all" || f.app_id === appFilter;
    const matchType = typeFilter === "all" || f.form_type === typeFilter;
    const q = search.toLowerCase();
    return matchApp && matchType && (!q || f.app_id.toLowerCase().includes(q) || (f.sub_id ?? "").toLowerCase().includes(q) || f.form_type.toLowerCase().includes(q));
  });

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> Form Data
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> LIVE
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length !== allData.length
              ? `${filtered.length} of ${allData.length} submissions`
              : `${allData.length} total submissions`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="App ID, Sub ID, Form type..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-40 h-8 text-sm"><SelectValue placeholder="App ID" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Apps</SelectItem>
            {appIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-36 h-8 text-sm"><SelectValue placeholder="Form Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {formTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{allData.length === 0 ? "No form submissions yet." : "No results match your filter."}</p>
              <p className="text-xs text-muted-foreground mt-1">Submissions will appear here once forms are submitted from the Android app.</p>
            </div>
          ) : (
            <div
              ref={parentRef}
              className="overflow-auto"
              style={{ height: "calc(100vh - 260px)", minHeight: 320 }}
            >
              <table style={{ tableLayout: "fixed", width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
                <colgroup>
                  {COLS.map((c, i) => <col key={i} style={{ width: c.w }} />)}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr className="border-b">
                    {COLS.map((c, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/60">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ display: "block", height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const f = filtered[vRow.index];
                    return (
                      <tr
                        key={f.id}
                        className="border-b hover:bg-muted/30 transition-colors"
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
                        <td className="px-4 py-2.5 font-mono text-xs font-bold truncate" style={{ width: COLS[0].w }}>{f.app_id}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground truncate" style={{ width: COLS[1].w }}>{f.sub_id ?? "—"}</td>
                        <td className="px-4 py-2.5" style={{ width: COLS[2].w }}>
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">{f.form_type}</span>
                        </td>
                        <td className="px-4 py-2.5" style={{ width: COLS[3].w, overflow: "hidden" }}>
                          <DataViewer data={f.data} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap" style={{ width: COLS[4].w }}>{fmt(f.submitted_at)}</td>
                        <td className="px-4 py-2.5" style={{ width: COLS[5].w }}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMut.mutate(f.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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
    </div>
  );
}
