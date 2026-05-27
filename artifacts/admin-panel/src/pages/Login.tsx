import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, setToken } from "@/lib/api";
import { Shield, Eye, EyeOff, Loader2, Lock, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [tick, setTick] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const loginMut = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: ({ token }) => { setToken(token); onLogin(); },
    onError: (e) => {
      toast({ title: "ACCESS DENIED", description: (e as Error).message, variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password) loginMut.mutate();
  }

  const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px"
        }} />
      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-[120px] pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)" }} />

      <div className="w-full max-w-sm px-4 relative z-10">
        {/* Terminal top bar */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-t-xl px-4 py-2.5 border-b-0">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          <p className="flex-1 text-center text-[10px] font-mono text-muted-foreground/50">
            secure_shell — admin@mrrobot
          </p>
          <Terminal className="w-3 h-3 text-muted-foreground/30" />
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-b-xl px-6 py-6"
          style={{ boxShadow: "0 0 40px rgba(0,212,255,0.06), 0 20px 40px rgba(0,0,0,0.5)" }}>

          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div className="relative w-14 h-14 rounded-xl flex items-center justify-center mb-4"
              style={{
                background: "linear-gradient(135deg, rgba(0,212,255,0.15), rgba(0,212,255,0.05))",
                border: "1px solid rgba(0,212,255,0.3)",
                boxShadow: "0 0 20px rgba(0,212,255,0.1), inset 0 0 20px rgba(0,212,255,0.05)"
              }}>
              <Shield className="w-7 h-7 text-primary" />
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-background"
                style={{ background: "linear-gradient(135deg, #00ff88, #00d4ff)", boxShadow: "0 0 8px rgba(0,255,136,0.6)" }} />
            </div>
            <h1 className="text-base font-bold text-foreground tracking-widest uppercase font-mono">MR ROBOT</h1>
            <p className="text-[10px] text-primary/50 mt-0.5 font-mono tracking-widest">DEVICE CONTROL PANEL</p>
          </div>

          {/* Terminal prompt line */}
          <div className="mb-5 px-3 py-2 rounded-md bg-muted/50 border border-border font-mono">
            <p className="text-[10px] text-muted-foreground/60">
              <span className="text-primary/70">root@fsociety</span>
              <span className="text-muted-foreground/40">:</span>
              <span className="text-accent/70">~</span>
              <span className="text-muted-foreground/40">$ </span>
              <span className="text-foreground/60">authenticate --level=admin</span>
            </p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">[{timeStr}] Awaiting credentials...</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                <Lock className="w-3 h-3 text-primary/50" /> Access Key
              </label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10 font-mono text-sm bg-muted/50 border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/30"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary/70 transition-colors"
                >
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full font-mono text-xs tracking-widest uppercase"
              style={{
                background: password && !loginMut.isPending
                  ? "linear-gradient(135deg, rgba(0,212,255,0.9), rgba(0,180,215,0.9))"
                  : undefined,
                boxShadow: password && !loginMut.isPending
                  ? "0 0 20px rgba(0,212,255,0.25)"
                  : undefined,
                color: "#05080e"
              }}
              disabled={!password || loginMut.isPending}
            >
              {loginMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Authenticating...</>
                : "Grant Access"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[9px] text-muted-foreground/25 mt-4 font-mono tracking-widest">
          fsociety // all.systems.go
        </p>
      </div>
    </div>
  );
}
