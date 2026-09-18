import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionWatcher } from "@/components/PermissionWatcher";
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
import FuelAdvanceTracking from "@/pages/fuel-advance-tracking";
import FuelAdvanceDetail from "@/pages/fuel-advance-detail";
import Profile from "@/pages/profile";
import Settings from "@/pages/settings";
import DownloadPage from "@/pages/download";
import FollowUp from "@/pages/follow-up";
import Collections from "@/pages/collections";
import Vault from "@/pages/vault";
import Factoring from "@/pages/factoring";
import FundingQueue from "@/pages/funding-queue";
import Tasks from "@/pages/tasks";
import TaskDetail from "@/pages/task-detail";
import Brokers from "@/pages/brokers";
import FormDemo from "@/pages/form-demo";
import LoginPage from "@/pages/login";
import Help from "@/pages/help";
import Payouts from "@/pages/payouts";
import CashApplication from "@/pages/cash-application";
import Exceptions from "@/pages/exceptions";
import AuditLog from "@/pages/audit-log";
import FmcsaAuthority from "@/pages/fmcsa-authority";
import InvoiceDetail from "@/pages/invoice-detail";
import DocumentRules from "@/pages/document-rules";
import WorkflowBuilder from "@/pages/workflow-builder";
import BrokerDetail from "@/pages/broker-detail";
import ClientDetail from "@/pages/client-detail";
import CarrierOnboarding from "@/pages/carrier-onboarding";
import PayoutDetail from "@/pages/payout-detail";
import LoadDetail from "@/pages/load-detail";
import Lockbox from "@/pages/lockbox";
import HeldQueue from "@/pages/held";
import Dispatchers from "@/pages/dispatchers";
import Trucks from "@/pages/trucks";
import BankTransfers from "@/pages/bank-transfers";
import Payroll from "@/pages/payroll";
import BulkInvoices from "@/pages/bulk-invoices";
import ReleaseLetters from "@/pages/release-letters";
import AIAssistant from "@/pages/ai-assistant";
import PortalLanding from "@/pages/portal/index";
import PortalRegister from "@/pages/portal/register";
import PortalLogin from "@/pages/portal/login";
import PortalDashboard from "@/pages/portal/dashboard";
import PortalSubmit from "@/pages/portal/submit";
import PortalSubmissions from "@/pages/portal/submissions";
import PortalProfile from "@/pages/portal/profile";
import PortalSubmissionsPage from "@/pages/portal-submissions";
import CalendarPage from "@/pages/calendar";
import Expenses from "@/pages/expenses";
import Tickets from "@/pages/tickets";
import TicketDetail from "@/pages/ticket-detail";
import PortalChat from "@/pages/portal/chat";
import { TeamChatDock } from "@/pages/chat";

