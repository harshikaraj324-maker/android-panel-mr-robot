import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, KeyRound, Eye, EyeOff, RefreshCw, ToggleLeft, ToggleRight, AlertCircle, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const createSchema = z.object({
  app_id: z.string().min(1, "App ID zaruri hai").regex(/^[a-zA-Z0-9_-]+$/, "Sirf letters, numbers, _ aur - allowed"),
  password: z.string().min(4, "Password kam se kam 4 characters ka ho"),
  confirm_password: z.string().min(1, "Password confirm karo"),
  admin_label: z.string().optional(),
}).refine((d) => d.password === d.confirm_password, {
  message: "Passwords match nahi kar rahe",
  path: ["confirm_password"],
});

const changePassSchema = z.object({
  current_password: z.string().min(1, "Current password daliye"),
  new_password: z.string().min(4, "New password kam se kam 4 characters"),
  confirm_new: z.string().min(1, "Confirm karo"),
}).refine((d) => d.new_password === d.confirm_new, {
  message: "Passwords match nahi kar rahe",
  path: ["confirm_new"],
});

type CreateForm = z.infer<typeof createSchema>;
type ChangePassForm = z.infer<typeof changePassSchema>;

function PasswordInput({ field, placeholder, testId }: { field: React.InputHTMLAttributes<HTMLInputElement>; placeholder?: string; testId?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} placeholder={placeholder} {...field} data-testid={testId} className="pr-10" />
      <button type="button" tabIndex={-1} onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function AppIds() {
  const [changePassFor, setChangePassFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: appIds = [], isLoading, error, refetch } = useQuery({
    queryKey: ["app-ids"],
    queryFn: api.listAppIds,
  });

  const createForm = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { app_id: "", password: "", confirm_password: "", admin_label: "" } });
  const changePassForm = useForm<ChangePassForm>({ resolver: zodResolver(changePassSchema), defaultValues: { current_password: "", new_password: "", confirm_new: "" } });

  const createMut = useMutation({
    mutationFn: (v: CreateForm) => api.createAppId({ app_id: v.app_id, password: v.password, admin_label: v.admin_label }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "App ID Created!", description: `"${v.app_id}" successfully create ho gaya.` });
      setShowCreate(false);
      createForm.reset();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const changePassMut = useMutation({
    mutationFn: (v: ChangePassForm & { appId: string }) =>
      api.changePassword(v.appId, { current_password: v.current_password, new_password: v.new_password }),
    onSuccess: () => {
      toast({ title: "Password Changed!", description: "Password successfully update ho gaya." });
      setChangePassFor(null);
      changePassForm.reset();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ appId, is_active }: { appId: string; is_active: boolean }) => api.toggleAppId(appId, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-ids"] }),
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (appId: string) => api.deleteAppId(appId),
    onSuccess: (_, appId) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "Deleted", description: `"${appId}" aur uske saare devices delete ho gaye.` });
      setDeleteFor(null);
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">App IDs &amp; Login</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Create karo, password set karo, manage karo</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh"><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-appid">
            <Plus className="w-4 h-4 mr-1.5" /> New App ID
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-destructive">{(error as Error).message}</p>
          <Link href="/setup" className="text-xs text-primary hover:underline">DB Setup karo pehle</Link>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : appIds.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <KeyRound className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Abhi koi App ID nahi hai</p>
            <p className="text-xs text-muted-foreground mt-1">Upar "New App ID" button se banao</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(appIds as AppIdRow[]).map((app) => (
            <Card key={app.app_id} className={cn(!app.is_active && "opacity-60")} data-testid={`card-app-${app.app_id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${app.is_active ? "bg-green-500" : "bg-yellow-400"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-foreground text-base">{app.app_id}</span>
                        {app.admin_label && <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{app.admin_label}</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${app.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}>
                          {app.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {app.device_count} devices &nbsp;·&nbsp; {app.active_count} active
                        {app.expires_at && <span className="ml-2 text-orange-500">Expires: {new Date(app.expires_at).toLocaleDateString("en-IN")}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Link href={`/app/${app.app_id}`} data-testid={`link-view-${app.app_id}`}>
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        <ChevronRight className="w-3.5 h-3.5 mr-1" /> Devices
                      </Button>
                    </Link>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setChangePassFor(app.app_id); changePassForm.reset(); }} data-testid={`button-change-pass-${app.app_id}`}>
                      <KeyRound className="w-3 h-3 mr-1" /> Password
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={app.is_active ? "Deactivate" : "Activate"}
                      onClick={() => toggleMut.mutate({ appId: app.app_id, is_active: !app.is_active })}
                      data-testid={`button-toggle-${app.app_id}`}>
                      {app.is_active ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteFor(app.app_id)} data-testid={`button-delete-${app.app_id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create App ID Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> New App ID Create Karo</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((v) => createMut.mutate(v))} className="space-y-4">
              <FormField control={createForm.control} name="app_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>App ID *</FormLabel>
                  <FormControl><Input placeholder="e.g. rto20, office_fleet" {...field} className="font-mono" data-testid="input-app-id" /></FormControl>
                  <FormDescription className="text-[11px]">Letters, numbers, _ aur - allowed. Android app mein yahi ID use hogi.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={createForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password *</FormLabel>
                  <FormControl><PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>} placeholder="App ka login password" testId="input-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={createForm.control} name="confirm_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password *</FormLabel>
                  <FormControl><PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>} placeholder="Password dobara daliye" testId="input-confirm-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={createForm.control} name="admin_label" render={({ field }) => (
                <FormItem>
                  <FormLabel>Label (optional)</FormLabel>
                  <FormControl><Input placeholder="e.g. Mumbai RTO, Delhi Office" {...field} data-testid="input-admin-label" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending} data-testid="button-submit-create">
                  {createMut.isPending ? "Creating..." : "Create App ID"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={!!changePassFor} onOpenChange={(open) => !open && setChangePassFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              Password Change — <span className="font-mono text-primary">{changePassFor}</span>
            </DialogTitle>
          </DialogHeader>
          <Form {...changePassForm}>
            <form onSubmit={changePassForm.handleSubmit((v) => changePassFor && changePassMut.mutate({ ...v, appId: changePassFor }))} className="space-y-4">
              <FormField control={changePassForm.control} name="current_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl><PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>} placeholder="Purana password" testId="input-current-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={changePassForm.control} name="new_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl><PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>} placeholder="Naya password" testId="input-new-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={changePassForm.control} name="confirm_new" render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl><PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>} placeholder="Naya password confirm karo" testId="input-confirm-new-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setChangePassFor(null)}>Cancel</Button>
                <Button type="submit" disabled={changePassMut.isPending} data-testid="button-submit-change-pass">
                  {changePassMut.isPending ? "Updating..." : "Update Password"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>"{deleteFor}" delete karna chahte ho?</AlertDialogTitle>
            <AlertDialogDescription>
              Is App ID ke <strong>saare devices bhi delete</strong> ho jayenge. Yeh action undo nahi ho sakta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFor && deleteMut.mutate(deleteFor)} data-testid="button-confirm-delete">
              Haan, Delete Karo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
