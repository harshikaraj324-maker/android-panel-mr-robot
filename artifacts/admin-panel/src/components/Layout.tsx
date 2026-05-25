import { Link, useLocation } from "wouter";
import { LayoutDashboard, Smartphone, KeyRound, Settings2, Menu, X, Shield, Database } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app-ids", label: "App IDs & Login", icon: KeyRound },
  { href: "/devices", label: "All Devices", icon: Smartphone },
  { href: "/setup", label: "DB Setup", icon: Database },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200 lg:static lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary">
            <Shield className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground leading-none">Device Admin</p>
            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5 truncate">RTO Control Panel</p>
          </div>
          <button className="ml-auto lg:hidden text-sidebar-foreground/60" onClick={() => setMobileOpen(false)} data-testid="button-close-menu">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active ? "bg-primary text-white" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                onClick={() => setMobileOpen(false)}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-sidebar-foreground/30 font-mono">dvgcrxrnnezbdjpujjjt</p>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-3 bg-card border-b border-border h-14">
          <button className="lg:hidden text-foreground/60" onClick={() => setMobileOpen(true)} data-testid="button-open-menu">
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground/70">
            {navItems.find((n) => (n.href === "/" ? location === "/" : location.startsWith(n.href)))?.label ?? "Admin"}
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
