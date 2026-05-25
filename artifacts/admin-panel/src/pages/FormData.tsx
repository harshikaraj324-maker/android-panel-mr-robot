import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FormDataRow } from "@/lib/api";
import { FileText, Trash2, RefreshCw, Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DataViewer({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(data);
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

export default function FormData() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: formData = [], isLoading, refetch } = useQuery({
    queryKey: ["form-data"],
    queryFn: () => api.listFormData(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteFormData(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["form-data"] }); toast({ title: "Deleted" }); },
  });

  const appIds = Array.from(new Set((formData as FormDataRow[]).map((f) => f.app_id)));
  const formTypes = Array.from(new Set((formData as FormDataRow[]).map((f) => f.form_type)));

  const filtered = (formData as FormDataRow[]).filter((f) => {
    const matchApp = appFilter === "all" || f.app_id === appFilter;
    const matchType = typeFilter === "all" || f.form_type === typeFilter;
    const q = search.toLowerCase();
    return matchApp && matchType && (!q || f.app_id.toLowerCase().includes(q) || (f.sub_id ?? "").toLowerCase().includes(q) || f.form_type.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Form Data</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{formData.length} total submissions</p>
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
              <p className="text-sm text-muted-foreground">{formData.length === 0 ? "No form submissions yet." : "No results match your filter."}</p>
              <p className="text-xs text-muted-foreground mt-1">Submissions will appear here once forms are submitted from the Android app.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {["App ID", "Sub ID", "Form Type", "Data", "Submitted At", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((f) => (
                    <tr key={f.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold">{f.app_id}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{f.sub_id ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">{f.form_type}</span>
                      </td>
                      <td className="px-4 py-2.5"><DataViewer data={f.data} /></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(f.submitted_at)}</td>
                      <td className="px-4 py-2.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMut.mutate(f.id)}>
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
    </div>
  );
}
