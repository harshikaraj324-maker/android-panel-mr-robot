import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Device } from "@/lib/supabase";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, AlertCircle, Layers, ChevronRight, Info } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const setupSchema = z.object({
  app_id: z.string().min(1, "App ID is required").regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - allowed"),
  admin_id: z.string().optional(),
});
type SetupForm = z.infer<typeof setupSchema>;

interface AppSummary {
  app_id: string;
  device_count: number;
  active_count: number;
}

export default function Setup() {
  const [deleteAppId, setDeleteAppId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading, error } = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("registered_devices").select("*").order("registered_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const appMap = new Map<string, Device[]>();
  for (const d of devices) {
    if (!appMap.has(d.app_id)) appMap.set(d.app_id, []);
    appMap.get(d.app_id)!.push(d);
  }
  const appSummaries: AppSummary[] = Array.from(appMap.entries()).map(([app_id, devs]) => ({
    app_id,
    device_count: devs.length,
    active_count: devs.filter((d) => d.is_active).length,
  }));

  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: { app_id: "", admin_id: "" },
  });

  const createAppId = useMutation({
    mutationFn: async (values: SetupForm) => {
      // Check if already exists
      const existing = appSummaries.find((a) => a.app_id === values.app_id);
      if (existing) throw new Error(`App ID "${values.app_id}" already exists.`);

      // Insert a placeholder device to register the App ID
      const { error } = await supabase.from("registered_devices").insert({
        app_id: values.app_id,
        device_id: `__placeholder_${Date.now()}`,
        device_name: "Placeholder (delete when real device registers)",
        is_active: false,
        admin_id: values.admin_id || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "App ID created", description: `App ID "${variables.app_id}" registered successfully.` });
      form.reset();
    },
    onError: (err) => {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    },
  });

  const deleteAppIdMutation = useMutation({
    mutationFn: async (app_id: string) => {
      const { error } = await supabase.from("registered_devices").delete().eq("app_id", app_id);
      if (error) throw error;
    },
    onSuccess: (_data, app_id) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "App ID deleted", description: `All devices for "${app_id}" removed.` });
      setDeleteAppId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete App ID.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-foreground">App ID Setup</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Create and manage App IDs without using the SQL editor</p>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            Create New App ID
          </CardTitle>
          <CardDescription>
            Each App ID groups devices from one Android app instance. Your Android app uses this ID to register devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 rounded-md bg-primary/5 border border-primary/20 mb-5">
            <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-primary/80">
              A placeholder device entry is created to register the App ID. You can delete it once your Android app registers a real device.
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createAppId.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="app_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>App ID *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. rto20, rto21, office_fleet"
                        {...field}
                        className="font-mono"
                        data-testid="input-app-id"
                      />
                    </FormControl>
                    <FormDescription>Letters, numbers, underscores, and hyphens only</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="admin_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin ID (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. admin1" {...field} data-testid="input-admin-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={createAppId.isPending}
                className="w-full"
                data-testid="button-create-app-id"
              >
                <Plus className="w-4 h-4 mr-2" />
                {createAppId.isPending ? "Creating..." : "Create App ID"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Existing App IDs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Existing App IDs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-10">
              <AlertCircle className="w-8 h-8 text-destructive mb-2" />
              <p className="text-sm text-destructive">{(error as Error).message}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Make sure the <code className="bg-muted px-1 rounded">registered_devices</code> table exists in your Supabase project.
              </p>
            </div>
          ) : appSummaries.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <Layers className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No App IDs yet. Create one above.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {appSummaries.map((app) => (
                <li
                  key={app.app_id}
                  className="flex items-center justify-between px-6 py-4"
                  data-testid={`row-app-${app.app_id}`}
                >
                  <Link href={`/app/${app.app_id}`} data-testid={`link-app-detail-${app.app_id}`} className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity">
                    <span className="font-mono font-semibold text-foreground">{app.app_id}</span>
                    <span className="text-xs text-muted-foreground">
                      {app.active_count} active / {app.device_count} total
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive ml-4"
                    onClick={() => setDeleteAppId(app.app_id)}
                    data-testid={`button-delete-app-${app.app_id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* SQL Setup Instructions */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground">One-time Supabase Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Run this SQL once in your Supabase SQL Editor to create the required table:
          </p>
          <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto font-mono text-foreground">
{`CREATE TABLE IF NOT EXISTS registered_devices (
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

-- Enable Row Level Security (allow all for anon key)
ALTER TABLE registered_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON registered_devices FOR ALL USING (true) WITH CHECK (true);

-- Index for fast app_id lookups
CREATE INDEX IF NOT EXISTS idx_registered_devices_app_id ON registered_devices(app_id);`}
          </pre>
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <AlertDialog open={deleteAppId !== null} onOpenChange={(open) => !open && setDeleteAppId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete App ID "{deleteAppId}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete ALL devices registered under this App ID. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-app">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAppId && deleteAppIdMutation.mutate(deleteAppId)}
              data-testid="button-confirm-delete-app"
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
