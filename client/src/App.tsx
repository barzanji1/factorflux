import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import Collections from "@/pages/collections";
import Vault from "@/pages/vault";
import Factoring from "@/pages/factoring";
import Tasks from "@/pages/tasks";
import FormDemo from "@/pages/form-demo";
import LoginPage from "@/pages/login";

function Router() {
  useTheme(); // Initialize theme

  return (
    <Switch>
      {/* Public route */}
      <Route path="/login">
        <LoginPage />
      </Route>
      
      {/* Protected routes */}
      <Route path="/">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/clients">
        <ProtectedRoute>
          <Clients />
        </ProtectedRoute>
      </Route>
      <Route path="/invoices">
        <ProtectedRoute>
          <Invoices />
        </ProtectedRoute>
      </Route>
      <Route path="/documents">
        <ProtectedRoute>
          <Documents />
        </ProtectedRoute>
      </Route>
      <Route path="/follow-up">
        <ProtectedRoute>
          <FollowUp />
        </ProtectedRoute>
      </Route>
      <Route path="/collections">
        <ProtectedRoute>
          <Collections />
        </ProtectedRoute>
      </Route>
      <Route path="/vault">
        <ProtectedRoute>
          <Vault />
        </ProtectedRoute>
      </Route>
      <Route path="/factoring">
        <ProtectedRoute>
          <Factoring />
        </ProtectedRoute>
      </Route>
      <Route path="/tasks">
        <ProtectedRoute>
          <Tasks />
        </ProtectedRoute>
      </Route>
      <Route path="/credit-checks">
        <ProtectedRoute>
          <CreditChecks />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute>
          <Admin />
        </ProtectedRoute>
      </Route>
      <Route path="/activities">
        <ProtectedRoute>
          <Activities />
        </ProtectedRoute>
      </Route>
      <Route path="/reports">
        <ProtectedRoute>
          <Reports />
        </ProtectedRoute>
      </Route>
      <Route path="/fuel-cards-internal">
        <ProtectedRoute>
          <FuelCardsInternal />
        </ProtectedRoute>
      </Route>
      <Route path="/profile">
        <ProtectedRoute>
          <Profile />
        </ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute>
          <Settings />
        </ProtectedRoute>
      </Route>
      <Route path="/download">
        <ProtectedRoute>
          <DownloadPage />
        </ProtectedRoute>
      </Route>
      <Route path="/form-demo">
        <ProtectedRoute>
          <FormDemo />
        </ProtectedRoute>
      </Route>
      <Route path="/landing">
        <ProtectedRoute>
          <Landing />
        </ProtectedRoute>
      </Route>
      <Route path="*" component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
