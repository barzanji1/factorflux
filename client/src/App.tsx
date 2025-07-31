import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Invoices from "@/pages/invoices";
import Clients from "@/pages/clients";
import Documents from "@/pages/documents";
import CreditChecks from "@/pages/credit-checks";
import Admin from "@/pages/admin";
import Activities from "@/pages/activities";
import Reports from "@/pages/reports";
import FuelCards from "@/pages/fuel-cards";
import FuelCardAdmin from "@/pages/fuel-card-admin";
import Profile from "@/pages/profile";
import Settings from "@/pages/settings";
import DownloadPage from "@/pages/download";
import Jose from "@/pages/jose";


function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  useTheme(); // Initialize theme

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <>
          <Route path="/" component={Landing} />
          <Route path="/download" component={DownloadPage} />
        </>
      ) : (
        <>
          <Route path="/" component={Dashboard} />
          <Route path="/clients" component={Clients} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/documents" component={Documents} />
          <Route path="/credit-checks" component={CreditChecks} />
          <Route path="/admin" component={Admin} />
          <Route path="/activities" component={Activities} />
          <Route path="/reports" component={Reports} />
          <Route path="/fuel-cards" component={FuelCards} />
          <Route path="/fuel-card-admin" component={FuelCardAdmin} />
          <Route path="/profile" component={Profile} />
          <Route path="/settings" component={Settings} />
          <Route path="/jose" component={Jose} />
          <Route path="/download" component={DownloadPage} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
