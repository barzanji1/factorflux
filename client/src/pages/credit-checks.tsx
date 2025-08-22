import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CreditCard, 
  Search, 
  Filter, 
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle
} from "lucide-react";

export default function CreditChecks() {
  const { toast } = useToast();

  // Mock data for credit checks
  const creditChecks = [
    {
      id: 1,
      company: "ABC Trucking LLC",
      score: 750,
      rating: "Excellent",
      status: "approved",
      lastCheck: "2024-01-15",
      creditLimit: "$50,000"
    },
    {
      id: 2,
      company: "Highway Express Co",
      score: 680,
      rating: "Good",
      status: "approved",
      lastCheck: "2024-01-10",
      creditLimit: "$35,000"
    },
    {
      id: 3,
      company: "Fast Freight Solutions",
      score: 620,
      rating: "Fair",
      status: "pending",
      lastCheck: "2024-01-08",
      creditLimit: "$25,000"
    },
    {
      id: 4,
      company: "Metro Logistics Inc",
      score: 580,
      rating: "Poor",
      status: "rejected",
      lastCheck: "2024-01-05",
      creditLimit: "N/A"
    }
  ];

  const getScoreColor = (score: number) => {
    if (score >= 700) return "text-green-600 dark:text-green-400";
    if (score >= 650) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Approved</Badge>;
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">Pending</Badge>;
      case "rejected":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Rejected</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Credit Checks" 
          subtitle="Monitor and manage client credit assessments"
        />
        
        <main className="flex-1 overflow-auto p-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Checks</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">142</p>
                  </div>
                  <CreditCard className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p>
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">89</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending</p>
                    <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">28</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-yellow-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Rejected</p>
                    <p className="text-3xl font-bold text-red-600 dark:text-red-400">25</p>
                  </div>
                  <TrendingDown className="w-8 h-8 text-red-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Credit Checks Table */}
          <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">Credit Check Results</CardTitle>
                <div className="flex items-center space-x-4">
                  <Button variant="outline" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    Filter
                  </Button>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    New Check
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Company</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Credit Score</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Rating</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Status</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Credit Limit</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Last Check</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-white">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditChecks.map((check) => (
                      <tr key={check.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="py-4 px-4 text-gray-900 dark:text-white font-medium">{check.company}</td>
                        <td className={`py-4 px-4 font-bold ${getScoreColor(check.score)}`}>{check.score}</td>
                        <td className="py-4 px-4 text-gray-600 dark:text-gray-400">{check.rating}</td>
                        <td className="py-4 px-4">{getStatusBadge(check.status)}</td>
                        <td className="py-4 px-4 text-gray-900 dark:text-white font-medium">{check.creditLimit}</td>
                        <td className="py-4 px-4 text-gray-600 dark:text-gray-400">{check.lastCheck}</td>
                        <td className="py-4 px-4">
                          <Button variant="outline" size="sm">View Details</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}