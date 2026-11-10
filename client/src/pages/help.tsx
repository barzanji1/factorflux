import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
  NeuSelect,
  NeuTab,
  NeuTabList,
  NeuTabPanel,
  NeuTable,
  NeuTableBody,
  NeuTableCell,
  NeuTableHead,
  NeuTableHeader,
  NeuTableRow,
  NeuTabs,
} from "@/styles/neu";
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
    queryKey: ["/api/clients", { all: true }],
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
        <NeuCard className="p-5 text-center">
          <div className="mb-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#d9eeee] text-[#218f9b]">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">Primary Contact</h3>
            <p className="text-sm text-[#888]">Main point of contact</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-[#218f9b]">Dosh Barzanji</p>
            <p className="text-sm text-[#777]">
              Email: <span className="font-medium">Dosh@truckingprosfinancial.com</span>
            </p>
            <p className="text-sm text-[#777]">
              Phone: <span className="font-medium">385-495-4962</span>
            </p>
            <p className="text-sm text-[#888]">Internal use only</p>
          </div>
        </NeuCard>

        <NeuCard className="p-5 text-center">
          <div className="mb-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#d9eeee] text-[#218f9b]">
              <Mail className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">Support Email</h3>
            <p className="text-sm text-[#888]">Client-facing support</p>
          </div>
          <div className="space-y-2">
            <p className="break-all text-sm font-medium text-[#218f9b]">Support@Truckingprosfinancial.com</p>
            <p className="text-sm text-[#888]">Mon–Fri 7AM–3PM MST</p>
          </div>
        </NeuCard>

        <NeuCard className="p-5 text-center">
          <div className="mb-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#d9eeee] text-[#218f9b]">
              <Phone className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">Emergency Line</h3>
            <p className="text-sm text-[#888]">Urgent operational issues</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-[#218f9b]">385-495-4962</p>
            <p className="text-sm text-[#888]">24/7 availability</p>
          </div>
        </NeuCard>
      </div>

      {/* Send Message Form */}
      <NeuCard className="mx-auto max-w-2xl p-5 sm:p-6">
        <div className="mb-5 border-b border-[#c9c9c9] pb-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Send className="h-5 w-5 text-[#27aab8]" />
            Send a Message
          </h3>
          <p className="mt-1 text-sm text-[#888]">
            Email a client or carrier directly. All messages are logged.
          </p>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#555]">
                Client / Carrier
              </label>
              <NeuSelect
                value={selectedClientId?.toString() ?? ""}
                onChange={(e) => setSelectedClientId(Number(e.target.value))}
              >
                <option value="" disabled>Select client or carrier</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id.toString()}>
                      {c.name}
                      {c.email ? "" : " (no email)"}
                    </option>
                  ))}
              </NeuSelect>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#555]">
                Message Type
              </label>
              <NeuSelect value={messageType} onChange={(e) => setMessageType(e.target.value)}>
                <option value="" disabled>Select type</option>
                <option value="request_documents">Request Documents</option>
                <option value="payment_notice">Payment Notice</option>
                <option value="general_inquiry">General Inquiry</option>
                <option value="follow_up">Follow Up</option>
              </NeuSelect>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#555]">
              Subject
            </label>
            <NeuInput
              placeholder="Message subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sendMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#555]">
              Message
            </label>
            <textarea
              placeholder="Type your message here..."
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sendMutation.isPending}
              className="min-h-32 w-full resize-y rounded-xl border-0 bg-[#e0e0e0] px-4 py-3 text-sm text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] placeholder:text-[#888] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
            />
          </div>

          <NeuButton
            variant="accent"
            className="w-full"
            disabled={!canSend}
            onClick={() => sendMutation.mutate()}
          >
            {sendMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
            ) : (
              <><Send className="mr-2 h-4 w-4" /> Send Message</>
            )}
          </NeuButton>
        </div>
      </NeuCard>

      {/* Sent Messages Log */}
      {selectedClientId && (
        <NeuCard className="overflow-hidden p-5">
          <div className="mb-5 border-b border-[#c9c9c9] pb-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <MessageCircle className="h-5 w-5 text-[#27aab8]" />
              Sent Messages
            </h3>
            <p className="text-sm text-[#888]">
              Message history for {clients.find((c) => c.id === selectedClientId)?.name}
            </p>
          </div>
          <div>
            {messagesLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[#777]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading messages...
              </div>
            ) : sentMessages.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#777]">
                No messages sent to this client yet.
              </div>
            ) : (
              <NeuTable>
                <NeuTableHeader>
                  <NeuTableRow>
                    <NeuTableHead>Date</NeuTableHead>
                    <NeuTableHead>Subject</NeuTableHead>
                    <NeuTableHead>Type</NeuTableHead>
                    <NeuTableHead>Status</NeuTableHead>
                  </NeuTableRow>
                </NeuTableHeader>
                <NeuTableBody>
                  {sentMessages.map((msg: any) => (
                    <NeuTableRow key={msg.id}>
                      <NeuTableCell className="text-sm text-[#777]">
                        {new Date(msg.sentAt).toLocaleDateString()}{" "}
                        {new Date(msg.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </NeuTableCell>
                      <NeuTableCell className="max-w-[200px] truncate font-medium">
                        {msg.subject}
                      </NeuTableCell>
                      <NeuTableCell>
                        <NeuBadge className="text-xs">
                          {MESSAGE_TYPE_LABELS[msg.messageType] || msg.messageType}
                        </NeuBadge>
                      </NeuTableCell>
                      <NeuTableCell>
                        {msg.status === "sent" ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-[#347d69]">
                            <CheckCircle className="h-3.5 w-3.5" /> Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-[#b55252]">
                            <XCircle className="h-3.5 w-3.5" /> Failed
                          </span>
                        )}
                      </NeuTableCell>
                    </NeuTableRow>
                  ))}
                </NeuTableBody>
              </NeuTable>
            )}
          </div>
        </NeuCard>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [featureSearchQuery, setFeatureSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [openFaq, setOpenFaq] = useState("");

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
      title="Support"
      subtitle="Find answers, explore features, and get support"
      group="Admin"
      neu
    >
      <div className="space-y-7">
        <section className="rounded-[28px] bg-[#e0e0e0] p-5 shadow-[-7px_-7px_16px_#ffffff,7px_7px_16px_#b8b8b8] sm:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#27aab8] text-white shadow-[-5px_-5px_12px_#ffffff,5px_5px_12px_#b8b8b8]">
                <HelpCircle className="h-8 w-8" />
              </div>

              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#e0e0e0] px-3 py-1 text-xs font-semibold text-[#218f9b] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]">
                  Support hub
                </div>

                <h1 className="text-2xl font-bold tracking-tight text-[#333] lg:text-3xl">
                  FactorFlux Help Center
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#777]">
                  Learn the platform, explore system functions, search common
                  questions, and connect with support when you need help.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-[420px]">
              <div className="rounded-2xl bg-[#e0e0e0] p-4 text-center shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                <p className="text-sm text-[#888]">
                  Guides
                </p>
                <p className="mt-1 text-2xl font-bold text-[#333]">
                  {quickStartGuides.length}
                </p>
              </div>
              <div className="rounded-2xl bg-[#e0e0e0] p-4 text-center shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                <p className="text-sm text-[#888]">
                  Features
                </p>
                <p className="mt-1 text-2xl font-bold text-[#333]">
                  {systemFeatures.length}
                </p>
              </div>
              <div className="rounded-2xl bg-[#e0e0e0] p-4 text-center shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                <p className="text-sm text-[#888]">
                  FAQs
                </p>
                <p className="mt-1 text-2xl font-bold text-[#333]">
                  {faqItems.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        <NeuTabs defaultValue="guides" onValueChange={() => setOpenFaq("")} className="space-y-6">
          <NeuTabList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <NeuTab value="guides">
              <ClipboardCheck className="h-4 w-4" />
              Quick Start
            </NeuTab>
            <NeuTab value="features">
              <Package className="h-4 w-4" />
              Features
            </NeuTab>
            <NeuTab value="faq">
              <HelpCircle className="h-4 w-4" />
              FAQ
            </NeuTab>
            <NeuTab value="contact">
              <MessageCircle className="h-4 w-4" />
              Contact
            </NeuTab>
            <NeuTab value="resources">
              <FileText className="h-4 w-4" />
              Resources
            </NeuTab>
          </NeuTabList>

          <NeuTabPanel value="guides" unmountInactive className="space-y-6">
            <div className="relative space-y-5 before:absolute before:bottom-8 before:left-10 before:top-8 before:w-px before:bg-[#b9dfe1]">
              {quickStartGuides.map((guide, index) => (
                <NeuCard
                  key={index}
                  className="relative p-5 sm:p-6"
                >
                  <div className="mb-5 flex items-center gap-3 border-b border-[#c9c9c9] pb-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#27aab8] text-lg font-bold text-white">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-[#333]">
                          {guide.title}
                        </h3>
                        <p className="mt-1 text-sm text-[#888]">
                          {guide.description}
                        </p>
                      </div>
                  </div>

                  <div>
                    <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-[#b9dfe1]">
                      {guide.steps.map((step, stepIndex) => (
                        <li key={stepIndex} className="flex items-start gap-3">
                          <div className="relative z-[1] mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#27aab8] text-xs font-bold text-white shadow-[2px_2px_5px_#b8b8b8]">
                            {stepIndex + 1}
                          </div>
                          <span className="pt-1.5 text-sm font-medium text-[#555]">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </NeuCard>
              ))}
            </div>
          </NeuTabPanel>

          <NeuTabPanel value="features" unmountInactive className="space-y-6">
            <NeuCard className="p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#888]">Today's Total</h3>
                    <p className="mt-2 text-3xl font-bold text-[#27aab8]">$124,656.28</p>
                    <p className="mt-1 text-sm text-[#777]">
                      MenuID 60600 • Dosh Barzanji
                    </p>
                  </div>

                  <div className="text-left text-sm leading-7 text-[#666] lg:text-right">
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
            </NeuCard>

            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
                <NeuInput
                  placeholder="Search system features and functions..."
                  value={featureSearchQuery}
                  onChange={(e) => setFeatureSearchQuery(e.target.value)}
                  className="pl-11 pr-4"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <NeuButton
                    key={category}
                    variant={selectedCategory === category ? "accent" : "default"}
                    onClick={() => setSelectedCategory(category)}
                    className="min-h-9 rounded-xl px-3 py-1.5 text-xs"
                  >
                    {category}
                  </NeuButton>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredFeatures.map((feature, index) => (
                <NeuCard
                  key={index}
                  className={cn(
                    "cursor-pointer p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[-9px_-9px_18px_#ffffff,9px_9px_18px_#b8b8b8]",
                  )}
                  onClick={() => setLocation(feature.route)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setLocation(feature.route);
                    }
                  }}
                  aria-label={`${feature.name}: ${feature.status}, ${feature.category}`}
                >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d9eeee] text-[#218f9b]">
                        <feature.icon className="h-[18px] w-[18px]" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <h4 className="truncate text-sm font-semibold text-[#333]">
                            {feature.name}
                          </h4>
                          <NeuBadge tone={feature.status === "active" ? "success" : "warning"} className="px-2 py-0.5 text-[10px]">
                            {feature.status === "active" ? "Active" : "Planned"}
                          </NeuBadge>
                        </div>

                        <p className="line-clamp-2 text-xs text-[#777]">
                          {feature.description}
                        </p>

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs font-medium text-[#218f9b]">
                            {feature.category}
                          </span>
                          <span className="text-[11px] text-[#888]">
                            {feature.route}
                          </span>
                        </div>
                      </div>
                    </div>
                </NeuCard>
              ))}
            </div>

            {filteredFeatures.length === 0 && (
              <NeuCard className="px-6 py-14 text-center">
                <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[#27aab8]" />
                <h3 className="text-lg font-medium text-[#333]">
                  No features found
                </h3>
                <p className="mt-2 text-[#888]">
                  Try adjusting your search terms or category filter.
                </p>
              </NeuCard>
            )}

            <NeuCard className="p-4">
                <h4 className="mb-3 font-medium text-[#333]">
                  Feature Status
                </h4>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#347d69]" />
                    <span className="text-sm text-[#777]">
                      Active - Available now
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#c28c3c]" />
                    <span className="text-sm text-[#777]">
                      Planned - In development
                    </span>
                  </div>
                </div>
            </NeuCard>
          </NeuTabPanel>

          <NeuTabPanel value="faq" unmountInactive className="space-y-6">
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
                <NeuInput
                  placeholder="Search frequently asked questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 pr-4"
                />
              </div>

              <Accordion type="single" collapsible value={openFaq} onValueChange={setOpenFaq} className="space-y-3">
                {filteredFAQ.map((item, index) => (
                  <NeuCard key={index} pressed={openFaq === `item-${index}`} className="px-4">
                    <AccordionItem value={`item-${index}`} className="border-0">
                      <AccordionTrigger className="gap-4 py-4 text-left hover:no-underline [&[data-state=open]>svg]:rotate-180 [&>svg]:text-[#27aab8] [&>svg]:transition-transform [&>svg]:duration-200">
                        <span className="text-left font-semibold text-[#333]">{item.question}</span>
                      </AccordionTrigger>
                      <AccordionContent className="text-sm leading-6 text-[#777] motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  </NeuCard>
                ))}
              </Accordion>

              {filteredFAQ.length === 0 && searchQuery && (
                <div className="py-8 text-center">
                  <p className="text-[#777]">
                    No results found for "{searchQuery}". Try different keywords
                    or contact support.
                  </p>
                </div>
              )}
            </div>
          </NeuTabPanel>

          <NeuTabPanel value="contact" unmountInactive className="space-y-6">
            <ContactTab />
          </NeuTabPanel>

          <NeuTabPanel value="resources" unmountInactive className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              <NeuCard className="flex flex-col p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-[#27aab8]" />
                    <div>
                      <h3 className="font-semibold text-[#333]">
                        User Manual
                      </h3>
                      <p className="text-sm text-[#888]">
                        Complete system documentation
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-auto">
                  <NeuButton className="w-full">
                    Download PDF
                  </NeuButton>
                </div>
              </NeuCard>

              <NeuCard className="flex flex-col p-5">
                <div className="mb-5 flex items-center gap-3">
                    <BarChart3 className="h-8 w-8 text-[#27aab8]" />
                    <div>
                      <h3 className="font-semibold text-[#333]">
                        Video Tutorials
                      </h3>
                      <p className="text-sm text-[#888]">
                        Step-by-step video guides
                      </p>
                    </div>
                </div>
                <div className="mt-auto">
                  <NeuButton className="w-full">
                    Watch Videos
                  </NeuButton>
                </div>
              </NeuCard>

              <NeuCard className="flex flex-col p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex items-center gap-3">
                    <Settings className="h-8 w-8 text-[#27aab8]" />
                    <div>
                      <h3 className="font-semibold text-[#333]">
                        System Status
                      </h3>
                      <p className="text-sm text-[#888]">
                        Check service availability
                      </p>
                    </div>
                  </div>
                </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#347d69]" />
                    <span className="text-sm font-medium text-[#347d69]">
                      All Systems Operational
                    </span>
                  </div>
              </NeuCard>
            </div>

            <NeuCard className="p-5 sm:p-6">
              <div className="mb-5 border-b border-[#c9c9c9] pb-4">
                <h3 className="font-semibold text-[#333]">
                  Release Notes
                </h3>
                <p className="text-sm text-[#888]">
                  Latest updates and improvements
                </p>
              </div>
              <div className="space-y-5">
                <div className="border-l-4 border-[#27aab8] pl-4">
                  <h4 className="font-medium text-[#333]">
                    Version 2.1.0 - Latest
                  </h4>
                  <p className="mt-1 text-sm text-[#777]">
                    Enhanced document upload, improved fuel advance tracking,
                    and new help center
                  </p>
                  <p className="mt-2 text-xs text-[#888]">
                    Released: September 2025
                  </p>
                </div>

                <div className="border-l-4 border-[#bbb] pl-4">
                  <h4 className="font-medium text-[#333]">
                    Version 2.0.0
                  </h4>
                  <p className="mt-1 text-sm text-[#777]">
                    Major UI refresh, new authentication system, and expanded
                    broker management
                  </p>
                  <p className="mt-2 text-xs text-[#888]">
                    Released: August 2025
                  </p>
                </div>
              </div>
            </NeuCard>
          </NeuTabPanel>
        </NeuTabs>
      </div>
    </AppShell>
  );
}