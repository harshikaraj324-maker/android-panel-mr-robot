import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Smartphone, KeyRound, Menu, X, Shield,
  MonitorSmartphone, FileText, MessageSquare, Settings, Clock, LogOut, ShieldCheck,
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
        "fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200 lg:static lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary">
            <Shield className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-sidebar-foreground leading-none">Device Admin</p>
            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">Control Panel</p>
          </div>
          <button className="lg:hidden text-sidebar-foreground/60" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-white"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                onClick={() => setMobileOpen(false)}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-2 py-2 border-t border-sidebar-border">
          <button
            onClick={() => logoutMut.mutate()}
            disabled={logoutMut.isPending}
            className="flex items-center gap-2.5 px-3 py-2 w-full rounded-md text-sm font-medium text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Logout
          </button>
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <MonitorSmartphone className="w-3 h-3 text-sidebar-foreground/20" />
            <p className="text-[9px] text-sidebar-foreground/25 font-mono truncate">dvgcrxrnnezbdjpujjjt</p>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-3 bg-card border-b border-border h-12">
          <button className="lg:hidden text-foreground/60" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground/70">
            {activeNav?.label ?? "Admin"}
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
