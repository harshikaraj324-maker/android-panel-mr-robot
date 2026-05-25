import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Device } from "@/lib/supabase";
import { Search, Trash2, AlertCircle, Smartphone, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

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

export default function Devices() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading, error, refetch } = useQuery<Device[]>({
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

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from("registered_devices")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update device status.", variant: "destructive" });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("registered_devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "Device deleted", description: "Device removed successfully." });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete device.", variant: "destructive" });
    },
  });

  const appIds = Array.from(new Set(devices.map((d) => d.app_id)));

  const filtered = devices.filter((d) => {
    const matchApp = appFilter === "all" || d.app_id === appFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (d.device_name ?? "").toLowerCase().includes(q) ||
      d.device_id.toLowerCase().includes(q) ||
      d.app_id.toLowerCase().includes(q) ||
      (d.device_model ?? "").toLowerCase().includes(q);
    return matchApp && matchSearch;
  });

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
          <p className="text-sm font-medium text-destructive">Failed to load devices</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Make sure the <code className="bg-muted px-1 rounded">registered_devices</code> table exists in Supabase.
          </p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">All Devices</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{devices.length} total devices</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, device ID, model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-app-filter">
            <SelectValue placeholder="Filter by App ID" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All App IDs</SelectItem>
            {appIds.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Smartphone className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {devices.length === 0 ? "No devices registered yet." : "No devices match your filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">App ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Device Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">Model</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Android</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Registered</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Active</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((device) => (
                    <tr
                      key={device.id}
                      className="hover:bg-muted/30 transition-colors"
                      data-testid={`row-device-${device.id}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          {device.app_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{device.device_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">{device.device_id}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{device.device_model ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{device.android_version ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{formatDate(device.registered_at)}</td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={device.is_active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: device.id, is_active: checked })
                          }
                          data-testid={`switch-active-${device.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(device.id)}
                          data-testid={`button-delete-${device.id}`}
                        >
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

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the device from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteDevice.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
