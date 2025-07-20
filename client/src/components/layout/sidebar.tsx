import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { 
  Truck, 
  LayoutDashboard, 
  FileText, 
  FolderOpen, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut 
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Documents", href: "/documents", icon: FolderOpen },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Reports", href: "/reports", icon: BarChart3 },
];

export default function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="w-64 bg-surface shadow-lg border-r border-gray-200 flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <Truck className="text-white text-lg" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-secondary">FreightFlow</h1>
            <p className="text-sm text-gray-500">Invoice Processing</p>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <img 
            src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=1565C0&color=fff`} 
            alt="User Profile" 
            className="w-10 h-10 rounded-full object-cover"
          />
          <div>
            <p className="font-medium text-secondary">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-sm text-gray-500 capitalize">
              {user?.role || "Employee"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <button
              key={item.name}
              onClick={() => setLocation(item.href)}
              className={cn(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-colors",
                isActive
                  ? "bg-blue-50 text-primary font-medium border-r-3 border-primary"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Settings & Logout */}
      <div className="p-4 border-t border-gray-200 space-y-2">
        <button className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>
        <button 
          onClick={handleLogout}
          className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}
