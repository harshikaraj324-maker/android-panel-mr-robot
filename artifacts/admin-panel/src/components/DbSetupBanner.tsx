import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Database, Copy, ExternalLink, CheckCircle2, Loader2, RefreshCw, KeyRound, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SUPABASE_PROJECT_REF = "dvgcrxrnnezbdjpujjjt";
const SUPABASE_SQL_URL = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new`;
const SUPABASE_PAT_URL = "https://supabase.com/dashboard/account/tokens";

export default function DbSetupBanner() {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["db-status"],
    queryFn: () => api.getDbStatus(),
    refetchInterval: (q) => q.state.data?.tables_ready ? false : 12000,
  });

  async function handleSetup() {
    const token = pat.trim();
    const sql = status?.setup_sql;
    if (!token || !sql) return;
    setLoading(true);
    try {
      // Call Supabase Management API DIRECTLY from browser (user's IP, not server's — avoids Cloudflare block)
      const mgmtRes = await fetch(
        `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ query: sql }),
        }
      );

      if (!mgmtRes.ok) {
        const errBody = await mgmtRes.text().catch(() => "");
        toast({
          title: "Setup failed",
          description: mgmtRes.status === 401
            ? "Invalid token — make sure you copied the full token from supabase.com/dashboard/account/tokens"
            : `Error ${mgmtRes.status}: ${errBody.slice(0, 120)}`,
          variant: "destructive",
        });
        return;
      }

      // Tables created! Also notify backend to save PAT for future (best-effort)
      api.setup(token).catch(() => undefined);

      toast({ title: "Tables created!", description: "Database is ready — this won't be needed again." });
      setPat("");
      qc.invalidateQueries({ queryKey: ["db-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      // Wait a moment then refetch to confirm
      setTimeout(() => refetch(), 1500);
    } catch (err) {
      toast({
        title: "Network error",
        description: err instanceof Error ? err.message : "Could not reach Supabase API",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function copySql() {
    if (!status?.setup_sql) return;
    navigator.clipboard.writeText(status.setup_sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "SQL copied!", description: "Paste it in the Supabase SQL Editor and run it." });
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
            One-time setup — paste your Supabase Access Token and tables are created automatically.
          </p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-orange-600 flex-shrink-0" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* PAT input */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-orange-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
          <a
            href={SUPABASE_PAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
          >
            Get token from supabase.com/dashboard/account/tokens <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-orange-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
          <p className="text-xs font-medium text-orange-700 dark:text-orange-400">Paste below → click Setup</p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-orange-400" />
            <Input
              type={showPat ? "text" : "password"}
              placeholder="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pat.trim() && !loading && handleSetup()}
              className="pl-9 pr-14 font-mono text-xs border-orange-300 focus:border-orange-500"
            />
            <button
              type="button"
              onClick={() => setShowPat(!showPat)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-orange-500 hover:text-orange-700 px-1"
            >
              {showPat ? "hide" : "show"}
            </button>
          </div>
          <Button
            className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
            onClick={handleSetup}
            disabled={!pat.trim() || loading}
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Setting up...</>
              : <><ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Setup</>}
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 border-t border-orange-200 dark:border-orange-800" />
        <span className="text-[10px] text-orange-500 font-medium uppercase">or run SQL manually</span>
        <div className="flex-1 border-t border-orange-200 dark:border-orange-800" />
      </div>

      {/* Manual SQL */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100"
          onClick={() => window.open(SUPABASE_SQL_URL, "_blank")}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" /> Open SQL Editor
        </Button>
        <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100"
          onClick={copySql}>
          {copied
            ? <><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-600" /> Copied!</>
            : <><Copy className="w-3.5 h-3.5 mr-2" /> Copy SQL</>}
        </Button>
        <Button size="sm" variant="ghost" className="text-orange-600 hover:bg-orange-100"
          onClick={() => setShowSql(!showSql)}>
          {showSql ? "Hide SQL" : "Show SQL"}
        </Button>
      </div>
      {showSql && status?.setup_sql && (
        <pre className={cn(
          "text-[10px] bg-orange-900/10 dark:bg-orange-900/20 rounded-lg p-3 overflow-x-auto overflow-y-auto font-mono text-orange-900 dark:text-orange-200 border border-orange-200 dark:border-orange-800",
          "max-h-56 whitespace-pre"
        )}>
          {status.setup_sql}
        </pre>
      )}
    </div>
  );
}
