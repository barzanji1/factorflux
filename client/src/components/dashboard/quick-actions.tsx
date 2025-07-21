import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, UserPlus, TrendingUp, Settings } from "lucide-react";
import { useLocation } from "wouter";

export default function QuickActions() {
  const [, setLocation] = useLocation();

  const actions = [
    {
      title: "New Invoice",
      description: "Create a new invoice",
      icon: Plus,
      color: "text-blue-600",
      bgColor: "bg-blue-100 dark:bg-blue-900/20",
      onClick: () => setLocation("/invoices"),
    },
    {
      title: "Add Client",
      description: "Add a new client",
      icon: UserPlus,
      color: "text-green-600",
      bgColor: "bg-green-100 dark:bg-green-900/20",
      onClick: () => setLocation("/clients"),
    },
    {
      title: "View Reports",
      description: "Access reporting dashboard",
      icon: TrendingUp,
      color: "text-orange-600",
      bgColor: "bg-orange-100 dark:bg-orange-900/20",
      onClick: () => setLocation("/reports"),
    },
    {
      title: "Upload Documents",
      description: "Upload freight documents",
      icon: Settings,
      color: "text-purple-600",
      bgColor: "bg-purple-100 dark:bg-purple-900/20",
      onClick: () => setLocation("/documents"),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.map((action, index) => (
            <Button
              key={index}
              variant="ghost"
              className="w-full flex items-center justify-between p-3 h-auto hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              onClick={action.onClick}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 ${action.bgColor} rounded-lg flex items-center justify-center`}>
                  <action.icon className={`w-5 h-5 ${action.color}`} />
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-900 dark:text-white">{action.title}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{action.description}</div>
                </div>
              </div>
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
