import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { User, Client, Invoice, Load } from "@shared/schema";
import { 
  Bell, 
  Plus, 
  Search, 
  ChevronDown, 
  User as UserIcon, 
  Settings, 
  LogOut,
  FileText,
  Users,
  FolderOpen,
  Home
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface TopNavProps {
  title: string;
  subtitle?: string;
}

interface SearchResults {
  clients?: Client[];
  invoices?: Invoice[];
  loads?: Load[];
}

export default function TopNav({ title, subtitle }: TopNavProps) {
  const { user } = useAuth() as { user: User | undefined };
  const [location, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  // Mock notifications - in real app would come from API
  const notifications = [
    { id: 1, message: "New invoice submitted for approval", time: "2 min ago", unread: true },
    { id: 2, message: "Document processed successfully", time: "1 hour ago", unread: true },
    { id: 3, message: "Payment received for Invoice #12345", time: "3 hours ago", unread: false },
  ];
  
  const unreadCount = notifications.filter(n => n.unread).length;

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  // Search functionality
  const { data: searchResults } = useQuery<SearchResults>({
    queryKey: [`/api/search?q=${encodeURIComponent(searchQuery)}`],
    enabled: searchQuery.length > 2,
  });

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Show search results when there's a query
  useEffect(() => {
    setShowSearchResults(searchQuery.length > 2 && !!searchResults);
  }, [searchQuery, searchResults]);

  const handleSearchItemClick = (type: string, id: number) => {
    setSearchQuery("");
    setShowSearchResults(false);
    
    switch (type) {
      case 'client':
        setLocation(`/clients`);
        break;
      case 'invoice':
        setLocation(`/invoices`);
        break;
      case 'load':
        setLocation(`/loads`);
        break;
      default:
        break;
    }
  };

  const quickActions = [
    { label: "New Invoice", icon: FileText, action: () => setLocation("/invoices") },
    { label: "Add Client", icon: Users, action: () => setLocation("/clients") },
    { label: "Upload Document", icon: FolderOpen, action: () => setLocation("/documents") },
  ];

  // Define pages where Home button should appear (NOT on Dashboard)
  const pagesWithHomeButton = [
    "/clients", 
    "/invoices", 
    "/documents", 
    "/fuel-cards", 
    "/credit-checks", 
    "/reports", 
    "/fuel-card-admin", 
    "/admin",
    "/activities"
  ];
  
  const showHomeButton = pagesWithHomeButton.some(page => location.startsWith(page));

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left side - Title and search */}
        <div className="flex items-center space-x-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
            )}
          </div>
          
          {/* Search bar */}
          <div className="relative hidden md:block" ref={searchRef}>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search loads, invoices, clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length > 2 && setShowSearchResults(true)}
              className="pl-10 pr-4 py-2 w-80 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500"
            />
            
            {/* Search Results Dropdown */}
            {showSearchResults && searchResults && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                {searchResults?.clients && searchResults.clients.length > 0 && (
                  <div className="p-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Clients</h4>
                    {searchResults.clients.slice(0, 3).map((client: Client) => (
                      <div
                        key={`client-${client.id}`}
                        onClick={() => handleSearchItemClick('client', client.id)}
                        className="flex items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                      >
                        <Users className="w-4 h-4 text-blue-500 mr-3" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{client.name}</div>
                          <div className="text-sm text-gray-500">{client.contactPerson}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {searchResults?.invoices && searchResults.invoices.length > 0 && (
                  <div className="p-2 border-t border-gray-100 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Invoices</h4>
                    {searchResults.invoices.slice(0, 3).map((invoice: Invoice) => (
                      <div
                        key={`invoice-${invoice.id}`}
                        onClick={() => handleSearchItemClick('invoice', invoice.id)}
                        className="flex items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-green-500 mr-3" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Invoice #{invoice.invoiceNumber}</div>
                          <div className="text-sm text-gray-500">Load #{invoice.loadId} • ${invoice.amount}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {searchResults?.loads && searchResults.loads.length > 0 && (
                  <div className="p-2 border-t border-gray-100 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Loads</h4>
                    {searchResults.loads.slice(0, 3).map((load: Load) => (
                      <div
                        key={`load-${load.id}`}
                        onClick={() => handleSearchItemClick('load', load.id)}
                        className="flex items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4 text-orange-500 mr-3" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Load #{load.id}</div>
                          <div className="text-sm text-gray-500">{load.pickupLocation} → {load.deliveryLocation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {(!searchResults?.clients?.length && !searchResults?.invoices?.length && !searchResults?.loads?.length) && (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                    No results found for "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right side - Actions and user menu */}
        <div className="flex items-center space-x-4">
          {/* Home Button - Only show on specific pages, NOT on Dashboard */}
          {showHomeButton && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setLocation("/")}
              className="flex items-center space-x-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-blue-200 dark:border-blue-800"
            >
              <Home className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-blue-600 dark:text-blue-400 font-medium">Home</span>
            </Button>
          )}

          {/* Quick Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg">
                <Plus className="w-4 h-4 mr-2" />
                New
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {quickActions.map((action) => (
                <DropdownMenuItem 
                  key={action.label}
                  onClick={action.action}
                  className="cursor-pointer"
                >
                  <action.icon className="w-4 h-4 mr-2" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 w-5 h-5 text-xs flex items-center justify-center p-0"
                  >
                    {unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
              </div>
              {notifications.map((notification) => (
                <DropdownMenuItem key={notification.id} className="p-3 cursor-pointer">
                  <div className="flex items-start space-x-3 w-full">
                    <div className={cn(
                      "w-2 h-2 rounded-full mt-2",
                      notification.unread ? "bg-blue-600" : "bg-gray-300"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white">{notification.message}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{notification.time}</p>
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Profile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center space-x-2 h-10">
                <img 
                  src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=3B82F6&color=fff`} 
                  alt="User Profile" 
                  className="w-8 h-8 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600"
                />
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {user?.role || "Employee"}
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem 
                onClick={() => {
                  setTimeout(() => {
                    setLocation('/profile');
                    window.location.reload();
                  }, 100);
                }} 
                className="cursor-pointer"
              >
                <UserIcon className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => {
                  setTimeout(() => {
                    setLocation('/settings');
                    window.location.reload();
                  }, 100);
                }} 
                className="cursor-pointer"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleLogout}
                className="cursor-pointer text-red-600 dark:text-red-400"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}