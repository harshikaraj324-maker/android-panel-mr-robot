import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { getToken } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Router({ onLogout }: { onLogout: () => void }) {
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
