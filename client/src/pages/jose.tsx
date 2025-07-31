import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserIcon } from "lucide-react";

export default function Jose() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopNav title="Jose" subtitle="Personal dashboard and tools" />
      
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid gap-6">
            {/* Welcome Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <UserIcon className="w-5 h-5" />
                  <span>Welcome to Jose's Page</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  This is a dedicated space for Jose. You can customize this page with any content, 
                  tools, or information that would be useful.
                </p>
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Links</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <h3 className="font-medium">Dashboard</h3>
                    <p className="text-sm text-gray-500">Main dashboard</p>
                  </div>
                  <div className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <h3 className="font-medium">Clients</h3>
                    <p className="text-sm text-gray-500">Manage clients</p>
                  </div>
                  <div className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <h3 className="font-medium">Reports</h3>
                    <p className="text-sm text-gray-500">View reports</p>
                  </div>
                  <div className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <h3 className="font-medium">Settings</h3>
                    <p className="text-sm text-gray-500">Preferences</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Personal Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Personal Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100">Today's Tasks</h4>
                    <p className="text-blue-700 dark:text-blue-300 text-sm mt-1">
                      This section can be customized for daily tasks and reminders.
                    </p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <h4 className="font-medium text-green-900 dark:text-green-100">Important Notes</h4>
                    <p className="text-green-700 dark:text-green-300 text-sm mt-1">
                      Add any important information or reminders here.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}