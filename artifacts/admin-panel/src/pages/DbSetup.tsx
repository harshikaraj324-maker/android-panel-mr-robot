import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Database, CheckCircle2, XCircle, RefreshCw,
  Wand2, ExternalLink, KeyRound, ArrowRight, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function DbSetup() {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: status, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["db-init"],
    queryFn: api.initStatus,
    retry: false,
    refetchInterval: (q) => (q.state.data?.tables_exist ? false : 0),
  });

  const setupMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      const d = await res.json() as { ok: boolean; message: string };
      if (!d.ok) throw new Error(d.message);
      return d;
    },
    onSuccess: () => {
      toast({ title: "✅ Tables Create Ho Gayi!", description: "Ab App IDs banana start karo!" });
      qc.invalidateQueries({ queryKey: ["db-init"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      setPat("");
      refetch();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const tablesOk = status?.tables_exist === true;

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground">Database Setup</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {tablesOk ? "Sab ready hai — App IDs banana shuru karo!" : "Sirf ek baar karna hai — phir sab kuch panel se auto-manage hoga"}
        </p>
      </div>

      {/* Status */}
      <Card className={tablesOk ? "border-green-200 dark:border-green-900/50" : ""}>
        <CardContent className="py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking tables...
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {tablesOk
                  ? <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                  : <XCircle className="w-6 h-6 text-destructive flex-shrink-0" />}
                <div>
                  <p className="text-sm font-semibold">
                    {tablesOk ? "Database Ready Hai! 🎉" : "Tables abhi nahi hain"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tablesOk
                      ? "app_ids + registered_devices — dono tables exist karti hain"
                      : "Neeche Supabase Access Token daalo — tables auto-bana do"}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-setup via PAT — only shown if tables don't exist */}
      {!tablesOk && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" /> Auto Setup — Sirf 2 Steps
            </CardTitle>
            <CardDescription className="text-xs">
              SQL editor khulne ki zaroorat nahi — bas ek token paste karo, baaki sab automatic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Supabase Access Token generate karo</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supabase Account Settings kholo → "Access Tokens" → "Generate new token"
                </p>
                <a
                  href="https://supabase.com/dashboard/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  supabase.com/dashboard/account/tokens
                </a>
                <p className="text-[11px] text-muted-foreground mt-1.5 bg-muted px-2 py-1 rounded">
                  💡 Yeh SQL editor nahi hai — sirf Account Settings ka ek token hai. Copy karo aur neeche paste karo.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Token yahan paste karo → Auto Setup!</p>
                <div className="flex gap-2 mt-2">
                  <div className="relative flex-1">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type={showPat ? "text" : "password"}
                      placeholder="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={pat}
                      onChange={(e) => setPat(e.target.value)}
                      className="pl-8 pr-16 font-mono text-xs"
                      data-testid="input-pat"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPat(!showPat)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground px-1"
                    >
                      {showPat ? "hide" : "show"}
                    </button>
                  </div>
                  <Button
                    onClick={() => setupMut.mutate()}
                    disabled={!pat.trim() || setupMut.isPending}
                    className="shrink-0"
                    data-testid="button-auto-setup"
                  >
                    {setupMut.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Setting up...</>
                    ) : (
                      <><ArrowRight className="w-4 h-4 mr-1.5" /> Setup Karo</>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Token sirf table banane ke liye use hoga — store nahi hoga, ek baar ka kaam hai ✓
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success state */}
      {tablesOk && (
        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-700 dark:text-green-400">Database fully ready!</p>
                <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                  "App IDs & Login" page pe jao aur pehla App ID banao 🚀
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info box */}
      <div className="rounded-md border border-dashed p-4 space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground">Kya create hoga?</p>
        <div className="space-y-1">
          {[
            ["app_ids", "App IDs, passwords, 30-day sessions"],
            ["registered_devices", "Android devices jo register honge"],
          ].map(([table, desc]) => (
            <div key={table} className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-xs text-foreground">{table}</span>
              <span className="text-[11px] text-muted-foreground">— {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
