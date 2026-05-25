import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Database, Copy, ExternalLink, CheckCircle2, Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SUPABASE_SQL_URL = "https://supabase.com/dashboard/project/dvgcrxrnnezbdjpujjjt/sql/new";

export default function DbSetupBanner() {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["db-status"],
    queryFn: () => api.getDbStatus(),
    refetchInterval: (q) => q.state.data?.tables_ready ? false : 10000,
  });

  const autoSetupMut = useMutation({
    mutationFn: () => api.runSetup(),
    onSuccess: (d) => {
      if (d.ok) {
        toast({ title: "Tables created successfully!", description: "All Supabase tables are ready." });
        qc.invalidateQueries({ queryKey: ["db-status"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        refetch();
      } else {
        toast({ title: "Auto setup failed", description: d.error ?? "Please run the SQL manually.", variant: "destructive" });
        setShowSql(true);
      }
    },
    onError: () => { setShowSql(true); toast({ title: "Please run the SQL manually below.", variant: "destructive" }); },
  });

  function copySql() {
    if (!status?.setup_sql) return;
    navigator.clipboard.writeText(status.setup_sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "SQL copied!", description: "Paste it into the Supabase SQL Editor and run it." });
  }

  if (isLoading) return null;
  if (status?.tables_ready) return null;

  return (
    <div className="rounded-xl border-2 border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
          <Database className="w-5 h-5 text-orange-600" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-orange-800 dark:text-orange-300">Database Setup Required</h3>
          <p className="text-sm text-orange-700 dark:text-orange-400 mt-0.5">
            Tables need to be created once in your Supabase project before you can use the panel.
          </p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-orange-600" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Step 1: Try Auto */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">Step 1 — Try Auto Setup</p>
        <Button
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
          onClick={() => autoSetupMut.mutate()}
          disabled={autoSetupMut.isPending}
        >
          {autoSetupMut.isPending
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Creating tables...</>
            : <><Database className="w-3.5 h-3.5 mr-2" /> Auto-Create Tables</>}
        </Button>
        <p className="text-[10px] text-orange-600/70">
          If this works, nothing else is needed. If it fails, follow Step 2.
        </p>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 border-t border-orange-200 dark:border-orange-800" />
        <span className="text-[10px] text-orange-500 font-medium uppercase">or</span>
        <div className="flex-1 border-t border-orange-200 dark:border-orange-800" />
      </div>

      {/* Step 2: Manual */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">Step 2 — Run SQL Manually</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-100"
            onClick={() => window.open(SUPABASE_SQL_URL, "_blank")}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-2" /> Open Supabase SQL Editor
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-100"
            onClick={copySql}
          >
            {copied
              ? <><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-600" /> Copied!</>
              : <><Copy className="w-3.5 h-3.5 mr-2" /> Copy SQL</>}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-orange-600 hover:bg-orange-100"
            onClick={() => setShowSql(!showSql)}
          >
            {showSql ? <><ChevronUp className="w-3.5 h-3.5 mr-1" /> Hide SQL</> : <><ChevronDown className="w-3.5 h-3.5 mr-1" /> Show SQL</>}
          </Button>
        </div>
        <p className="text-[10px] text-orange-600/70">
          Open SQL Editor → Paste SQL → Run → Come back → Click Refresh above
        </p>
      </div>

      {/* SQL preview */}
      {showSql && status?.setup_sql && (
        <div className="relative">
          <pre className={cn(
            "text-[10px] bg-orange-900/10 dark:bg-orange-900/20 rounded-lg p-3 overflow-x-auto overflow-y-auto font-mono text-orange-900 dark:text-orange-200 border border-orange-200 dark:border-orange-800",
            "max-h-64 whitespace-pre"
          )}>
            {status.setup_sql}
          </pre>
          <button
            onClick={copySql}
            className="absolute top-2 right-2 bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/40 dark:hover:bg-orange-900/60 rounded px-2 py-1 text-[9px] text-orange-700 dark:text-orange-300 font-medium transition-colors"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
