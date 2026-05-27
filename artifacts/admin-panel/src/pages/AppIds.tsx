import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppIdRow } from "@/lib/api";
import {
  Plus, Trash2, KeyRound, RefreshCw, ToggleLeft, ToggleRight,
  ChevronRight, Wand2, Clock, RotateCcw, CalendarPlus, Copy,
  Check, ExternalLink, ArrowRight, Loader2,
  Eye, EyeOff,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── One-time setup modal ───────────────────────────────────────────────────────
function SetupModal({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const setupMut = useMutation({
    mutationFn: () => api.setup(pat),
    onSuccess: () => {
      toast({ title: "Database Ready!", description: "Tables created. Creating App ID now..." });
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      onDone();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" /> One-Time Setup Required
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="font-medium text-amber-800 dark:text-amber-400 text-xs">
              Supabase tables don't exist yet. Provide a Supabase Access Token once and tables will be created automatically along with your App ID.
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold">Step 1 — Generate a token:</p>
            <a
              href="https://supabase.com/dashboard/account/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline bg-primary/5 px-3 py-2 rounded-md border border-primary/20 w-full"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              supabase.com/dashboard/account/tokens → "Generate new token"
            </a>
            <p className="text-[11px] text-muted-foreground">
              (This is Account Settings, not the SQL editor. Copy the token.)
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold">Step 2 — Paste token here:</p>
            <div className="relative">
              <Input
                type={showPat ? "text" : "password"}
                placeholder="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                className="pr-14 font-mono text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPat(!showPat)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Token will be stored — you won't be asked again ✓
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => setupMut.mutate()}
            disabled={!pat.trim() || setupMut.isPending}
          >
            {setupMut.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Creating...</>
            ) : (
              <><ArrowRight className="w-4 h-4 mr-1.5" /> Create Tables + App ID</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Expiry badge ───────────────────────────────────────────────────────────────
function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null;
  const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expired = daysLeft <= 0;
  const warn = daysLeft > 0 && daysLeft <= 5;
  return (
    <span className={cn(
      "text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5",
      expired ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        : warn ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
          : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
    )}>
      <Clock className="w-2.5 h-2.5" />
      {expired ? "Expired" : `${daysLeft}d left`}
    </span>
  );
}

// ── Change PIN dialog ──────────────────────────────────────────────────────────
function ChangePinDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const [newPin, setNewPin] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => api.changePin(appId, newPin),
    onSuccess: () => {
      toast({ title: "PIN updated successfully!" });
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      onClose();
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Change PIN
          </DialogTitle>
          <p className="text-xs font-mono text-muted-foreground">{appId}</p>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="New PIN (e.g. 5678)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newPin && mut.mutate()}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={!newPin || mut.isPending}>
            {mut.isPending ? "Updating..." : "Update PIN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AppIds() {
  const [showCreate, setShowCreate] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [generatedId, setGeneratedId] = useState("");
  const [appName, setAppName] = useState("");
  const [changePinFor, setChangePinFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["app-ids"],
    queryFn: api.listAppIds,
    refetchInterval: 10000,
  });

  const appIds: AppIdRow[] = data?.rows ?? [];
  const needsSetup = data?.needs_setup === true;

  // Generate App ID
  const generateMut = useMutation({
    mutationFn: api.generateAppId,
    onSuccess: (d) => setGeneratedId(d.app_id),
    onError: () => {
      const W = ["ALPHA","BETA","DELTA","ECHO","GHOST","HAWK","IRON","KING","NOVA","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","EAGLE","FLASH","NINJA","SPARK"];
      const r = (n: number) => Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      setGeneratedId(`${W[Math.floor(Math.random()*W.length)]}-${W[Math.floor(Math.random()*W.length)]}-${r(4)}@${r(3)}`);
    },
  });

  // Create App ID
  const createMut = useMutation({
    mutationFn: () => api.createAppId({ app_id: generatedId, pin: "1234", name: appName || undefined }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "App ID Created!", description: `${row.app_id} · PIN: 1234 · 30 days valid` });
      setShowCreate(false);
      setGeneratedId("");
      setAppName("");
    },
    onError: (e) => {
      const msg = (e as Error).message;
      if (msg === "needs_setup") {
        setShowCreate(false);
        setPendingCreate(true);
        setShowSetup(true);
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  // Reset PIN
  const resetMut = useMutation({
    mutationFn: (appId: string) => api.resetPin(appId),
    onSuccess: (_, appId) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      toast({ title: "PIN Reset!", description: `"${appId}" PIN has been reset to 1234.` });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Extend session
  const extendMut = useMutation({
    mutationFn: (appId: string) => api.extendSession(appId),
    onSuccess: (_, appId) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      toast({ title: "+30 Days Added!", description: `"${appId}" session has been extended.` });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  // Toggle status
  const toggleMut = useMutation({
    mutationFn: ({ appId, status }: { appId: string; status: string }) => api.setStatus(appId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-ids"] }),
  });

  // Delete
  const deleteMut = useMutation({
    mutationFn: (appId: string) => api.deleteAppId(appId),
    onSuccess: (_, appId) => {
      qc.invalidateQueries({ queryKey: ["app-ids"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast({ title: "Deleted", description: `"${appId}" and all its devices have been removed.` });
      setDeleteFor(null);
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  function copyId(id: string) {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function openCreate() {
    if (needsSetup) {
      setPendingCreate(true);
      setShowSetup(true);
    } else {
      setShowCreate(true);
      generateMut.mutate();
    }
  }

  function onSetupDone() {
    setShowSetup(false);
    if (pendingCreate) {
      setPendingCreate(false);
      setShowCreate(true);
      generateMut.mutate();
    }
    refetch();
  }

  const statusColor = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    inactive: "bg-muted text-muted-foreground",
    disabled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">App IDs &amp; Login</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-generated IDs · Default PIN 1234 · 30 day session
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1.5" /> New App ID
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : appIds.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <KeyRound className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No App IDs yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "New App ID" above — it will be auto-generated</p>
            <Button size="sm" className="mt-4" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1.5" /> Create First App ID
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {appIds.map((app) => {
            const expired = app.expires_at ? new Date(app.expires_at) < new Date() : false;
            const isActive = app.status === "active";
            return (
              <Card
                key={app.app_id}
                className={cn(
                  "transition-opacity",
                  !isActive && "opacity-60",
                  expired && "border-red-200 dark:border-red-900/50"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3">
                    {/* App ID + status badges */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive && !expired ? "bg-green-500" : "bg-red-400"}`} />
                          <span className="font-mono font-bold text-sm tracking-wide">{app.app_id}</span>
                          <button onClick={() => copyId(app.app_id)} className="text-muted-foreground hover:text-foreground">
                            {copiedId === app.app_id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {app.name && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{app.name}</span>
                          )}
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium capitalize", statusColor[app.status] ?? statusColor.inactive)}>
                            {app.status}
                          </span>
                          <ExpiryBadge expiresAt={app.expires_at} />
                          <span className="text-[10px] text-muted-foreground">
                            PIN: <span className="font-mono">{app.pin}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            · {app.device_count} devices
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={`/app/${app.app_id}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          <ChevronRight className="w-3 h-3 mr-1" /> Devices
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setChangePinFor(app.app_id)}>
                        <KeyRound className="w-3 h-3 mr-1" /> Change PIN
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => resetMut.mutate(app.app_id)}
                        disabled={resetMut.isPending}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Reset 1234
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => extendMut.mutate(app.app_id)}
                        disabled={extendMut.isPending}>
                        <CalendarPlus className="w-3 h-3 mr-1" /> +30 Days
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        title={isActive ? "Deactivate" : "Activate"}
                        onClick={() => toggleMut.mutate({ appId: app.app_id, status: isActive ? "inactive" : "active" })}>
                        {isActive
                          ? <ToggleRight className="w-4 h-4 text-green-500" />
                          : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteFor(app.app_id)}>
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

      {/* ── Create App ID Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) { setShowCreate(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" /> Generate New App ID
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Generated ID */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Auto-Generated App ID</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted rounded-md px-3 py-2.5 font-mono text-sm font-bold tracking-wider min-h-[38px] flex items-center">
                  {generateMut.isPending
                    ? <span className="text-muted-foreground text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Generating...</span>
                    : generatedId || <span className="text-muted-foreground text-xs">Click refresh...</span>}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
                  <RefreshCw className={cn("w-4 h-4", generateMut.isPending && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* Info boxes */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-md bg-primary/5 border border-primary/20">
                <p className="text-xs font-semibold text-primary flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> Default PIN: <span className="font-mono">1234</span>
                </p>
              </div>
              <div className="p-3 rounded-md bg-muted">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Session: <span>30 Days</span>
                </p>
              </div>
            </div>

            {/* Optional name/label */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">App Name <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                placeholder="e.g. Mumbai RTO, Delhi Branch"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!generatedId || createMut.isPending}
            >
              {createMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Creating...</> : "Create App ID"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One-time setup modal ───────────────────────────────────────────── */}
      <SetupModal open={showSetup} onClose={() => { setShowSetup(false); setPendingCreate(false); }} onDone={onSetupDone} />

      {/* ── Change PIN dialog ──────────────────────────────────────────────── */}
      {changePinFor && <ChangePinDialog appId={changePinFor} onClose={() => setChangePinFor(null)} />}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteFor}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this App ID and <strong>all associated devices</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFor && deleteMut.mutate(deleteFor)}>
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