function Router() {
  useTheme(); // Initialize theme
  const [location] = useLocation();
  const isPublicRoute =
    location === "/login" ||
    location === "/portal" ||
    location.startsWith("/portal/");

  const routes = (
    <Switch>
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
      <Route path="/invoices/:id">
        <ProtectedRoute>
          <InvoiceDetail />
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
      <Route path="/funding-queue">
        <ProtectedRoute>
          <FundingQueue />
        </ProtectedRoute>
      </Route>
      <Route path="/sheets">
        <ProtectedRoute>
          <FundingQueue />
        </ProtectedRoute>
      </Route>
      <Route path="/payouts">
        <ProtectedRoute>
          <Payouts />
        </ProtectedRoute>
      </Route>
      <Route path="/tasks">
        <ProtectedRoute>
          <Tasks />
        </ProtectedRoute>
      </Route>
      <Route path="/tasks/:id">
        <ProtectedRoute>
          <TaskDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/calendar">
        <ProtectedRoute>
          <CalendarPage />
        </ProtectedRoute>
      </Route>
      <Route path="/brokers">
        <ProtectedRoute>
          <Brokers />
        </ProtectedRoute>
      </Route>
      <Route path="/credit-checks">
        <ProtectedRoute>
          <CreditChecks />
        </ProtectedRoute>
      </Route>
      <Route path="/cash-application">
        <ProtectedRoute>
          <CashApplication />
        </ProtectedRoute>
      </Route>
      <Route path="/lockbox">
        <ProtectedRoute>
          <Lockbox />
        </ProtectedRoute>
      </Route>
      <Route path="/held">
        <ProtectedRoute>
          <HeldQueue />
        </ProtectedRoute>
      </Route>
      <Route path="/exceptions">
        <ProtectedRoute>
          <Exceptions />
        </ProtectedRoute>
      </Route>
      <Route path="/audit-log">
        <ProtectedRoute>
          <AuditLog />
        </ProtectedRoute>
      </Route>
      <Route path="/fmcsa-authority">
        <ProtectedRoute>
          <FmcsaAuthority />
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
      <Route path="/help">
        <ProtectedRoute>
          <Help />
        </ProtectedRoute>
      </Route>
      <Route path="/fuel-advance/:id">
        <ProtectedRoute>
          <FuelAdvanceDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/fuel-advance">
        <ProtectedRoute>
          <FuelAdvanceTracking />
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
      <Route path="/document-rules">
        <ProtectedRoute>
          <DocumentRules />
        </ProtectedRoute>
      </Route>
      <Route path="/workflow-builder">
        <ProtectedRoute>
          <WorkflowBuilder />
        </ProtectedRoute>
      </Route>
      <Route path="/brokers/:id">
        <ProtectedRoute>
          <BrokerDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/clients/:id">
        <ProtectedRoute>
          <ClientDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/carriers/new">
        <ProtectedRoute>
          <CarrierOnboarding />
        </ProtectedRoute>
      </Route>
      <Route path="/carriers/:id/edit">
        <ProtectedRoute>
          <CarrierOnboarding />
        </ProtectedRoute>
      </Route>
      <Route path="/carriers/:id">
        <ProtectedRoute>
          <ClientDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/payouts/:id">
        <ProtectedRoute>
          <PayoutDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/loads/:id">
        <ProtectedRoute>
          <LoadDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/dispatchers">
        <ProtectedRoute>
          <Dispatchers />
        </ProtectedRoute>
      </Route>
      <Route path="/trucks">
        <ProtectedRoute>
          <Trucks />
        </ProtectedRoute>
      </Route>
      <Route path="/bank-transfers">
        <ProtectedRoute>
          <BankTransfers />
        </ProtectedRoute>
      </Route>
      <Route path="/payroll">
        <ProtectedRoute>
          <Payroll />
        </ProtectedRoute>
      </Route>
      <Route path="/expenses">
        <ProtectedRoute>
          <Expenses />
        </ProtectedRoute>
      </Route>
      <Route path="/chat">
        <Redirect to="/" />
      </Route>
      <Route path="/tickets">
        <ProtectedRoute><Tickets /></ProtectedRoute>
      </Route>
      <Route path="/tickets/:id">
        <ProtectedRoute><TicketDetail /></ProtectedRoute>
      </Route>
      <Route path="/bulk-invoices">
        <ProtectedRoute>
          <BulkInvoices />
        </ProtectedRoute>
      </Route>
      <Route path="/release-letters">
        <ProtectedRoute>
          <ReleaseLetters />
        </ProtectedRoute>
      </Route>
      <Route path="/ai-assistant">
        <ProtectedRoute>
          <AIAssistant />
        </ProtectedRoute>
      </Route>
      {/* Portal public routes */}
      <Route path="/portal"><PortalLanding /></Route>
      <Route path="/portal/register"><PortalRegister /></Route>
      <Route path="/portal/login"><PortalLogin /></Route>
      <Route path="/portal/dashboard"><PortalDashboard /></Route>
      <Route path="/portal/submit"><PortalSubmit /></Route>
      <Route path="/portal/submissions"><PortalSubmissions /></Route>
      <Route path="/portal/chat"><PortalChat /></Route>
      <Route path="/portal/profile"><PortalProfile /></Route>
      {/* Agent portal submissions */}
      <Route path="/portal-submissions">
        <ProtectedRoute><PortalSubmissionsPage /></ProtectedRoute>
      </Route>
      <Route path="*" component={NotFound} />
    </Switch>
  );

  if (isPublicRoute) {
    return (
      <>
        <PermissionWatcher />
        {routes}
      </>
    );
  }

  return (
    <div className="ff-app-shell flex h-screen flex-col overflow-hidden">
      <PermissionWatcher />
      <div className="min-h-0 flex-1 overflow-hidden [&>div]:!h-full">
        {routes}
      </div>
      <TeamChatDock />
    </div>
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
