import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Shield, UserCog } from "lucide-react";
import { User } from "@shared/schema";

export default function Admin() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  // Check if user is manager
  useEffect(() => {
    if (user && (user as any).role !== 'manager') {
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this page.",
        variant: "destructive",
      });
    }
  }, [user, toast]);

  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    enabled: !!user && (user as any).role === 'manager',
  });

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Role Updated",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update user role",
        variant: "destructive",
      });
    },
  });

  const handleRoleChange = (userId: string, newRole: string) => {
    setSelectedRoles(prev => ({ ...prev, [userId]: newRole }));
  };

  const handleUpdateRole = (userId: string) => {
    const newRole = selectedRoles[userId];
    if (!newRole) return;

    updateUserRole.mutate({ userId, role: newRole });
  };

  if (isLoading || isLoadingUsers) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav title="Admin Panel" subtitle="Loading..." />
          <main className="flex-1 overflow-auto p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
              <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!user || (user as any).role !== 'manager') {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav title="Admin Panel" subtitle="Access Denied" />
          <main className="flex-1 overflow-auto p-6">
            <Card className="max-w-md mx-auto">
              <CardHeader className="text-center">
                <Shield className="w-12 h-12 mx-auto text-red-500 mb-4" />
                <CardTitle className="text-red-600">Access Denied</CardTitle>
                <CardDescription>
                  You don't have permission to access the admin panel. Manager role required.
                </CardDescription>
              </CardHeader>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Admin Panel" 
          subtitle="Manage user roles and permissions"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  Manage user roles and permissions
                </p>
              </div>
              <div className="flex items-center space-x-2 text-blue-600">
                <UserCog className="w-5 h-5" />
                <span className="font-medium">Manager Dashboard</span>
              </div>
            </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="w-5 h-5 mr-2" />
            User Management
          </CardTitle>
          <CardDescription>
            View and manage user roles within the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Current Role</TableHead>
                <TableHead>Change Role</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users as User[])?.map((userData: User) => (
                <TableRow key={userData.id}>
                  <TableCell>
                    <div className="flex items-center space-x-3">
                      <img
                        src={userData.profileImageUrl || `https://ui-avatars.com/api/?name=${userData.firstName}+${userData.lastName}&background=3B82F6&color=fff`}
                        alt={`${userData.firstName} ${userData.lastName}`}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {userData.firstName} {userData.lastName}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {userData.jobTitle || "No job title"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {userData.email || "No email"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {userData.phone || "No phone"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {userData.department || "No department"}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={userData.role === 'manager' ? 'default' : 'secondary'}
                      className={userData.role === 'manager' ? 'bg-blue-100 text-blue-800' : ''}
                    >
                      {userData.role || 'employee'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {userData.id !== (user as any).id ? (
                      <Select
                        value={selectedRoles[userData.id] || userData.role || 'employee'}
                        onValueChange={(value) => handleRoleChange(userData.id, value)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        (Your account)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {userData.id !== (user as any).id && selectedRoles[userData.id] && selectedRoles[userData.id] !== userData.role ? (
                      <Button
                        size="sm"
                        onClick={() => handleUpdateRole(userData.id)}
                        disabled={updateUserRole.isPending}
                      >
                        {updateUserRole.isPending ? "Updating..." : "Update"}
                      </Button>
                    ) : userData.id === (user as any).id ? (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Cannot modify
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!users || (users as User[]).length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No users found
            </div>
          )}
            </CardContent>
          </Card>
          </div>
        </main>
      </div>
    </div>
  );
}