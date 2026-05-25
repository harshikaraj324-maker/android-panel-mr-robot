import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import { Link } from "wouter";
import {
  Smartphone, CheckCircle2, KeyRound, Clock, ChevronRight,
  TrendingUp, RefreshCw, MessageSquare, Activity, AlertCircle,
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
  const d = Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
  return d;
}

export default function Dashboard() {
  const { data: stats, isLoading: sl, refetch } = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const { data: appData, isLoading: al } = useQuery({ queryKey: ["app-ids"], queryFn: api.listAppIds });
  const appIds: AppIdRow[] = appData?.rows ?? [];

  const statCards = [
    { label: "Total Apps", value: stats?.total_apps ?? 0, sub: `${stats?.active_apps ?? 0} active`, icon: KeyRound, color: "text-primary", bg: "bg-primary/10" },
    { label: "Devices", value: stats?.total_devices ?? 0, sub: `${stats?.active_devices ?? 0} active`, icon: Smartphone, color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/20" },
    { label: "Live Sessions", value: stats?.active_sessions ?? 0, sub: `${stats?.total_sessions ?? 0} total`, icon: Activity, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/20" },
    { label: "Unread Msgs", value: stats?.unread_messages ?? 0, sub: "messages inbox", icon: MessageSquare, color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/20" },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Dashboard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Sab kuch ek jagah — live overview</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* DB Setup Banner — only shows if tables not created yet */}
      <DbSetupBanner />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-2xl font-bold mt-1">{sl ? "—" : value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                </div>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", bg)}>
                  <Icon className={cn("w-4 h-4", color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* App IDs table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> All Apps — Live Status
          </CardTitle>
          <Link href="/apps" className="text-xs text-primary hover:underline">View All →</Link>
        </CardHeader>
        <CardContent className="p-0">
          {al ? (
            <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : appIds.length === 0 ? (
            <div className="py-10 text-center">
              <KeyRound className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Koi App ID nahi hai.</p>
              <Link href="/apps" className="text-xs text-primary mt-1 inline-block hover:underline">Pehla App ID banao →</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {["", "App ID", "Name", "PIN", "Status", "Devices", "Sessions", "Expires", ""].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {appIds.map((app) => {
                    const expired = app.expires_at && new Date(app.expires_at) < new Date();
                    const dl = app.expires_at ? daysLeft(app.expires_at) : null;
                    const isActive = app.status === "active" && !expired;
                    return (
                      <tr key={app.app_id} className="hover:bg-muted/30 transition-colors">
                        <td className="pl-4 py-2.5">
                          <span className={cn("w-2 h-2 rounded-full inline-block", isActive ? "bg-green-500" : "bg-red-400")} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-xs font-bold">{app.app_id}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{app.name ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{app.pin}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium capitalize",
                            app.status === "active" && !expired ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : app.status === "disabled" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-muted text-muted-foreground"
                          )}>
                            {expired ? "expired" : app.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {app.active_count}/{app.device_count}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{app.active_sessions}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {dl != null ? (
                            <span className={cn(dl <= 0 ? "text-red-500" : dl <= 5 ? "text-orange-500" : "text-muted-foreground")}>
                              {dl <= 0 ? "Expired" : `${dl}d left`}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/app/${app.app_id}`} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
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
          { href: "/sessions", label: "Sessions", icon: Clock, sub: "Active logins dekho" },
          { href: "/form-data", label: "Form Data", icon: TrendingUp, sub: "Submitted forms" },
          { href: "/messages", label: "Messages", icon: MessageSquare, sub: "User messages" },
        ].map(({ href, label, icon: Icon, sub }) => (
          <Link key={href} href={href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className="w-5 h-5 text-primary/70 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{sub}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
