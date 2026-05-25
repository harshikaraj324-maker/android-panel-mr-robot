import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, KeyRound, Eye, EyeOff, RefreshCw,
  ToggleLeft, ToggleRight, AlertCircle, ChevronRight,
  Wand2, Clock, RotateCcw, CalendarPlus, Copy, Check,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const changePassSchema = z.object({
  current_password: z.string().min(1, "Current password daliye"),
  new_password: z.string().min(1, "New password daliye"),
  confirm_new: z.string().min(1, "Confirm karo"),
}).refine((d) => d.new_password === d.confirm_new, {
  message: "Passwords match nahi kar rahe", path: ["confirm_new"],
});
type ChangePassForm = z.infer<typeof changePassSchema>;

function PasswordInput({ field, placeholder, testId }: {
  field: React.InputHTMLAttributes<HTMLInputElement>;
  placeholder?: string;
  testId?: string;
}) {
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

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null;
  const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expired = daysLeft <= 0;
  const warning = daysLeft <= 5;
  return (
    <span className={cn(
      "text-[10px] px-1.5 py-0.5 rounded font-medium",
      expired ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        : warning ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
          : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
    )}>
      <Clock className="w-2.5 h-2.5 inline mr-0.5" />
      {expired ? "Expired" : `${daysLeft}d left`}
    </span>
  );
}

