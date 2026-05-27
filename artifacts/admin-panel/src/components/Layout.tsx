import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Smartphone, KeyRound, Menu, X, Shield,
  MonitorSmartphone, FileText, MessageSquare, Settings, Clock, LogOut, ShieldCheck, Terminal,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { api, clearToken } from "@/lib/api";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apps", label: "Apps", icon: KeyRound },
  { href: "/devices", label: "Devices", icon: Smartphone },
  { href: "/sessions", label: "Sessions", icon: Clock },
  { href: "/form-data", label: "Form Data", icon: FileText },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/proxy", label: "Proxy", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const logoutMut = useMutation({
    mutationFn: async () => { try { await api.logout(); } catch {} clearToken(); },
    onSuccess: () => onLogout(),
  });

  const activeNav = navItems.find((n) =>
    n.href === "/" ? location === "/" : location.startsWith(n.href)
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-56 flex flex-col border-r transition-transform duration-200 lg:static lg:translate-x-0",
        "bg-sidebar border-sidebar-border",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/30">
            <Shield className="w-4 h-4 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-sidebar-foreground leading-none tracking-tight">MR ROBOT</p>
            <p className="text-[9px] text-primary/60 mt-0.5 font-mono tracking-widest uppercase">Control Panel</p>
          </div>
          <button className="lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* System status strip */}
        <div className="mx-3 mt-2 mb-1 px-2.5 py-1.5 rounded-md bg-primary/5 border border-primary/10 flex items-center gap-2">
          <Terminal className="w-3 h-3 text-primary/50 flex-shrink-0" />
          <p className="text-[9px] font-mono text-primary/50 truncate">SYS_ONLINE // SECURE</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-primary/15 text-primary border border-primary/20 shadow-[0_0_12px_rgba(0,212,255,0.08)]"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground border border-transparent"
                )}
                onClick={() => setMobileOpen(false)}>
                <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", active ? "text-primary" : "")} />
                <span className={cn("text-xs", active ? "font-semibold" : "")}>{label}</span>
                {active && <span className="ml-auto w-1 h-1 rounded-full bg-primary animate-pulse" />}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-2 py-2 border-t border-sidebar-border">
          <button
            onClick={() => logoutMut.mutate()}
            disabled={logoutMut.isPending}
            className="flex items-center gap-2.5 px-3 py-2 w-full rounded-md text-xs font-medium text-sidebar-foreground/40 hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/20 transition-all"
          >
            <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
            Logout
          </button>
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <MonitorSmartphone className="w-3 h-3 text-sidebar-foreground/15" />
            <p className="text-[8px] text-sidebar-foreground/20 font-mono truncate">ENCRYPTED_SESSION</p>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-0 bg-card border-b border-border h-11"
          style={{ boxShadow: "0 1px 0 rgba(0,212,255,0.06)" }}>
          <button className="lg:hidden text-foreground/60 hover:text-primary transition-colors" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-semibold text-foreground/80 tracking-wide uppercase font-mono">
              {activeNav?.label ?? "Admin"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[9px] font-mono text-muted-foreground/40 hidden sm:block">
              {new Date().toLocaleTimeString("en-US", { hour12: false })}
            </span>
            <span className="text-[9px] font-mono text-primary/40 hidden sm:block">// SECURE</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
