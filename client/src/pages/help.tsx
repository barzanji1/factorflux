import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  HelpCircle,
  Phone,
  MessageCircle,
  FileText,
  Users,
  Search,
  Settings,
  BarChart3,
  AlertCircle,
  Package,
  Star,
  Mail,
  Sparkles,
  LifeBuoy,
  LayoutDashboard,
  Upload,
  DollarSign,
  Shield,
  Clock,
  Building,
  Truck,
  CheckSquare,
  Globe,
  Calculator,
  ClipboardCheck,
  UserCheck,
  Link as LinkIcon,
  Database,
  Monitor,
  CreditCard,
  Fuel,
  Calendar,
  Send,
  TrendingUp,
  Lock,
  Clipboard,
  Terminal,
  Server,
  MapPin,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  request_documents: "Request Documents",
  payment_notice: "Payment Notice",
  general_inquiry: "General Inquiry",
  follow_up: "Follow Up",
};

function ContactTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [messageType, setMessageType] = useState<string>("");
  const [body, setBody] = useState("");

  const { data: clients = [] } = useQuery<Array<{ id: number; name: string; email?: string }>>({
    queryKey: ["/api/clients"],
  });

  const { data: sentMessages = [], isLoading: messagesLoading } = useQuery<any[]>({
    queryKey: ["/api/messages", selectedClientId],
    queryFn: async () => {
      const url = selectedClientId
        ? `/api/messages?clientId=${selectedClientId}`
        : "/api/messages";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!selectedClientId,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId: selectedClientId,
          subject,
          messageType,
          body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) throw new Error(data.error || "Failed to send");
      if (res.status === 207) throw new Error(data.error || "Email delivery failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", selectedClientId] });
      toast({ title: "Message sent", description: "Email delivered to client successfully." });
      setSubject("");
      setMessageType("");
      setBody("");
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", selectedClientId] });
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const canSend =
    !!selectedClientId &&
    subject.trim().length > 0 &&
    messageType.length > 0 &&
    body.trim().length > 0 &&
    !sendMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Contact Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white text-center shadow-md dark:bg-[hsl(var(--card))]">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
              <Users className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg text-slate-900 dark:text-white">Primary Contact</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">Main point of contact</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-medium text-blue-600 dark:text-blue-400">Dosh Barzanji</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Email: <span className="font-medium">Dosh@truckingprosfinancial.com</span>
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Phone: <span className="font-medium">385-495-4962</span>
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Internal use only</p>
          </CardContent>
        </Card>

        <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white text-center shadow-md dark:bg-[hsl(var(--card))]">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
              <Mail className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg text-slate-900 dark:text-white">Support Email</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">Client-facing support</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Support@Truckingprosfinancial.com</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Mon–Fri 7AM–3PM MST</p>
          </CardContent>
        </Card>

        <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white text-center shadow-md dark:bg-[hsl(var(--card))]">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
              <Phone className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg text-slate-900 dark:text-white">Emergency Line</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">Urgent operational issues</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-medium text-red-600 dark:text-red-400">385-495-4962</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">24/7 availability</p>
          </CardContent>
        </Card>
      </div>

      {/* Send Message Form */}
      <Card className="mx-auto max-w-2xl rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Send className="h-5 w-5" />
            Send a Message
          </CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Email a client or carrier directly. All messages are logged.
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Client / Carrier
              </label>
              <Select
                value={selectedClientId?.toString() ?? ""}
                onValueChange={(v) => setSelectedClientId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client or carrier" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                      {c.email ? "" : " (no email)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Message Type
              </label>
              <Select value={messageType} onValueChange={setMessageType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="request_documents">Request Documents</SelectItem>
                  <SelectItem value="payment_notice">Payment Notice</SelectItem>
                  <SelectItem value="general_inquiry">General Inquiry</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Subject
            </label>
            <Input
              placeholder="Message subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sendMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Message
            </label>
            <Textarea
              placeholder="Type your message here..."
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sendMutation.isPending}
            />
          </div>

          <Button
            className="h-11 w-full rounded-xl"
            disabled={!canSend}
            onClick={() => sendMutation.mutate()}
          >
            {sendMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
            ) : (
              <><Send className="mr-2 h-4 w-4" /> Send Message</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Sent Messages Log */}
      {selectedClientId && (
        <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
              <MessageCircle className="h-5 w-5" />
              Sent Messages
            </CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Message history for {clients.find((c) => c.id === selectedClientId)?.name}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {messagesLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading messages...
              </div>
            ) : sentMessages.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                No messages sent to this client yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sentMessages.map((msg: any) => (
                    <TableRow key={msg.id}>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {new Date(msg.sentAt).toLocaleDateString()}{" "}
                        {new Date(msg.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium text-slate-900 dark:text-white max-w-[200px] truncate">
                        {msg.subject}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {MESSAGE_TYPE_LABELS[msg.messageType] || msg.messageType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {msg.status === "sent" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle className="h-3.5 w-3.5" /> Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-sm font-medium">
                            <XCircle className="h-3.5 w-3.5" /> Failed
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [featureSearchQuery, setFeatureSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const quickStartGuides = [
    {
      title: "Getting Started",
      description: "Learn the basics of FactorFlux",
      icon: HelpCircle,
      steps: [
        "Log in with your credentials",
        "Explore the dashboard overview",
        "Navigate through different modules",
        "Set up your user preferences",
      ],
    },
    {
      title: "Client Management",
      description: "Manage your trucking clients",
      icon: Users,
      steps: [
        "Add new clients from the Clients tab",
        "Upload client documents and contracts",
        "Track client payment history",
        "Monitor client performance metrics",
      ],
    },
    {
      title: "Invoice Processing",
      description: "Process freight invoices efficiently",
      icon: FileText,
      steps: [
        "Upload rate confirmations and BOLs",
        "Review and verify invoice details",
        "Submit for factoring approval",
        "Track payment status and aging",
      ],
    },
    {
      title: "Document Upload",
      description: "Upload and manage documents",
      icon: Upload,
      steps: [
        "Navigate to the Documents section",
        "Drag and drop files or click to browse",
        "Supported formats: PDF, JPG, PNG",
        "Documents are automatically categorized",
      ],
    },
  ];

  const faqItems = [
    {
      question: "How do I upload documents?",
      answer:
        "Navigate to the Documents tab, then drag and drop files into the upload zone or click 'Choose Files'. Supported formats include PDF, JPG, and PNG files up to 10MB each.",
    },
    {
      question: "What is the Vault feature?",
      answer:
        "The Vault is a secure storage area for confidential client information such as tax IDs, bank details, and sensitive documents. Access is restricted and all actions are logged.",
    },
    {
      question: "How do I track time?",
      answer:
        "Use the time clock feature in the top navigation. Click the clock icon to clock in/out. Your time entries are automatically tracked and visible in your dashboard.",
    },
    {
      question: "What are fuel advances?",
      answer:
        "Fuel advances allow you to track fuel card applications and carrier fuel advance requests. Use the Fuel Advance tab to manage applications and track status.",
    },
    {
      question: "How do I access reports?",
      answer:
        "Navigate to the Reports tab to view analytics, generate custom reports, and access integrated forms from Trucking Pros Financial.",
    },
    {
      question: "What is the Collections module?",
      answer:
        "The Collections module helps track overdue invoices, client payment history, and manage collection activities. It provides tools for monitoring client performance and payment trends.",
    },
  ];

  const systemFeatures = [
    {
      name: "Dashboard",
      route: "/",
      icon: LayoutDashboard,
      category: "Core",
      status: "active",
      description: "Main overview with today's totals and key metrics",
    },
    {
      name: "Agent Report",
      route: "/reports",
      icon: BarChart3,
      category: "Reports",
      status: "active",
      description: "Performance analytics for agents",
    },
    {
      name: "Aging Report",
      route: "/reports",
      icon: TrendingUp,
      category: "Reports",
      status: "active",
      description: "Invoice aging and payment tracking",
    },
    {
      name: "Broker Report",
      route: "/reports",
      icon: Building,
      category: "Reports",
      status: "active",
      description: "Broker performance and metrics",
    },
    {
      name: "Factoring",
      route: "/factoring",
      icon: DollarSign,
      category: "Financial",
      status: "active",
      description: "Invoice factoring and payment processing",
    },
    {
      name: "Bank Transfers",
      route: "/factoring",
      icon: CreditCard,
      category: "Financial",
      status: "active",
      description: "ACH and Wire transfer management",
    },
    {
      name: "Payments",
      route: "/factoring",
      icon: DollarSign,
      category: "Financial",
      status: "active",
      description: "Payment processing and tracking",
    },
    {
      name: "Payments Portal",
      route: "/factoring",
      icon: Globe,
      category: "Financial",
      status: "active",
      description: "Client payment portal access",
    },
    {
      name: "Expenses",
      route: "/factoring",
      icon: Calculator,
      category: "Financial",
      status: "planned",
      description: "Expense tracking and management",
    },
    {
      name: "Clients",
      route: "/clients",
      icon: Users,
      category: "Management",
      status: "active",
      description: "Client database and management",
    },
    {
      name: "Carriers",
      route: "/clients",
      icon: Truck,
      category: "Management",
      status: "active",
      description: "Carrier information and setup",
    },
    {
      name: "Brokers",
      route: "/brokers",
      icon: Building,
      category: "Management",
      status: "active",
      description: "Freight broker management",
    },
    {
      name: "Dispatchers",
      route: "/clients",
      icon: UserCheck,
      category: "Management",
      status: "planned",
      description: "Dispatcher contact management",
    },
    {
      name: "Invoices",
      route: "/invoices",
      icon: FileText,
      category: "Documents",
      status: "active",
      description: "Invoice processing and tracking",
    },
    {
      name: "Documents",
      route: "/documents",
      icon: Upload,
      category: "Documents",
      status: "active",
      description: "Document upload and management",
    },
    {
      name: "Bulk Invoices",
      route: "/invoices",
      icon: Package,
      category: "Documents",
      status: "planned",
      description: "Batch invoice processing",
    },
    {
      name: "Carrier POD's",
      route: "/documents",
      icon: ClipboardCheck,
      category: "Documents",
      status: "active",
      description: "Proof of delivery documents",
    },
    {
      name: "Tasks",
      route: "/tasks",
      icon: CheckSquare,
      category: "Operations",
      status: "active",
      description: "Task assignment and tracking",
    },
    {
      name: "My Tasks",
      route: "/tasks",
      icon: Clipboard,
      category: "Operations",
      status: "active",
      description: "Personal task management",
    },
    {
      name: "To Do",
      route: "/tasks",
      icon: ClipboardCheck,
      category: "Operations",
      status: "active",
      description: "Task list and reminders",
    },
    {
      name: "Followups",
      route: "/collections",
      icon: Phone,
      category: "Operations",
      status: "active",
      description: "Client follow-up management",
    },
    {
      name: "Calendar",
      route: "/tasks",
      icon: Calendar,
      category: "Operations",
      status: "planned",
      description: "Schedule and appointment management",
    },
    {
      name: "Live Chat",
      route: "/help",
      icon: LifeBuoy,
      category: "Communication",
      status: "active",
      description: "Real-time customer support",
    },
    {
      name: "Send Email",
      route: "/clients",
      icon: Mail,
      category: "Communication",
      status: "planned",
      description: "Email communication tools",
    },
    {
      name: "Send SMS",
      route: "/clients",
      icon: MessageCircle,
      category: "Communication",
      status: "planned",
      description: "SMS messaging system",
    },
    {
      name: "Bulk SMS",
      route: "/clients",
      icon: Send,
      category: "Communication",
      status: "planned",
      description: "Mass SMS campaigns",
    },
    {
      name: "Vault",
      route: "/vault",
      icon: Shield,
      category: "Security",
      status: "active",
      description: "Secure document and data storage",
    },
    {
      name: "MC Check",
      route: "/credit-checks",
      icon: AlertCircle,
      category: "Security",
      status: "active",
      description: "Motor carrier authority verification",
    },
    {
      name: "C / B Reviews",
      route: "/collections",
      icon: Star,
      category: "Security",
      status: "active",
      description: "Credit and background reviews",
    },
    {
      name: "Reviews",
      route: "/collections",
      icon: Star,
      category: "Security",
      status: "active",
      description: "Client and carrier reviews",
    },
    {
      name: "Fuel Advance",
      route: "/fuel-cards-internal",
      icon: Fuel,
      category: "Transportation",
      status: "active",
      description: "Fuel advance processing",
    },
    {
      name: "Trucks",
      route: "/clients",
      icon: Truck,
      category: "Transportation",
      status: "planned",
      description: "Fleet and truck management",
    },
    {
      name: "Admin",
      route: "/admin",
      icon: Shield,
      category: "Admin",
      status: "active",
      description: "System administration panel",
    },
    {
      name: "Settings",
      route: "/settings",
      icon: Settings,
      category: "Admin",
      status: "active",
      description: "System configuration",
    },
    {
      name: "My Profile",
      route: "/profile",
      icon: Users,
      category: "Admin",
      status: "active",
      description: "User profile management",
    },
    {
      name: "Logs",
      route: "/activities",
      icon: Terminal,
      category: "Admin",
      status: "active",
      description: "System activity logs",
    },
    {
      name: "Mail Server",
      route: "/settings",
      icon: Server,
      category: "Admin",
      status: "planned",
      description: "Email server configuration",
    },
    {
      name: "My Clocking",
      route: "/",
      icon: Clock,
      category: "Time",
      status: "active",
      description: "Personal time tracking",
    },
    {
      name: "Time Cards",
      route: "/admin",
      icon: Clock,
      category: "Time",
      status: "planned",
      description: "Employee time card management",
    },
    {
      name: "My Schedule",
      route: "/tasks",
      icon: Calendar,
      category: "Time",
      status: "planned",
      description: "Personal scheduling",
    },
    {
      name: "Payroll",
      route: "/admin",
      icon: Calculator,
      category: "Time",
      status: "planned",
      description: "Payroll processing and management",
    },
    {
      name: "Reports",
      route: "/reports",
      icon: BarChart3,
      category: "Reports",
      status: "active",
      description: "Comprehensive reporting suite",
    },
    {
      name: "Sheets",
      route: "/reports",
      icon: Database,
      category: "Reports",
      status: "planned",
      description: "Data export and spreadsheet tools",
    },
    {
      name: "Tickets",
      route: "/help",
      icon: AlertCircle,
      category: "Support",
      status: "active",
      description: "Support ticket system",
    },
    {
      name: "Software Request",
      route: "/help",
      icon: Package,
      category: "Support",
      status: "planned",
      description: "Software enhancement requests",
    },
    {
      name: "Linked",
      route: "/settings",
      icon: LinkIcon,
      category: "Integration",
      status: "planned",
      description: "Third-party integrations",
    },
    {
      name: "Lockbox",
      route: "/vault",
      icon: Lock,
      category: "Integration",
      status: "planned",
      description: "Secure payment lockbox",
    },
    {
      name: "Branches",
      route: "/admin",
      icon: MapPin,
      category: "Locations",
      status: "planned",
      description: "Multi-location management",
    },
    {
      name: "Factoring Co",
      route: "/factoring",
      icon: Building,
      category: "Locations",
      status: "planned",
      description: "Factoring company management",
    },
    {
      name: "Pres",
      route: "/reports",
      icon: Monitor,
      category: "Workflow",
      status: "planned",
      description: "Presentation and reporting tools",
    },
  ];

  const categories = [
    "All",
    "Core",
    "Financial",
    "Management",
    "Documents",
    "Operations",
    "Communication",
    "Security",
    "Transportation",
    "Admin",
    "Time",
    "Reports",
    "Support",
    "Integration",
    "Locations",
    "Workflow",
  ];

  const filteredFAQ = faqItems.filter(
    (item) =>
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFeatures = systemFeatures.filter((feature) => {
    const matchesSearch =
      feature.name.toLowerCase().includes(featureSearchQuery.toLowerCase()) ||
      feature.description
        .toLowerCase()
        .includes(featureSearchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === "All" || feature.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <AppShell
      title="Help Center"
      subtitle="Find answers, explore features, and get support for FactorFlux"
    >
      <div className="space-y-8">
        <section className="rounded-[28px] border border-[hsl(var(--border))] bg-white p-6 shadow-md dark:bg-[hsl(var(--card))] lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_18px_34px_rgba(37,99,235,0.22)]">
                <HelpCircle className="h-8 w-8" />
              </div>

              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  Support hub
                </div>

                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white lg:text-3xl">
                  FactorFlux Help Center
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Learn the platform, explore system functions, search common
                  questions, and connect with support when you need help.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-[420px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-center dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Guides
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {quickStartGuides.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-center dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Features
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {systemFeatures.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-center dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  FAQs
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  {faqItems.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        <Tabs defaultValue="guides" className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-[20px] bg-slate-100 p-2 md:grid-cols-3 xl:grid-cols-5 dark:bg-slate-800">
            <TabsTrigger value="guides" className="rounded-xl">
              Quick Start
            </TabsTrigger>
            <TabsTrigger value="features" className="rounded-xl">
              Features
            </TabsTrigger>
            <TabsTrigger value="faq" className="rounded-xl">
              FAQ
            </TabsTrigger>
            <TabsTrigger value="contact" className="rounded-xl">
              Contact
            </TabsTrigger>
            <TabsTrigger value="resources" className="rounded-xl">
              Resources
            </TabsTrigger>
          </TabsList>

          <TabsContent value="guides" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {quickStartGuides.map((guide, index) => (
                <Card
                  key={index}
                  className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]"
                >
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                        <guide.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          {guide.title}
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {guide.description}
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6">
                    <ol className="space-y-3">
                      {guide.steps.map((step, stepIndex) => (
                        <li key={stepIndex} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {stepIndex + 1}
                          </div>
                          <span className="text-sm text-slate-700 dark:text-slate-300">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="features" className="space-y-6">
            <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md">
              <CardContent className="p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-2xl font-bold">Today's Total</h3>
                    <p className="mt-2 text-3xl font-bold">$124,656.28</p>
                    <p className="mt-1 text-blue-100">
                      MenuID 60600 • Dosh Barzanji
                    </p>
                  </div>

                  <div className="text-left text-blue-100 lg:text-right">
                    <div>
                      ACH Cut-off Time:{" "}
                      <span className="font-bold">2:15 PM MST</span>
                    </div>
                    <div>
                      WIRE Cut-off Time:{" "}
                      <span className="font-bold">1:15 PM MST</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search system features and functions..."
                  value={featureSearchQuery}
                  onChange={(e) => setFeatureSearchQuery(e.target.value)}
                  className="h-12 rounded-2xl pl-11 pr-4"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Button
                    key={category}
                    variant={
                      selectedCategory === category ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setSelectedCategory(category)}
                    className="rounded-xl text-xs"
                  >
                    {category}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredFeatures.map((feature, index) => (
                <Card
                  key={index}
                  className={cn(
                    "cursor-pointer rounded-[22px] border bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(37,99,235,0.10)] dark:bg-[hsl(var(--card))]",
                    feature.status === "active"
                      ? "border-l-4 border-l-emerald-500"
                      : "border-l-4 border-l-amber-500"
                  )}
                  onClick={() => setLocation(feature.route)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-xl",
                          feature.status === "active"
                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                        )}
                      >
                        <feature.icon className="h-4.5 w-4.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                            {feature.name}
                          </h4>
                          <Badge
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              feature.status === "active"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                            )}
                          >
                            {feature.status === "active" ? "Active" : "Planned"}
                          </Badge>
                        </div>

                        <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                          {feature.description}
                        </p>

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {feature.category}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {feature.route}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {filteredFeatures.length === 0 && (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900/30">
                <AlertCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white">
                  No features found
                </h3>
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Try adjusting your search terms or category filter.
                </p>
              </div>
            )}

            <Card className="rounded-[22px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
              <CardContent className="p-4">
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  Feature Status
                </h4>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Active - Available now
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-amber-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Planned - In development
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="faq" className="space-y-6">
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search frequently asked questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 rounded-2xl pl-11 pr-4"
                />
              </div>

              <Accordion type="single" collapsible className="space-y-3">
                {filteredFAQ.map((item, index) => (
                  <AccordionItem
                    key={index}
                    value={`item-${index}`}
                    className="rounded-[18px] border border-slate-200 bg-white px-4 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <span className="text-left font-medium text-slate-900 dark:text-white">
                        {item.question}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 text-slate-600 dark:text-slate-400">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              {filteredFAQ.length === 0 && searchQuery && (
                <div className="py-8 text-center">
                  <p className="text-slate-500 dark:text-slate-400">
                    No results found for "{searchQuery}". Try different keywords
                    or contact support.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="contact" className="space-y-6">
            <ContactTab />
          </TabsContent>

          <TabsContent value="resources" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-blue-600" />
                    <div>
                      <CardTitle className="text-slate-900 dark:text-white">
                        User Manual
                      </CardTitle>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Complete system documentation
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full rounded-xl">
                    Download PDF
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <BarChart3 className="h-8 w-8 text-emerald-600" />
                    <div>
                      <CardTitle className="text-slate-900 dark:text-white">
                        Video Tutorials
                      </CardTitle>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Step-by-step video guides
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full rounded-xl">
                    Watch Videos
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Settings className="h-8 w-8 text-violet-600" />
                    <div>
                      <CardTitle className="text-slate-900 dark:text-white">
                        System Status
                      </CardTitle>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Check service availability
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      All Systems Operational
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-slate-900 dark:text-white">
                  Release Notes
                </CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Latest updates and improvements
                </p>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="border-l-4 border-blue-500 pl-4">
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    Version 2.1.0 - Latest
                  </h4>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Enhanced document upload, improved fuel advance tracking,
                    and new help center
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Released: September 2025
                  </p>
                </div>

                <div className="border-l-4 border-slate-300 pl-4 dark:border-slate-700">
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    Version 2.0.0
                  </h4>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Major UI refresh, new authentication system, and expanded
                    broker management
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Released: August 2025
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}