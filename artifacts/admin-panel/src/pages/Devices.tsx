import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DeviceRow } from "@/lib/api";
import { Search, Trash2, AlertCircle, Smartphone, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Devices() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading, error, refetch } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.listDevices(),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => api.toggleDevice(id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
    onError: () => toast({ title: "Error", description: "Status update nahi hua.", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "Device deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Error", description: "Delete nahi hua.", variant: "destructive" }),
  });

  const appIds = Array.from(new Set((devices as DeviceRow[]).map((d) => d.app_id)));

  const filtered = (devices as DeviceRow[]).filter((d) => {
    const matchApp = appFilter === "all" || d.app_id === appFilter;
    const q = search.toLowerCase();
    return matchApp && (!q || (d.device_name ?? "").toLowerCase().includes(q) || d.device_id.toLowerCase().includes(q) || d.app_id.toLowerCase().includes(q) || (d.device_model ?? "").toLowerCase().includes(q));
  });

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <AlertCircle className="w-10 h-10 text-destructive" />
      <p className="text-sm text-destructive">{(error as Error).message}</p>
      <Link href="/setup" className="text-xs text-primary hover:underline">DB Setup karo pehle</Link>
      <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Retry</Button>
    </div>
  );

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">All Devices</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{devices.length} total devices across all App IDs</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Device name, ID, model..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-search" />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-44 h-8 text-sm" data-testid="select-app-filter">
            <SelectValue placeholder="Filter by App ID" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All App IDs</SelectItem>
            {appIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <Smartphone className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{devices.length === 0 ? "Abhi koi device register nahi hai." : "Koi device filter se match nahi kiya."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["App ID", "Device Name", "Model", "Android", "Registered", "Active", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-device-${d.id}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/app/${d.app_id}`} className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded hover:bg-primary/20">{d.app_id}</Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground text-xs">{d.device_name ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[160px]">{d.device_id}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.device_model ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.android_version ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(d.registered_at)}</td>
                      <td className="px-4 py-2.5">
                        <Switch checked={d.is_active} onCheckedChange={(v) => toggleMut.mutate({ id: d.id, is_active: v })} data-testid={`switch-active-${d.id}`} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(d.id)} data-testid={`button-delete-${d.id}`}>
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

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Device delete karna chahte ho?</AlertDialogTitle>
            <AlertDialogDescription>Yeh device permanently remove ho jayega. Undo nahi hoga.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)} data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
