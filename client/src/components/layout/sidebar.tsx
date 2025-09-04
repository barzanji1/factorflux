import { useLocation } from "wouter";
// Authentication system removed - direct access
import { cn } from "@/lib/utils";
import { 
  Truck, 
  LayoutDashboard, 
  FileText, 
  FolderOpen, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut,
  Shield,
  CreditCard,
  Fuel,
  Globe,
  Download,
  DollarSign,
  Clock,
  CheckSquare
} from "lucide-react";


const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Factoring", href: "/factoring", icon: DollarSign },
  { name: "Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Documents", href: "/documents", icon: FolderOpen },
  { name: "Follow Ups", href: "/follow-up", icon: Clock },
  { name: "Collections", href: "/collections", icon: DollarSign },
  { name: "Vault", href: "/vault", icon: Shield },
  { name: "Fuel Cards", href: "/fuel-cards-internal", icon: Fuel },
  { name: "Credit Checks", href: "/credit-checks", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Admin", href: "/admin", icon: Shield, role: "manager" },
];

export default function Sidebar() {
  const [location, setLocation] = useLocation();
  // Get updated user data from localStorage if available, otherwise use defaults
  const getUserData = () => {
    const savedUserData = localStorage.getItem('currentUser');
    if (savedUserData) {
      try {
        return JSON.parse(savedUserData);
      } catch (e) {
        // Fall back to defaults if parsing fails
      }
    }
    return {
      id: "1",
      firstName: "Admin",
      lastName: "User", 
      email: "admin@tpf.com",
      role: "admin",
      profileImageUrl: "/uploads/c20bf48700fe065a95d9858e806bf4ce",
      jobTitle: "System Administrator"
    };
  };
  
  const user = getUserData();

  return (
    <div className="w-64 bg-white dark:bg-gray-900 shadow-xl border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
            <Truck className="text-white text-lg" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">QuantumCore</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Trucking Pros Financial</p>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600">
            <img 
              src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=3B82F6&color=fff`} 
              alt="User Profile" 
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback to initials avatar if image fails to load
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=3B82F6&color=fff`;
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 dark:text-white truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
              {user?.role || "Employee"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
          // Hide admin tab for non-managers
          if (item.role === "manager" && user?.role !== "manager" && user?.role !== "admin") {
            return null;
          }
          
          const isActive = location === item.href;
          
          // Handle external links differently
          if ('external' in item && item.external) {
            return (
              <a
                key={item.name}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-all duration-200 group"
              >
                <item.icon className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
                <span className="font-medium">{item.name}</span>
              </a>
            );
          }
          
          return (
            <button
              key={item.name}
              onClick={() => setLocation(item.href)}
              className={cn(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all duration-200 group",
                isActive
                  ? "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/50 dark:to-blue-800/50 text-blue-700 dark:text-blue-300 font-medium shadow-sm border-l-4 border-blue-600"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors",
                isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 group-hover:text-gray-700"
              )} />
              <span className="font-medium">{item.name}</span>
            </button>
          );
        })}
        

      </nav>

      {/* Logout */}
      {/* Logout removed - no authentication required */}
    </div>
  );
}