export default function AppIds() {
  const [changePassFor, setChangePassFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [generatedId, setGeneratedId] = useState("");
  const [adminLabel, setAdminLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: appIds = [], isLoading, error, refetch } = useQuery({
    queryKey: ["app-ids"],
    queryFn: api.listAppIds,
  });

  const changePassForm = useForm<ChangePassForm>({
    resolver: zodResolver(changePassSchema),
    defaultValues: { current_password: "", new_password: "", confirm_new: "" },
  });

  // Generate App ID
  const generateMut = useMutation({
    mutationFn: api.generateAppId,
    onSuccess: (d) => setGeneratedId(d.app_id),
    onError: () => {
      // Fallback: generate client-side
      const words = ["ALPHA","BETA","DELTA","ECHO","GHOST","HAWK","IRON","KING","NOVA","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","PIXEL","SPARK","TURBO","VAULT"];
      const w1 = words[Math.floor(Math.random() * words.length)];
      const w2 = words[Math.floor(Math.random() * words.length)];
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const r1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      const r2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      setGeneratedId(`${w1}-${w2}-${r1}@${r2}`);
    },
  });

  // Create App ID
  const createMut = useMutation({
    mutationFn: () => api.createAppId({ app_id: generatedId, password: "1234", admin_label: adminLabel || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "App ID Create Ho Gaya!", description: `"${generatedId}" — Password: 1234 — 30 days valid` });
      setShowCreate(false);
      setGeneratedId("");
      setAdminLabel("");
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Change Password
  const changePassMut = useMutation({
    mutationFn: (v: ChangePassForm & { appId: string }) =>
      api.changePassword(v.appId, { current_password: v.current_password, new_password: v.new_password }),
    onSuccess: () => {
      toast({ title: "Password Change Ho Gaya!" });
      setChangePassFor(null);
      changePassForm.reset();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Reset to 1234
  const resetPassMut = useMutation({
    mutationFn: (appId: string) => api.resetPassword(appId),
    onSuccess: (_, appId) => toast({ title: "Password Reset!", description: `"${appId}" ka password wapas 1234 ho gaya.` }),
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Extend session
  const extendMut = useMutation({
    mutationFn: (appId: string) => api.extendSession(appId),
    onSuccess: (d, appId) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      toast({ title: "+30 Days Extend!", description: `"${appId}" ka session extend ho gaya.` });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Toggle
  const toggleMut = useMutation({
    mutationFn: ({ appId, is_active }: { appId: string; is_active: boolean }) => api.toggleAppId(appId, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-ids"] }),
  });

  // Delete
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

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(text);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function openCreate() {
    setShowCreate(true);
    generateMut.mutate();
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">App IDs &amp; Login</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Auto-generated IDs · Default password 1234 · 30 day session</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="button-create-appid">
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
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : appIds.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <KeyRound className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Abhi koi App ID nahi hai</p>
            <p className="text-xs text-muted-foreground mt-1">Upar "New App ID" button se auto-generate karo</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(appIds as AppIdRow[]).map((app) => {
            const expired = app.expires_at ? new Date(app.expires_at) < new Date() : false;
            return (
              <Card key={app.app_id}
                className={cn(!app.is_active && "opacity-60", expired && "border-red-200 dark:border-red-900/50")}
                data-testid={`card-app-${app.app_id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3">
                    {/* Top row: ID + badges */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${app.is_active && !expired ? "bg-green-500" : "bg-red-400"}`} />
                          <span className="font-mono font-bold text-foreground text-sm tracking-wide">{app.app_id}</span>
                          <button onClick={() => copyToClipboard(app.app_id)} title="Copy App ID"
                            className="text-muted-foreground hover:text-foreground transition-colors">
                            {copiedId === app.app_id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {app.admin_label && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{app.admin_label}</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${app.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                            {app.is_active ? "Active" : "Inactive"}
                          </span>
                          <ExpiryBadge expiresAt={app.expires_at} />
                          <span className="text-[10px] text-muted-foreground">
                            {app.device_count} devices · {app.active_count} active
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom row: Actions */}
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={`/app/${app.app_id}`} data-testid={`link-view-${app.app_id}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          <ChevronRight className="w-3 h-3 mr-1" /> Devices
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => { setChangePassFor(app.app_id); changePassForm.reset(); }}
                        data-testid={`button-change-pass-${app.app_id}`}>
                        <KeyRound className="w-3 h-3 mr-1" /> Password Change
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => resetPassMut.mutate(app.app_id)}
                        disabled={resetPassMut.isPending}
                        data-testid={`button-reset-pass-${app.app_id}`}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Reset to 1234
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => extendMut.mutate(app.app_id)}
                        disabled={extendMut.isPending}
                        data-testid={`button-extend-${app.app_id}`}>
                        <CalendarPlus className="w-3 h-3 mr-1" /> +30 Days
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        title={app.is_active ? "Deactivate" : "Activate"}
                        onClick={() => toggleMut.mutate({ appId: app.app_id, is_active: !app.is_active })}
                        data-testid={`button-toggle-${app.app_id}`}>
                        {app.is_active ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteFor(app.app_id)} data-testid={`button-delete-${app.app_id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create App ID Dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" /> New App ID Generate Karo
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Generated ID */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Auto-Generated App ID</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted rounded-md px-3 py-2 font-mono text-sm font-bold text-foreground tracking-wider min-h-[38px] flex items-center">
                  {generateMut.isPending ? (
                    <span className="text-muted-foreground text-xs">Generating...</span>
                  ) : generatedId || (
                    <span className="text-muted-foreground text-xs">Click generate...</span>
                  )}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => generateMut.mutate()}
                  disabled={generateMut.isPending} data-testid="button-regenerate">
                  <RefreshCw className={cn("w-4 h-4", generateMut.isPending && "animate-spin")} />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Format: WORD-WORD-XXXX@YYY — har baar naya unique ID milega</p>
            </div>

            {/* Default password info */}
            <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
              <KeyRound className="w-4 h-4 text-primary flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-primary">Default Password: <span className="font-mono">1234</span></p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Create hone ke baad "Password Change" ya "Reset to 1234" se manage karo</p>
              </div>
            </div>

            {/* Session info */}
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
              <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Session: 30 Days</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Expiry ke baad "+30 Days" button se extend karo</p>
              </div>
            </div>

            {/* Optional label */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label (optional)</label>
              <Input
                placeholder="e.g. Mumbai Office, Delhi RTO"
                value={adminLabel}
                onChange={(e) => setAdminLabel(e.target.value)}
                data-testid="input-admin-label"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!generatedId || createMut.isPending}
              data-testid="button-submit-create"
            >
              {createMut.isPending ? "Creating..." : "Create App ID"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Dialog ── */}
      <Dialog open={!!changePassFor} onOpenChange={(open) => !open && setChangePassFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              Password Change
            </DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-1">{changePassFor}</p>
          </DialogHeader>
          <Form {...changePassForm}>
            <form onSubmit={changePassForm.handleSubmit((v) => changePassFor && changePassMut.mutate({ ...v, appId: changePassFor }))}
              className="space-y-3">
              <FormField control={changePassForm.control} name="current_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>}
                      placeholder="Purana password (default: 1234)" testId="input-current-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={changePassForm.control} name="new_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>}
                      placeholder="Naya password" testId="input-new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={changePassForm.control} name="confirm_new" render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <PasswordInput field={field as React.InputHTMLAttributes<HTMLInputElement>}
                      placeholder="Dobara daliye" testId="input-confirm-new" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="mt-1">
                <Button type="button" variant="outline" onClick={() => setChangePassFor(null)}>Cancel</Button>
                <Button type="submit" disabled={changePassMut.isPending} data-testid="button-submit-change-pass">
                  {changePassMut.isPending ? "Updating..." : "Update Password"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
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
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFor && deleteMut.mutate(deleteFor)}
              data-testid="button-confirm-delete">
              Haan, Delete Karo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
