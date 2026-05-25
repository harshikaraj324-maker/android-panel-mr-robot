import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import AppIds from "@/pages/AppIds";
import Devices from "@/pages/Devices";
import Sessions from "@/pages/Sessions";
import FormData from "@/pages/FormData";
import Messages from "@/pages/Messages";
import SettingsPage from "@/pages/SettingsPage";
import AppDetail from "@/pages/AppDetail";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/apps" component={AppIds} />
        <Route path="/app-ids" component={AppIds} />
        <Route path="/devices" component={Devices} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/form-data" component={FormData} />
        <Route path="/messages" component={Messages} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/app/:appId" component={AppDetail} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
