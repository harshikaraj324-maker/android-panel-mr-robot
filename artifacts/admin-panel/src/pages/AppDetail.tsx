import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Device } from "@/lib/supabase";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, AlertCircle, Smartphone, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const addDeviceSchema = z.object({
  device_id: z.string().min(1, "Device ID is required"),
  device_name: z.string().optional(),
  device_model: z.string().optional(),
  android_version: z.string().optional(),
  admin_id: z.string().optional(),
});
type AddDeviceForm = z.infer<typeof addDeviceSchema>;

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

export default function AppDetail() {
  const { appId } = useParams<{ appId: string }>();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading, error } = useQuery<Device[]>({
    queryKey: ["devices", appId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registered_devices")
        .select("*")
        .eq("app_id", appId)
        .order("registered_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const form = useForm<AddDeviceForm>({
    resolver: zodResolver(addDeviceSchema),
    defaultValues: { device_id: "", device_name: "", device_model: "", android_version: "", admin_id: "" },
  });

  const addDevice = useMutation({
    mutationFn: async (values: AddDeviceForm) => {
      const { error } = await supabase.from("registered_devices").insert({
        app_id: appId,
        device_id: values.device_id,
        device_name: values.device_name || null,
        device_model: values.device_model || null,
        android_version: values.android_version || null,
        admin_id: values.admin_id || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", appId] });
      toast({ title: "Device added", description: "New device registered successfully." });
      setAddOpen(false);
      form.reset();
    },
    onError: (err) => {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase.from("registered_devices").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", appId] });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("registered_devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", appId] });
      toast({ title: "Device deleted" });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete device.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/devices" data-testid="link-back">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">App:</h2>
            <span className="text-xl font-bold font-mono text-primary">{appId}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{devices.length} registered devices</p>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-device">
            <Plus className="w-4 h-4 mr-2" />
            Add Device
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium text-destructive">{(error as Error).message}</p>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              Devices
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {devices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Smartphone className="w-10 h-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No devices for this App ID.</p>
                <Button size="sm" className="mt-4" onClick={() => setAddOpen(true)} data-testid="button-add-first">
                  <Plus className="w-3.5 h-3.5 mr-2" />
                  Add first device
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Device Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">Model</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Android</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Registered</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Admin</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Active</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {devices.map((device) => (
                      <tr key={device.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-device-${device.id}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{device.device_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{device.device_id}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{device.device_model ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{device.android_version ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(device.registered_at)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">{device.admin_id ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={device.is_active}
                            onCheckedChange={(checked) => toggleActive.mutate({ id: device.id, is_active: checked })}
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
      )}

      {/* Add Device Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Device to <span className="font-mono text-primary">{appId}</span></DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => addDevice.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="device_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Device ID *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. abc123xyz" {...field} data-testid="input-device-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="device_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Device Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Office Phone" {...field} data-testid="input-device-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="device_model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Redmi Note 12" {...field} data-testid="input-device-model" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="android_version"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Android Version</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 13" {...field} data-testid="input-android-version" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="admin_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin ID</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. admin1" {...field} data-testid="input-admin-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">
                  Cancel
                </Button>
                <Button type="submit" disabled={addDevice.isPending} data-testid="button-submit-add">
                  {addDevice.isPending ? "Adding..." : "Add Device"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the device. This action cannot be undone.
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
