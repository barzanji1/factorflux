import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, CheckCircle, DollarSign, Users } from "lucide-react";

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const statItems = [
    {
      title: "Pending Invoices",
      value: stats?.pendingInvoices || 0,
      change: "+12% from last month",
      icon: Clock,
      color: "text-warning",
      bgColor: "bg-warning bg-opacity-10",
    },
    {
      title: "Processed Today",
      value: stats?.processedToday || 0,
      change: "+8% from yesterday",
      icon: CheckCircle,
      color: "text-success",
      bgColor: "bg-success bg-opacity-10",
    },
    {
      title: "Total Revenue",
      value: `$${parseFloat(stats?.totalRevenue || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: "+15% from last month",
      icon: DollarSign,
      color: "text-primary",
      bgColor: "bg-primary bg-opacity-10",
    },
    {
      title: "Active Clients",
      value: stats?.activeClients || 0,
      change: "+3 new this week",
      icon: Users,
      color: "text-secondary",
      bgColor: "bg-secondary bg-opacity-10",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {statItems.map((item, index) => (
        <Card key={index}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{item.title}</p>
                <p className="text-3xl font-bold text-secondary mt-1">{item.value}</p>
                <p className="text-success text-sm mt-2">{item.change}</p>
              </div>
              <div className={`w-12 h-12 ${item.bgColor} rounded-lg flex items-center justify-center`}>
                <item.icon className={`${item.color} text-lg`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
