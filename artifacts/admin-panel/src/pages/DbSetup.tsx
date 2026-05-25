import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Database, CheckCircle2, XCircle, Copy, Check, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const SQL = `-- Step 1: App IDs table (login/password ke liye)
CREATE TABLE IF NOT EXISTS app_ids (
  id bigint generated always as identity primary key,
  app_id text not null unique,
  password_hash text not null,
  salt text not null,
  admin_label text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  is_active boolean default true
);

-- Step 2: Registered Devices table (Android app data)
CREATE TABLE IF NOT EXISTS registered_devices (
  id bigint generated always as identity primary key,
  app_id text not null,
  device_id text not null,
  device_name text,
  device_model text,
  android_version text,
  registered_at timestamptz default now(),
  is_active boolean default true,
  last_seen timestamptz,
  admin_id text
);

-- Step 3: Row Level Security enable karo
ALTER TABLE app_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE registered_devices ENABLE ROW LEVEL SECURITY;

-- Step 4: Policies (service_role = full access, anon = devices read/write)
CREATE POLICY "service_role_all_app_ids" ON app_ids
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_devices" ON registered_devices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_devices" ON registered_devices
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_write_devices" ON registered_devices
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_devices" ON registered_devices
  FOR UPDATE TO anon USING (true);

-- Step 5: Indexes (fast lookup ke liye)
CREATE INDEX IF NOT EXISTS idx_devices_app_id ON registered_devices(app_id);
CREATE INDEX IF NOT EXISTS idx_app_ids_app_id ON app_ids(app_id);`;

export default function DbSetup() {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: init, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["db-init"],
    queryFn: api.init,
    retry: false,
  });

  const tablesOk = init?.tables_exist === true;

  function copySQL() {
    navigator.clipboard.writeText(SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "SQL copied!", description: "Supabase SQL Editor mein paste karo." });
    });
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground">Database Setup</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Tables check karo aur setup karo — sirf ek baar karna hai</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> Table Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Checking tables...
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {tablesOk ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-destructive" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {tablesOk ? "Tables ready hain!" : "Tables nahi mili"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tablesOk
                      ? "app_ids aur registered_devices dono tables exist karti hain. App use karne ke liye ready hai."
                      : "app_ids ya registered_devices table nahi mili. Neeche SQL run karo."}
                  </p>
                </div>
              </div>

              {init?.app_ids_error && (
                <div className="text-xs bg-destructive/10 text-destructive px-3 py-2 rounded">
                  <strong>app_ids error:</strong> {init.app_ids_error}
                </div>
              )}
              {init?.devices_error && (
                <div className="text-xs bg-destructive/10 text-destructive px-3 py-2 rounded">
                  <strong>registered_devices error:</strong> {init.devices_error}
                </div>
              )}

              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-recheck">
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
                {isFetching ? "Checking..." : "Re-check Tables"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* SQL Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Setup SQL (sirf ek baar run karo)</CardTitle>
          <CardDescription className="text-xs">
            Supabase Dashboard → SQL Editor → Neeche SQL paste karo → Run
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={copySQL} data-testid="button-copy-sql">
              {copied ? <><Check className="w-3.5 h-3.5 mr-1.5 text-green-500" /> Copied!</> : <><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy SQL</>}
            </Button>
          </div>
          <pre className="bg-muted rounded-md p-4 text-[11px] overflow-x-auto font-mono text-foreground/80 leading-relaxed max-h-80 overflow-y-auto">
            {SQL}
          </pre>
        </CardContent>
      </Card>

      {/* Steps */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Setup Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            "Supabase Dashboard kholo: https://supabase.com/dashboard",
            "Apna project select karo (dvgcrxrnnezbdjpujjjt)",
            "SQL Editor mein jao (left sidebar mein)",
            "Upar SQL copy karo aur paste karo",
            "Run karke wapas yahan aao aur 'Re-check Tables' dabaao",
            "Green checkmark aaye toh App IDs banao!",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-xs text-muted-foreground">{step}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
