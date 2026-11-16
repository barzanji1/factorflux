import { lazy, Suspense, useEffect, useState } from "react";
import { PageSnapshotScope } from "@/components/loading/PageSnapshotFrame";
import { lazyPage } from "@/lib/lazy-page";
import { PreparedStaffRoute as ProtectedRoute } from "@/lib/staff-entry";
import LoginPage from "@/pages/login";
import { Switch, Route, Redirect, useLocation, Router as LocationRouter } from "wouter";
import { NavigationCoordinator, useSeamlessLocation, useSeamlessSearch } from "@/lib/seamless-navigation";
import "@/styles/navigation-transitions.css";
import { CustomerBrandHead } from "@/components/brand/customer-brand-head";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useStaffIdentity } from "@/hooks/useAuth";
import { PermissionWatcher } from "@/components/PermissionWatcher";
import { useTheme } from "@/hooks/useTheme";
import { StartupSplash } from "@/components/loading/StartupSplash";
import { NavigationPending } from "@/components/loading/NavigationPending";
import { StaffSidebarHost } from "@/components/layout/sidebar-host";
const NotFound = lazyPage([], () => import("@/pages/not-found"));
const AccessDenied = lazyPage([], () => import("@/pages/access-denied"));
const Landing = lazyPage(["/landing"], () => import("@/pages/landing"));
const Dashboard = lazyPage(["/"], () => import("@/pages/dashboard"));
const NeuPreview = lazyPage(["/neu-preview"], () => import("@/pages/neu-preview"));
const Invoices = lazyPage(["/invoices"], () => import("@/pages/invoices"));
const Clients = lazyPage(["/clients", "/carriers"], () => import("@/pages/clients"));
const Documents = lazyPage(["/documents"], () => import("@/pages/documents"));
const CreditChecks = lazyPage(["/credit-checks"], () => import("@/pages/credit-checks"));
const Admin = lazyPage(["/admin"], () => import("@/pages/admin"));
const Activities = lazyPage(["/activities"], () => import("@/pages/activities"));
const Reports = lazyPage(["/reports"], () => import("@/pages/reports"));
const FuelAdvanceTracking = lazyPage(["/fuel-advance"], () => import("@/pages/fuel-advance-tracking"));
const FuelAdvanceDetail = lazyPage(["/fuel-advance/:id"], () => import("@/pages/fuel-advance-detail"));
const Profile = lazyPage(["/profile"], () => import("@/pages/profile"));
const Settings = lazyPage(["/settings"], () => import("@/pages/settings"));
const DownloadPage = lazyPage(["/download"], () => import("@/pages/download"));
const FollowUp = lazyPage(["/follow-up", "/followups"], () => import("@/pages/follow-up"));
const Collections = lazyPage(["/collections"], () => import("@/pages/collections"));
const Vault = lazyPage(["/vault"], () => import("@/pages/vault"));
const Factoring = lazyPage(["/factoring"], () => import("@/pages/factoring"));
const FundingQueue = lazyPage(["/sheets"], () => import("@/pages/funding-queue"));
const Tasks = lazyPage(["/tasks"], () => import("@/pages/tasks"));
const TaskDetail = lazyPage(["/tasks/:id"], () => import("@/pages/task-detail"));
const Brokers = lazyPage(["/brokers"], () => import("@/pages/brokers"));
const Help = lazyPage(["/help"], () => import("@/pages/help"));
const Payouts = lazyPage(["/payouts"], () => import("@/pages/payouts"));
const CashApplication = lazyPage(["/cash-application"], () => import("@/pages/cash-application"));
const Exceptions = lazyPage(["/exceptions"], () => import("@/pages/exceptions"));
const AuditLog = lazyPage(["/audit-log"], () => import("@/pages/audit-log"));
const FmcsaAuthority = lazyPage(["/fmcsa-authority"], () => import("@/pages/fmcsa-authority"));
const InvoiceDetail = lazyPage(["/invoices/:id"], () => import("@/pages/invoice-detail"));
const DocumentRules = lazyPage(["/document-rules"], () => import("@/pages/document-rules"));
const WorkflowBuilder = lazyPage(["/workflow-builder"], () => import("@/pages/workflow-builder"));
const BrokerDetail = lazyPage(["/brokers/:id"], () => import("@/pages/broker-detail"));
const ClientDetail = lazyPage(["/clients/:id", "/carriers/:id"], () => import("@/pages/client-detail"));
const CarrierOnboarding = lazyPage(["/carrier-onboarding", "/carriers/new", "/carriers/:id/edit"], () => import("@/pages/carrier-onboarding"));
const PayoutDetail = lazyPage(["/payouts/:id"], () => import("@/pages/payout-detail"));
const LoadDetail = lazyPage(["/loads/:id"], () => import("@/pages/load-detail"));
const Lockbox = lazyPage(["/lockbox"], () => import("@/pages/lockbox"));
const HeldQueue = lazyPage(["/held"], () => import("@/pages/held"));
const Dispatchers = lazyPage(["/dispatchers"], () => import("@/pages/dispatchers"));
const Trucks = lazyPage(["/trucks"], () => import("@/pages/trucks"));
const BankTransfers = lazyPage(["/bank-transfers"], () => import("@/pages/bank-transfers"));
const Payroll = lazyPage(["/payroll"], () => import("@/pages/payroll"));
const BulkInvoices = lazyPage(["/bulk-invoices"], () => import("@/pages/bulk-invoices"));
const ReleaseLetters = lazyPage(["/release-letters"], () => import("@/pages/release-letters"));
const AIAssistant = lazyPage(["/ai-assistant"], () => import("@/pages/ai-assistant"));
const PortalLanding = lazyPage(["/portal"], () => import("@/pages/portal/index"));
const PortalRegister = lazyPage(["/portal/register"], () => import("@/pages/portal/register"));
const PortalLogin = lazyPage(["/portal/login"], () => import("@/pages/portal/login"));
const PortalDashboard = lazyPage(["/portal/dashboard"], () => import("@/pages/portal/dashboard"));
const PortalSubmit = lazyPage(["/portal/submit"], () => import("@/pages/portal/submit"));
const PortalSubmissions = lazyPage(["/portal/submissions"], () => import("@/pages/portal/submissions"));
const PortalProfile = lazyPage(["/portal/profile"], () => import("@/pages/portal/profile"));
const PortalSubmissionsPage = lazyPage(["/portal-submissions"], () => import("@/pages/portal-submissions"));
const CalendarPage = lazyPage(["/calendar"], () => import("@/pages/calendar"));
const Expenses = lazyPage(["/expenses"], () => import("@/pages/expenses"));
const LegacyTicketRedirect = lazyPage(["/tickets", "/tickets/:id", "/carrier-messages"], () => import("@/pages/legacy-ticket-redirect"));
const PortalChat = lazyPage(["/portal/chat"], () => import("@/pages/portal/chat"));
const ClientEmailPage = lazyPage(["/client-email", "/email-log"], () => import("@/pages/client-email"));
const ItSupport = lazyPage(["/it-support"], () => import("@/pages/it-support"));
const TeamChatWorkspace = lazy(() => import("@/pages/chat").then(module => ({ default: module.TeamChatWorkspace })));
const RouteLoading = lazy(() => import("@/components/layout/route-loading"));

