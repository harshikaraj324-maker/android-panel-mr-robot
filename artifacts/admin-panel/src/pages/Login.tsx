import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, setToken } from "@/lib/api";
import { Shield, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const { toast } = useToast();

  const loginMut = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: ({ token }) => {
      setToken(token);
      onLogin();
    },
    onError: (e) => {
      toast({ title: "Login Failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password) loginMut.mutate();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Device Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Control Panel</p>
        </div>

        {/* Login form */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-1">Sign In</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Enter your admin password to access the control panel
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Password
              </label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  placeholder="Admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Default password: <span className="font-mono">admin1234</span>
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={!password || loginMut.isPending}>
              {loginMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Signing in...</>
                : "Sign In"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[10px] text-muted-foreground mt-4 font-mono">
          dvgcrxrnnezbdjpujjjt
        </p>
      </div>
    </div>
  );
}
