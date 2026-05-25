import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DeviceRow } from "@/lib/api";
import { useState } from "react";
import { AlertCircle, Smartphone, ArrowLeft, Trash2, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AppDetail() {
  const { appId } = useParams<{ appId: string }>();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading, error, refetch } = useQuery({
    queryKey: ["devices", appId],
    queryFn: () => api.listDevices(appId),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => api.toggleDevice(id, is_active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices", appId] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices", appId] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "Device deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Error", description: "Delete nahi hua.", variant: "destructive" }),
  });

  const activeCount = (devices as DeviceRow[]).filter((d) => d.is_active).length;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Link href="/app-ids" data-testid="link-back">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-bold text-foreground">App:</h2>
            <span className="text-lg font-bold font-mono text-primary">{appId}</span>
          </div>
          <p className="text-xs text-muted-foreground">{(devices as DeviceRow[]).length} devices &nbsp;·&nbsp; {activeCount} active</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Devices for <span className="font-mono text-primary">{appId}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(devices as DeviceRow[]).length === 0 ? (
              <div className="flex flex-col items-center py-14">
                <Smartphone className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Is App ID ke liye abhi koi device register nahi hai.</p>
                <p className="text-xs text-muted-foreground mt-1">Android app se register hone par devices yahan dikhenge.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {["Device Name / ID", "Model", "Android", "Admin", "Registered", "Last Seen", "Active", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(devices as DeviceRow[]).map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-device-${d.id}`}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground text-xs">{d.device_name ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[180px]">{d.device_id}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.device_model ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.android_version ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.admin_id ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(d.registered_at)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(d.last_seen)}</td>
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
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Device delete karna chahte ho?</AlertDialogTitle>
            <AlertDialogDescription>Yeh device permanently remove ho jayega. Undo nahi hoga.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
