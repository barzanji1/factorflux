import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
// Authentication system removed - direct access to all pages
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
import FuelCardsInternal from "@/pages/fuel-cards-internal";
import Profile from "@/pages/profile";
import Settings from "@/pages/settings";
import DownloadPage from "@/pages/download";
import FollowUp from "@/pages/follow-up";
import FormDemo from "@/pages/form-demo";

function Router() {
  useTheme(); // Initialize theme

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/clients" component={Clients} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/documents" component={Documents} />
      <Route path="/follow-up" component={FollowUp} />
      <Route path="/credit-checks" component={CreditChecks} />
      <Route path="/admin" component={Admin} />
      <Route path="/activities" component={Activities} />
      <Route path="/reports" component={Reports} />
      <Route path="/fuel-cards-internal" component={FuelCardsInternal} />
      <Route path="/profile" component={Profile} />
      <Route path="/settings" component={Settings} />
      <Route path="/download" component={DownloadPage} />
      <Route path="/form-demo" component={FormDemo} />
      <Route path="/landing" component={Landing} />
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
