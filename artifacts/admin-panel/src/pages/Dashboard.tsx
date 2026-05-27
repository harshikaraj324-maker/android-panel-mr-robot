import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import { Link } from "wouter";
import {
  Smartphone, CheckCircle2, KeyRound, Clock, ChevronRight,
  TrendingUp, RefreshCw, MessageSquare, Activity, Zap, Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DbSetupBanner from "@/components/DbSetupBanner";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysLeft(expires: string) {
  return Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
}

export default function Dashboard() {
  const { data: stats, isLoading: sl, refetch } = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 8000 });
  const { data: appData, isLoading: al } = useQuery({ queryKey: ["app-ids"], queryFn: api.listAppIds, refetchInterval: 10000 });
  const appIds: AppIdRow[] = appData?.rows ?? [];

  const statCards = [
    {
      label: "Total Apps", value: stats?.total_apps ?? 0, sub: `${stats?.active_apps ?? 0} active`,
      icon: KeyRound,
      gradient: "from-cyan-500/20 to-cyan-500/5",
      border: "border-cyan-500/20",
      glow: "shadow-[0_0_20px_rgba(0,212,255,0.08)]",
      iconBg: "bg-cyan-500/10 border border-cyan-500/20",
      iconColor: "text-cyan-400",
      valueColor: "text-cyan-300",
    },
    {
      label: "Devices", value: stats?.total_devices ?? 0, sub: `${stats?.active_devices ?? 0} active`,
      icon: Smartphone,
      gradient: "from-green-500/20 to-green-500/5",
      border: "border-green-500/20",
      glow: "shadow-[0_0_20px_rgba(0,255,136,0.08)]",
      iconBg: "bg-green-500/10 border border-green-500/20",
      iconColor: "text-green-400",
      valueColor: "text-green-300",
    },
    {
      label: "Live Sessions", value: stats?.active_sessions ?? 0, sub: `${stats?.total_sessions ?? 0} total`,
      icon: Activity,
      gradient: "from-blue-500/20 to-blue-500/5",
      border: "border-blue-500/20",
      glow: "shadow-[0_0_20px_rgba(59,130,246,0.08)]",
      iconBg: "bg-blue-500/10 border border-blue-500/20",
      iconColor: "text-blue-400",
      valueColor: "text-blue-300",
    },
    {
      label: "Unread Messages", value: stats?.unread_messages ?? 0, sub: "in inbox",
      icon: MessageSquare,
      gradient: "from-orange-500/20 to-orange-500/5",
      border: "border-orange-500/20",
      glow: "shadow-[0_0_20px_rgba(249,115,22,0.08)]",
      iconBg: "bg-orange-500/10 border border-orange-500/20",
      iconColor: "text-orange-400",
      valueColor: "text-orange-300",
    },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2.5 font-mono tracking-wide">
            <Shield className="w-4 h-4 text-primary" />
            DASHBOARD
            <span className="flex items-center gap-1 text-[9px] font-mono font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
            </span>
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Auto-refresh every 8s // All systems nominal</p>
        </div>
        <Button size="sm" variant="outline"
          className="h-7 px-2.5 text-xs font-mono border-border hover:border-primary/40 hover:text-primary transition-all"
          onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1.5" /> Sync
        </Button>
      </div>

      <DbSetupBanner />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map(({ label, value, sub, icon: Icon, gradient, border, glow, iconBg, iconColor, valueColor }) => (
          <div key={label}
            className={cn("rounded-xl p-4 bg-gradient-to-br border transition-all duration-200 hover:scale-[1.01]", gradient, border, glow)}>
            <div className="flex items-start justify-between mb-3">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
                <Icon className={cn("w-4 h-4", iconColor)} />
              </div>
              <Zap className="w-3 h-3 text-muted-foreground/20" />
            </div>
            <p className={cn("text-2xl font-bold font-mono", valueColor)}>{sl ? "—" : value}</p>
            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-mono mt-0.5">{label}</p>
            <p className="text-[9px] text-muted-foreground/40 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* App IDs table */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between border-b border-border/50">
          <CardTitle className="text-xs font-mono font-semibold flex items-center gap-2 text-foreground/80 uppercase tracking-wider">
            <KeyRound className="w-3.5 h-3.5 text-primary" /> All Apps — Live Status
          </CardTitle>
          <Link href="/apps" className="text-[10px] font-mono text-primary/70 hover:text-primary transition-colors">
            View All →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {al ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : appIds.length === 0 ? (
            <div className="py-10 text-center">
              <KeyRound className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/50 font-mono">No App IDs yet.</p>
              <Link href="/apps" className="text-[10px] text-primary/60 mt-1 inline-block hover:text-primary transition-colors font-mono">
                Create first App ID →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    {["", "App ID", "Name", "PIN", "Status", "Devices", "Sessions", "Expires", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2.5 text-[9px] font-mono font-semibold text-muted-foreground/50 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {appIds.map((app) => {
                    const expired = app.expires_at && new Date(app.expires_at) < new Date();
                    const dl = app.expires_at ? daysLeft(app.expires_at) : null;
                    const isActive = app.status === "active" && !expired;
                    return (
                      <tr key={app.app_id} className="hover:bg-primary/3 transition-colors group">
                        <td className="pl-4 py-3">
                          <span className={cn("w-1.5 h-1.5 rounded-full inline-block",
                            isActive ? "bg-green-400 shadow-[0_0_6px_rgba(0,255,136,0.6)]" : "bg-red-400/60")} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] font-bold text-primary/80 bg-primary/8 px-2 py-0.5 rounded border border-primary/15">{app.app_id}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/60">{app.name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/40">{app.pin}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-mono font-medium uppercase tracking-wider border",
                            isActive
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : app.status === "disabled"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-muted/50 text-muted-foreground/50 border-border/50"
                          )}>
                            {expired ? "expired" : app.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/50">{app.active_count}/{app.device_count}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/50">{app.active_sessions}</td>
                        <td className="px-4 py-3 font-mono text-[10px] whitespace-nowrap">
                          {dl != null ? (
                            <span className={cn(
                              dl <= 0 ? "text-red-400" : dl <= 5 ? "text-orange-400" : "text-muted-foreground/40"
                            )}>
                              {dl <= 0 ? "Expired" : `${dl}d`}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/app/${app.app_id}`}
                            className="text-[9px] font-mono text-primary/40 hover:text-primary group-hover:text-primary/70 transition-colors flex items-center gap-0.5">
                            View <ChevronRight className="w-3 h-3" />
                          </Link>
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

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { href: "/sessions", label: "Sessions", icon: Clock, sub: "Active logins", color: "text-blue-400", bg: "from-blue-500/10 to-blue-500/3", border: "border-blue-500/15" },
          { href: "/form-data", label: "Form Data", icon: TrendingUp, sub: "Submitted forms", color: "text-cyan-400", bg: "from-cyan-500/10 to-cyan-500/3", border: "border-cyan-500/15" },
          { href: "/messages", label: "Messages", icon: MessageSquare, sub: "User messages", color: "text-orange-400", bg: "from-orange-500/10 to-orange-500/3", border: "border-orange-500/15" },
        ].map(({ href, label, icon: Icon, sub, color, bg, border }) => (
          <Link key={href} href={href}>
            <div className={cn("rounded-xl p-4 bg-gradient-to-br border cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg", bg, border)}>
              <Icon className={cn("w-4 h-4 mb-2", color)} />
              <p className="text-xs font-mono font-semibold text-foreground/80">{label}</p>
              <p className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">{sub}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
