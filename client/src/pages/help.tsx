import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  HelpCircle, 
  Phone, 
  Mail, 
  MessageCircle, 
  FileText, 
  Users, 
  Truck, 
  DollarSign,
  Shield,
  Clock,
  Upload,
  Search,
  Settings,
  BarChart3,
  Calendar,
  CreditCard,
  Building,
  UserCheck,
  MapPin,
  Fuel,
  CheckSquare,
  AlertCircle,
  Monitor,
  Archive,
  TrendingUp,
  Package,
  Send,
  Key,
  Database,
  Link,
  Headphones,
  Lock,
  Terminal,
  Server,
  ClipboardCheck,
  Briefcase,
  UserPlus,
  Star,
  MessageSquare,
  Globe,
  Clipboard,
  Calculator,
  LayoutDashboard
} from "lucide-react";
import { useState } from "react";
import TopNav from "@/components/layout/top-nav";

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [featureSearchQuery, setFeatureSearchQuery] = useState("");

  const quickStartGuides = [
    {
      title: "Getting Started",
      description: "Learn the basics of QuantumCore",
      icon: HelpCircle,
      steps: [
        "Log in with your credentials",
        "Explore the dashboard overview",
        "Navigate through different modules",
        "Set up your user preferences"
      ]
    },
    {
      title: "Client Management",
      description: "Manage your trucking clients",
      icon: Users,
      steps: [
        "Add new clients from the Clients tab",
        "Upload client documents and contracts",
        "Track client payment history",
        "Monitor client performance metrics"
      ]
    },
    {
      title: "Invoice Processing",
      description: "Process freight invoices efficiently",
      icon: FileText,
      steps: [
        "Upload rate confirmations and BOLs",
        "Review and verify invoice details",
        "Submit for factoring approval",
        "Track payment status and aging"
      ]
    },
    {
      title: "Document Upload",
      description: "Upload and manage documents",
      icon: Upload,
      steps: [
        "Navigate to Documents section",
        "Drag and drop files or click to browse",
        "Supported formats: PDF, JPG, PNG",
        "Documents are automatically categorized"
      ]
    }
  ];

  const faqItems = [
    {
      question: "How do I upload documents?",
      answer: "Navigate to the Documents tab, then drag and drop files into the upload zone or click 'Choose Files'. Supported formats include PDF, JPG, and PNG files up to 10MB each."
    },
    {
      question: "What is the Vault feature?",
      answer: "The Vault is a secure storage area for confidential client information such as tax IDs, bank details, and sensitive documents. Access is restricted and all actions are logged."
    },
    {
      question: "How do I track time?",
      answer: "Use the time clock feature in the top navigation. Click the clock icon to clock in/out. Your time entries are automatically tracked and visible in your dashboard."
    },
    {
      question: "What are fuel advances?",
      answer: "Fuel advances allow you to track fuel card applications and carrier fuel advance requests. Use the Fuel Advance tab to manage applications and track status."
    },
    {
      question: "How do I access reports?",
      answer: "Navigate to the Reports tab to view analytics, generate custom reports, and access integrated forms from Trucking Pros Financial."
    },
    {
      question: "What is the Collections module?",
      answer: "The Collections module helps track overdue invoices, client payment history, and manage collection activities. It provides tools for monitoring client performance and payment trends."
    }
  ];

  // System features and functions
  const systemFeatures = [
    // Core Dashboard & Analytics
    { name: "Dashboard", route: "/", icon: LayoutDashboard, category: "Core", status: "active", description: "Main overview with today's totals and key metrics" },
    { name: "Agent Report", route: "/reports", icon: BarChart3, category: "Reports", status: "active", description: "Performance analytics for agents" },
    { name: "Aging Report", route: "/reports", icon: TrendingUp, category: "Reports", status: "active", description: "Invoice aging and payment tracking" },
    { name: "Broker Report", route: "/reports", icon: Building, category: "Reports", status: "active", description: "Broker performance and metrics" },
    
    // Financial Operations
    { name: "Factoring", route: "/factoring", icon: DollarSign, category: "Financial", status: "active", description: "Invoice factoring and payment processing" },
    { name: "Bank Transfers", route: "/factoring", icon: CreditCard, category: "Financial", status: "active", description: "ACH and Wire transfer management" },
    { name: "Payments", route: "/factoring", icon: DollarSign, category: "Financial", status: "active", description: "Payment processing and tracking" },
    { name: "Payments Portal", route: "/factoring", icon: Globe, category: "Financial", status: "active", description: "Client payment portal access" },
    { name: "Expenses", route: "/factoring", icon: Calculator, category: "Financial", status: "planned", description: "Expense tracking and management" },
    
    // Client & Carrier Management  
    { name: "Clients", route: "/clients", icon: Users, category: "Management", status: "active", description: "Client database and management" },
    { name: "Carriers", route: "/clients", icon: Truck, category: "Management", status: "active", description: "Carrier information and setup" },
    { name: "Brokers", route: "/brokers", icon: Building, category: "Management", status: "active", description: "Freight broker management" },
    { name: "Dispatchers", route: "/clients", icon: UserCheck, category: "Management", status: "planned", description: "Dispatcher contact management" },
    
    // Document & Invoice Processing
    { name: "Invoices", route: "/invoices", icon: FileText, category: "Documents", status: "active", description: "Invoice processing and tracking" },
    { name: "Documents", route: "/documents", icon: Upload, category: "Documents", status: "active", description: "Document upload and management" },
    { name: "Bulk Invoices", route: "/invoices", icon: Package, category: "Documents", status: "planned", description: "Batch invoice processing" },
    { name: "Carrier POD's", route: "/documents", icon: ClipboardCheck, category: "Documents", status: "active", description: "Proof of delivery documents" },
    
    // Task & Activity Management
    { name: "Tasks", route: "/tasks", icon: CheckSquare, category: "Operations", status: "active", description: "Task assignment and tracking" },
    { name: "My Tasks", route: "/tasks", icon: Clipboard, category: "Operations", status: "active", description: "Personal task management" },
    { name: "To Do", route: "/tasks", icon: ClipboardCheck, category: "Operations", status: "active", description: "Task list and reminders" },
    { name: "Followups", route: "/collections", icon: Phone, category: "Operations", status: "active", description: "Client follow-up management" },
    { name: "Calendar", route: "/tasks", icon: Calendar, category: "Operations", status: "planned", description: "Schedule and appointment management" },
    
    // Communication & Messaging
    { name: "Live Chat", route: "/help", icon: Headphones, category: "Communication", status: "active", description: "Real-time customer support" },
    { name: "Send Email", route: "/clients", icon: Mail, category: "Communication", status: "planned", description: "Email communication tools" },
    { name: "Send SMS", route: "/clients", icon: MessageSquare, category: "Communication", status: "planned", description: "SMS messaging system" },
    { name: "Bulk SMS", route: "/clients", icon: Send, category: "Communication", status: "planned", description: "Mass SMS campaigns" },
    
    // Security & Access Control
    { name: "Vault", route: "/vault", icon: Shield, category: "Security", status: "active", description: "Secure document and data storage" },
    { name: "MC Check", route: "/credit-checks", icon: AlertCircle, category: "Security", status: "active", description: "Motor carrier authority verification" },
    { name: "C / B Reviews", route: "/collections", icon: Star, category: "Security", status: "active", description: "Credit and background reviews" },
    { name: "Reviews", route: "/collections", icon: Star, category: "Security", status: "active", description: "Client and carrier reviews" },
    
    // Fuel & Transportation
    { name: "Fuel Advance", route: "/fuel-cards-internal", icon: Fuel, category: "Transportation", status: "active", description: "Fuel advance processing" },
    { name: "Trucks", route: "/clients", icon: Truck, category: "Transportation", status: "planned", description: "Fleet and truck management" },
    
    // System Administration
    { name: "Admin", route: "/admin", icon: Shield, category: "Admin", status: "active", description: "System administration panel" },
    { name: "Settings", route: "/settings", icon: Settings, category: "Admin", status: "active", description: "System configuration" },
    { name: "My Profile", route: "/profile", icon: Users, category: "Admin", status: "active", description: "User profile management" },
    { name: "Logs", route: "/activities", icon: Terminal, category: "Admin", status: "active", description: "System activity logs" },
    { name: "Mail Server", route: "/settings", icon: Server, category: "Admin", status: "planned", description: "Email server configuration" },
    
    // Time & Payroll Management
    { name: "My Clocking", route: "/", icon: Clock, category: "Time", status: "active", description: "Personal time tracking" },
    { name: "Time Cards", route: "/admin", icon: Clock, category: "Time", status: "planned", description: "Employee time card management" },
    { name: "My Schedule", route: "/tasks", icon: Calendar, category: "Time", status: "planned", description: "Personal scheduling" },
    { name: "Payroll", route: "/admin", icon: Calculator, category: "Time", status: "planned", description: "Payroll processing and management" },
    
    // Reporting & Analytics
    { name: "Reports", route: "/reports", icon: BarChart3, category: "Reports", status: "active", description: "Comprehensive reporting suite" },
    { name: "Sheets", route: "/reports", icon: Database, category: "Reports", status: "planned", description: "Data export and spreadsheet tools" },
    
    // Support & Integration
    { name: "Tickets", route: "/help", icon: AlertCircle, category: "Support", status: "active", description: "Support ticket system" },
    { name: "Software Request", route: "/help", icon: Package, category: "Support", status: "planned", description: "Software enhancement requests" },
    { name: "Linked", route: "/settings", icon: Link, category: "Integration", status: "planned", description: "Third-party integrations" },
    { name: "Lockbox", route: "/vault", icon: Lock, category: "Integration", status: "planned", description: "Secure payment lockbox" },
    
    // Branch & Location Management
    { name: "Branches", route: "/admin", icon: MapPin, category: "Locations", status: "planned", description: "Multi-location management" },
    { name: "Factoring Co", route: "/factoring", icon: Building, category: "Locations", status: "planned", description: "Factoring company management" },
    
    // Workflow Management
    { name: "Pres", route: "/reports", icon: Monitor, category: "Workflow", status: "planned", description: "Presentation and reporting tools" }
  ];

  const categories = ["All", "Core", "Financial", "Management", "Documents", "Operations", "Communication", "Security", "Transportation", "Admin", "Time", "Reports", "Support", "Integration", "Locations", "Workflow"];
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filteredFeatures = systemFeatures.filter(feature => {
    const matchesSearch = feature.name.toLowerCase().includes(featureSearchQuery.toLowerCase()) ||
                         feature.description.toLowerCase().includes(featureSearchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || feature.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const contactOptions = [
    {
      title: "Technical Support",
      description: "Get help with system issues",
      icon: Settings,
      contact: "Dosh Barzanji",
      email: "Dosh@truckingprosfinancial.com",
      phone: "385-495-4962",
      hours: "Internal use only"
    },
    {
      title: "Account Management",
      description: "Questions about your account",
      icon: Users,
      contact: "accounts@truckingprosfinancial.com",
      hours: "Monday - Friday, 8 AM - 5 PM EST"
    },
    {
      title: "Emergency Support",
      description: "Urgent operational issues",
      icon: Phone,
      contact: "(555) 123-4567",
      hours: "24/7 Emergency Line"
    }
  ];

  const filteredFAQ = faqItems.filter(item =>
    item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <TopNav title="Help Center" />
      
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <HelpCircle className="text-white text-xl" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Help Center</h1>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Find answers, get support, and learn how to make the most of QuantumCore
          </p>
        </div>

        <Tabs defaultValue="guides" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="guides">Quick Start</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>

          {/* Quick Start Guides */}
          <TabsContent value="guides" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {quickStartGuides.map((guide, index) => (
                <Card key={index} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                        <guide.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{guide.title}</CardTitle>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{guide.description}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2">
                      {guide.steps.map((step, stepIndex) => (
                        <li key={stepIndex} className="flex items-start space-x-3">
                          <Badge variant="outline" className="text-xs px-2 py-1 mt-0.5">
                            {stepIndex + 1}
                          </Badge>
                          <span className="text-sm text-gray-700 dark:text-gray-300">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Features Directory */}
          <TabsContent value="features" className="space-y-6">
            <div className="space-y-6">
              {/* Dashboard Header with Today's Total */}
              <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-bold">Today's Total</h3>
                      <p className="text-3xl font-bold mt-2">$124,656.28</p>
                      <p className="text-blue-100 mt-1">MenuID 60600 • Dosh Barzanji</p>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="text-blue-100">
                        <div>ACH Cut-off Time: <span className="font-bold">2:15 PM MST</span></div>
                        <div>WIRE Cut-off Time: <span className="font-bold">1:15 PM MST</span></div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Search and Filter */}
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search system features and functions..."
                    value={featureSearchQuery}
                    onChange={(e) => setFeatureSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* Category Filter */}
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Button
                      key={category}
                      variant={selectedCategory === category ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedCategory(category)}
                      className="text-xs"
                    >
                      {category}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredFeatures.map((feature, index) => (
                  <Card 
                    key={index} 
                    className={`hover:shadow-lg transition-all cursor-pointer border-l-4 ${
                      feature.status === 'active' 
                        ? 'border-l-green-500 hover:border-l-green-600 bg-white dark:bg-gray-800' 
                        : 'border-l-yellow-500 hover:border-l-yellow-600 bg-gray-50 dark:bg-gray-800/50'
                    }`}
                    onClick={() => {
                      // Navigate to the feature route
                      window.location.href = feature.route;
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start space-x-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          feature.status === 'active' 
                            ? 'bg-green-100 dark:bg-green-900' 
                            : 'bg-yellow-100 dark:bg-yellow-900'
                        }`}>
                          <feature.icon className={`w-4 h-4 ${
                            feature.status === 'active' 
                              ? 'text-green-600 dark:text-green-400' 
                              : 'text-yellow-600 dark:text-yellow-400'
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                              {feature.name}
                            </h4>
                            <Badge 
                              variant={feature.status === 'active' ? 'default' : 'outline'}
                              className={`text-xs px-2 py-0.5 ml-1 ${
                                feature.status === 'active' 
                                  ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700' 
                                  : 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700'
                              }`}
                            >
                              {feature.status === 'active' ? 'Active' : 'Planned'}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                            {feature.description}
                          </p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                              {feature.category}
                            </span>
                            <span className="text-xs text-gray-500">
                              {feature.route}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* No Results */}
              {filteredFeatures.length === 0 && (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No features found</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Try adjusting your search terms or category filter.
                  </p>
                </div>
              )}

              {/* Feature Status Legend */}
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-3">Feature Status</h4>
                  <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Active - Available now
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Planned - In development
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* FAQ Section */}
          <TabsContent value="faq" className="space-y-6">
            <div className="max-w-4xl mx-auto">
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search frequently asked questions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <Accordion type="single" collapsible className="space-y-2">
                {filteredFAQ.map((item, index) => (
                  <AccordionItem key={index} value={`item-${index}`} className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <span className="text-left font-medium">{item.question}</span>
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600 dark:text-gray-400 pb-4">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              {filteredFAQ.length === 0 && searchQuery && (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">
                    No results found for "{searchQuery}". Try different keywords or contact support.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Contact Support */}
          <TabsContent value="contact" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {contactOptions.map((option, index) => (
                <Card key={index} className="text-center hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center mx-auto mb-4">
                      <option.icon className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <CardTitle className="text-lg">{option.title}</CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{option.description}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="font-medium text-blue-600 dark:text-blue-400">{option.contact}</p>
                      {option.email && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Email: <span className="font-medium">{option.email}</span>
                        </p>
                      )}
                      {option.phone && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Text: <span className="font-medium">{option.phone}</span>
                        </p>
                      )}
                      <p className="text-sm text-gray-500 dark:text-gray-400">{option.hours}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <MessageCircle className="w-5 h-5" />
                  <span>Send us a message</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input placeholder="Your Name" />
                  <Input placeholder="Your Email" />
                </div>
                <Input placeholder="Subject" />
                <Textarea placeholder="Describe your issue or question..." rows={4} />
                <Button className="w-full">Send Message</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Resources */}
          <TabsContent value="resources" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <FileText className="w-8 h-8 text-blue-600" />
                    <div>
                      <CardTitle>User Manual</CardTitle>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Complete system documentation</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Download PDF</Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <BarChart3 className="w-8 h-8 text-green-600" />
                    <div>
                      <CardTitle>Video Tutorials</CardTitle>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Step-by-step video guides</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Watch Videos</Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <Settings className="w-8 h-8 text-purple-600" />
                    <div>
                      <CardTitle>System Status</CardTitle>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Check service availability</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-sm text-green-600 font-medium">All Systems Operational</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Release Notes</CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">Latest updates and improvements</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Version 2.1.0 - Latest</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Enhanced document upload, improved fuel advance tracking, and new help center
                    </p>
                    <p className="text-xs text-gray-500 mt-2">Released: September 2025</p>
                  </div>
                  <div className="border-l-4 border-gray-300 pl-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Version 2.0.0</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Major UI refresh, new authentication system, and expanded broker management
                    </p>
                    <p className="text-xs text-gray-500 mt-2">Released: August 2025</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}