function Router() {
  useTheme(); // Initialize theme
  const [location, navigate] = useLocation();
  const { user, permissionsLoaded, isLoading } = useStaffIdentity();
  useEffect(() => {
    if (location !== "/login") document.documentElement.removeAttribute("data-login-entry");
  }, [location]);
  const chatPageActive = location === "/chat" && !!user && !isLoading &&
    (user.role === "admin" || permissionsLoaded);
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    const handleAccessDenied = () => setAccessDenied(true);
    window.addEventListener("app:access-denied", handleAccessDenied);
    return () => window.removeEventListener("app:access-denied", handleAccessDenied);
  }, []);
  if (accessDenied) {
    return <AccessDenied className="ff-institutional-root" onBack={() => { setAccessDenied(false); navigate("/"); }} />;
  }
  const isPublicRoute =
    location === "/login" ||
    location === "/portal" ||
    location.startsWith("/portal/");

  const routes = (
    <Switch>
      <Route path="/login">
        <LoginPage />
      </Route>
      <Route path="/neu-preview">
        <ProtectedRoute><NeuPreview /></ProtectedRoute>
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
      <Route path="/client-email">
        <ProtectedRoute>
          <ClientEmailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/email-log">
        <ProtectedRoute><Redirect to="/client-email?tab=log" /></ProtectedRoute>
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
      <Route path="/followups">
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
        {/* The persistent workspace below supplies the page and background alerts. */}
        <ProtectedRoute>{null}</ProtectedRoute>
      </Route>
      <Route path="/tickets/:id">
        <ProtectedRoute><LegacyTicketRedirect /></ProtectedRoute>
      </Route>
      <Route path="/tickets">
        <ProtectedRoute><Redirect to="/it-support" /></ProtectedRoute>
      </Route>
      <Route path="/it-support">
        <ProtectedRoute><ItSupport /></ProtectedRoute>
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

  // Isolate the opt-in design preview from retro shell styles; it remains protected above.
  if (isPublicRoute || location === "/neu-preview") {
    return (
      <>
        <PermissionWatcher />
        <Suspense fallback={<StartupSplash />}>{routes}</Suspense>
      </>
    );
  }

  return (
    <div className={`${location === "/" || location === "/invoices" || location.startsWith("/invoices/") || location === "/clients" || location === "/brokers" || location === "/documents" || location === "/tasks" || location === "/help" || location === "/calendar" || location === "/chat" || location === "/bulk-invoices" || location === "/portal-submissions" || /^\/(?:clients|carriers|brokers)\/\d+\/?$/.test(location) ? "ff-neu-root" : "ff-app-shell"} ff-financial-dashboard-shell ff-institutional-root relative flex h-screen flex-col overflow-hidden`}>
      <PermissionWatcher />
      <StaffSidebarHost key={user?.id ?? "anonymous"} enabled={!!user && !isLoading}>
      <div data-route-viewport style={chatPageActive ? undefined : { minHeight: "100%" }} className={chatPageActive ? "hidden" : "relative min-h-0 flex-1 overflow-hidden [&>div]:!h-full"}>
        <PageSnapshotScope><Suspense fallback={<Suspense fallback={<StartupSplash />}><RouteLoading /></Suspense>}>
          {routes}
        </Suspense></PageSnapshotScope>
      </div>
      {user && <Suspense fallback={null}><TeamChatWorkspace /></Suspense>}
      </StaffSidebarHost>
    </div>
  );
}

function App() {
  return (
    <LocationRouter hook={useSeamlessLocation} searchHook={useSeamlessSearch}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NavigationCoordinator />
        <NavigationPending />
        <TooltipProvider>
          <Toaster />
          <CustomerBrandHead />
          <Suspense fallback={<StartupSplash />}><Router /></Suspense>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
    </LocationRouter>
  );
}

export default App;
