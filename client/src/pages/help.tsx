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
  BarChart3
} from "lucide-react";
import { useState } from "react";
import TopNav from "@/components/layout/top-nav";

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");

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

  const contactOptions = [
    {
      title: "Technical Support",
      description: "Get help with system issues",
      icon: Settings,
      contact: "support@truckingprosfinancial.com",
      hours: "Monday - Friday, 8 AM - 6 PM EST"
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="guides">Quick Start</TabsTrigger>
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
                    <p className="font-medium text-blue-600 dark:text-blue-400 mb-2">{option.contact}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{option.hours}</p>
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