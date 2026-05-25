import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Device } from "@/lib/supabase";
import { Link } from "wouter";
import { Smartphone, CheckCircle2, AlertCircle, Layers, ChevronRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function useAllDevices() {
  return useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registered_devices")
        .select("*")
        .order("registered_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { data: devices = [], isLoading, error } = useAllDevices();

  const totalDevices = devices.length;
  const activeDevices = devices.filter((d) => d.is_active).length;
  const inactiveDevices = totalDevices - activeDevices;

  // Group by app_id
  const appMap = new Map<string, Device[]>();
  for (const d of devices) {
    if (!appMap.has(d.app_id)) appMap.set(d.app_id, []);
    appMap.get(d.app_id)!.push(d);
  }
  const appSummaries = Array.from(appMap.entries()).map(([app_id, devs]) => ({
    app_id,
    device_count: devs.length,
    active_count: devs.filter((d) => d.is_active).length,
    last_registered: devs[0]?.registered_at ?? null,
  }));

  const recent = devices.slice(0, 5);

  const stats = [
    { label: "Total Devices", value: totalDevices, icon: Smartphone, color: "text-primary" },
    { label: "Active", value: activeDevices, icon: CheckCircle2, color: "text-green-500" },
    { label: "Inactive", value: inactiveDevices, icon: AlertCircle, color: "text-yellow-500" },
    { label: "App IDs", value: appSummaries.length, icon: Layers, color: "text-purple-500" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading devices...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-destructive">Failed to load data</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
          <p className="text-xs text-muted-foreground mt-2">Check if the <code className="bg-muted px-1 rounded">registered_devices</code> table exists in your Supabase project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-foreground">Dashboard</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Overview of all registered devices</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
                </div>
                <Icon className={`w-8 h-8 ${color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* App IDs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              App IDs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {appSummaries.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">No app IDs registered yet.</p>
                <Link href="/setup" data-testid="link-setup-empty" className="text-xs text-primary mt-1 inline-block hover:underline">
                  Create an App ID
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {appSummaries.map((app) => (
                  <li key={app.app_id}>
                    <Link
                      href={`/app/${app.app_id}`}
                      data-testid={`link-app-${app.app_id}`}
                      className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/50 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-semibold text-foreground font-mono">{app.app_id}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {app.active_count} active / {app.device_count} total
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Recently Registered
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">No devices registered yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((d) => (
                  <li key={d.id} className="px-6 py-3.5" data-testid={`row-recent-${d.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{d.device_name ?? d.device_id}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{d.app_id}</span>
                          {" · "}
                          {d.device_model ?? "Unknown model"}
                        </p>
                      </div>
                      <div className="ml-4 flex-shrink-0 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}>
                          {d.is_active ? "Active" : "Inactive"}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(d.registered_at)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
