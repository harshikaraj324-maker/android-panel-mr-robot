import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, clearToken } from "@/lib/api";
import { Settings, Lock, Eye, EyeOff, Loader2, LogOut, Shield, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changed, setChanged] = useState(false);
  const { toast } = useToast();

  const changeMut = useMutation({
    mutationFn: () => {
      if (newPw !== confirmPw) throw new Error("New passwords do not match");
      if (newPw.length < 4) throw new Error("Password must be at least 4 characters");
      return api.changePassword(oldPw, newPw);
    },
    onSuccess: () => {
      setChanged(true);
      setOldPw(""); setNewPw(""); setConfirmPw("");
      toast({ title: "Password changed!", description: "Please log in again with your new password." });
      setTimeout(() => {
        clearToken();
        onLogout();
      }, 1500);
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  async function handleLogout() {
    try { await api.logout(); } catch {}
    clearToken();
    onLogout();
  }

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" /> Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Admin control panel settings</p>
      </div>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" /> Change Admin Password
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            This is the control panel password — separate from the Android app PIN
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {changed ? (
            <div className="flex flex-col items-center py-6 gap-2">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <p className="text-sm font-medium text-green-600">Password changed successfully!</p>
              <p className="text-xs text-muted-foreground">Redirecting to login page...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Current Password</label>
                <div className="relative">
                  <Input
                    type={showOld ? "text" : "password"}
                    placeholder="Current password"
                    value={oldPw}
                    onChange={(e) => setOldPw(e.target.value)}
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowOld(!showOld)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">New Password</label>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    placeholder="New password (min 4 chars)"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Confirm New Password</label>
                <Input
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && oldPw && newPw && confirmPw && changeMut.mutate()}
                  className={confirmPw && confirmPw !== newPw ? "border-red-400" : ""}
                />
                {confirmPw && confirmPw !== newPw && (
                  <p className="text-[11px] text-red-500">Passwords do not match</p>
                )}
              </div>

              <Button
                className="w-full mt-1"
                onClick={() => changeMut.mutate()}
                disabled={!oldPw || !newPw || !confirmPw || newPw !== confirmPw || changeMut.isPending}
              >
                {changeMut.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Changing...</>
                  : <><Lock className="w-4 h-4 mr-2" /> Change Password</>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel Info */}
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" /> Panel Info
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Supabase Project</span>
            <span className="font-mono">dvgcrxrnnezbdjpujjjt</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Default Admin Password</span>
            <span className="font-mono">admin1234</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Default App PIN</span>
            <span className="font-mono">1234</span>
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30"
        onClick={handleLogout}>
        <LogOut className="w-4 h-4 mr-2" /> Sign Out
      </Button>
    </div>
  );
}
