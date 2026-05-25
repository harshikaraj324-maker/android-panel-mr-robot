import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import { Link } from "wouter";
import { Smartphone, CheckCircle2, AlertCircle, KeyRound, Clock, ChevronRight, TrendingUp, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsErr, refetch: refetchStats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
  });

  const { data: appIds = [], isLoading: appsLoading } = useQuery({
    queryKey: ["app-ids"],
    queryFn: api.listAppIds,
  });

  if (statsErr) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-sm font-medium text-destructive">{(statsErr as Error).message}</p>
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Tables may not exist yet. Go to <Link href="/setup" className="text-primary hover:underline">DB Setup</Link> to create them.
        </p>
        <Button size="sm" variant="outline" onClick={() => refetchStats()}>
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  const statCards = [
    { label: "App IDs", value: statsLoading ? "—" : stats?.total_apps ?? 0, sub: `${stats?.active_apps ?? 0} active`, icon: KeyRound, color: "text-primary" },
    { label: "Total Devices", value: statsLoading ? "—" : stats?.total_devices ?? 0, sub: `${stats?.active_devices ?? 0} active`, icon: Smartphone, color: "text-green-500" },
    { label: "Inactive Devices", value: statsLoading ? "—" : (stats ? stats.total_devices - stats.active_devices : 0), sub: "deactivated", icon: AlertCircle, color: "text-yellow-500" },
    { label: "New (7 days)", value: statsLoading ? "—" : stats?.recent_devices_7d ?? 0, sub: "recently registered", icon: TrendingUp, color: "text-purple-500" },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Dashboard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">All Apps ka overview — sab kuch ek jagah</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetchStats()} data-testid="button-refresh">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label} data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                </div>
                <Icon className={`w-7 h-7 ${color} opacity-70 mt-0.5`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            Registered App IDs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {appsLoading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : appIds.length === 0 ? (
            <div className="py-10 text-center">
              <KeyRound className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Koi App ID nahi hai.</p>
              <Link href="/app-ids" data-testid="link-create-appid" className="text-xs text-primary mt-1 inline-block hover:underline">App ID banao</Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {appIds.map((app: AppIdRow) => (
                <li key={app.app_id}>
                  <Link href={`/app/${app.app_id}`} data-testid={`link-app-${app.app_id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${app.is_active ? "bg-green-500" : "bg-yellow-400"}`} />
                      <div>
                        <p className="text-sm font-bold font-mono text-foreground">{app.app_id}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {app.admin_label && <span className="mr-2">{app.admin_label}</span>}
                          {app.active_count} active / {app.device_count} total devices
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground hidden sm:block">{formatDate(app.created_at)}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
