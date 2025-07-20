import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, UserPlus, TrendingUp, Settings } from "lucide-react";

export default function QuickActions() {
  const actions = [
    {
      title: "New Invoice",
      description: "Create a new invoice",
      icon: Plus,
      color: "text-primary",
      bgColor: "bg-primary bg-opacity-10",
      onClick: () => console.log("Create new invoice"),
    },
    {
      title: "Add Client",
      description: "Add a new client",
      icon: UserPlus,
      color: "text-success",
      bgColor: "bg-success bg-opacity-10",
      onClick: () => console.log("Add new client"),
    },
    {
      title: "View Reports",
      description: "Access reporting dashboard",
      icon: TrendingUp,
      color: "text-warning",
      bgColor: "bg-warning bg-opacity-10",
      onClick: () => console.log("View reports"),
    },
    {
      title: "Manage Users",
      description: "User management",
      icon: Settings,
      color: "text-secondary",
      bgColor: "bg-secondary bg-opacity-10",
      onClick: () => console.log("Manage users"),
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
              className="w-full flex items-center justify-between p-3 h-auto hover:bg-gray-50"
              onClick={action.onClick}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 ${action.bgColor} rounded flex items-center justify-center`}>
                  <action.icon className={`w-4 h-4 ${action.color}`} />
                </div>
                <span className="font-medium text-secondary">{action.title}</span>
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
