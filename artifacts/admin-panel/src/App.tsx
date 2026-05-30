import { useState, useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import AppIds from "@/pages/AppIds";
import Devices from "@/pages/Devices";
import Sessions from "@/pages/Sessions";
import FormData from "@/pages/FormData";
import Messages from "@/pages/Messages";
import SettingsPage from "@/pages/SettingsPage";
import AppDetail from "@/pages/AppDetail";
import Proxy from "@/pages/Proxy";
import NotFound from "@/pages/not-found";
import { getToken, api } from "@/lib/api";

const SUPABASE_PROJECT_REF = "dvgcrxrnnezbdjpujjjt";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Runs once after login — if tables are missing and a PAT is saved on the server,
// calls Supabase Management API directly from the browser (user IP, not Replit IP).
// This is the zero-action auto-setup: user never needs to enter a token manually.
function useAutoDbSetup() {
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const boot = await api.bootstrap();
        if (boot.tables_ready || !boot.pat || !boot.setup_sql) return;

        // Tables missing but PAT is saved — auto-create from browser (bypasses Replit IP block)
        const mgmtRes = await fetch(
          `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${boot.pat}`,
            },
            body: JSON.stringify({ query: boot.setup_sql }),
          }
        );

        if (mgmtRes.ok) {
          // Tables created — refresh all data
          qc.invalidateQueries({ queryKey: ["db-status"] });
          qc.invalidateQueries({ queryKey: ["stats"] });
          qc.invalidateQueries({ queryKey: ["app-ids"] });
        }
      } catch {
        // Silent — user can still use banner as fallback
      }
    })();
  }, [qc]);
}

function Router({ onLogout }: { onLogout: () => void }) {
  useAutoDbSetup();

  return (
    <Layout onLogout={onLogout}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/apps" component={AppIds} />
        <Route path="/app-ids" component={AppIds} />
        <Route path="/devices" component={Devices} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/form-data" component={FormData} />
        <Route path="/messages" component={Messages} />
        <Route path="/settings">
          {() => <SettingsPage onLogout={onLogout} />}
        </Route>
        <Route path="/proxy" component={Proxy} />
        <Route path="/app/:appId" component={AppDetail} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getToken());

  function handleLogin() {
    setIsLoggedIn(true);
    queryClient.clear();
  }

  function handleLogout() {
    setIsLoggedIn(false);
    queryClient.clear();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          {!isLoggedIn
            ? <Login onLogin={handleLogin} />
            : <Router onLogout={handleLogout} />
          }
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
