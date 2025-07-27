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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Users, Shield, UserCog, Mail, Copy } from "lucide-react";
import { User } from "@shared/schema";
import ContextualDownload from "@/components/contextual-download";

export default function Admin() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [emailForm, setEmailForm] = useState({
    email: '',
    clientName: '',
    message: ''
  });

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
    if (user && (user as any).role !== 'manager' && (user as any).role !== 'admin') {
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this page.",
        variant: "destructive",
      });
    }
  }, [user, toast]);

  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    enabled: !!user && ((user as any).role === 'manager' || (user as any).role === 'admin'),
  });

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = isUnauthorizedError(error) 
        ? "You don't have permission to update user roles"
        : "Failed to update user role";
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const sendInstallerLinks = useMutation({
    mutationFn: async (data: { email: string; clientName: string; message: string }) => {
      const response = await apiRequest("POST", "/api/email/installer-links", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.emailContent) {
        // Show email content in a modal or copy to clipboard
        const emailText = `To: ${data.emailContent.to}\nSubject: ${data.emailContent.subject}\n\n${data.emailContent.text}`;
        
        // Try to copy to clipboard
        if (navigator.clipboard) {
          navigator.clipboard.writeText(emailText).then(() => {
            toast({
              title: "Email Copied to Clipboard!",
              description: "Email content copied successfully. Paste it into your email client and send.",
            });
            console.log('Email content copied to clipboard:', emailText.substring(0, 200) + '...');
          }).catch((error) => {
            console.error('Clipboard failed:', error);
            showEmailContentDialog(emailText);
          });
        } else {
          console.log('Clipboard not available, showing email content');
          showEmailContentDialog(emailText);
        }
      } else {
        toast({
          title: "Email Sent",
          description: data.message,
        });
      }
      setEmailForm({ email: '', clientName: '', message: '' });
    },
    onError: (error: any) => {
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
        description: error.message || "Failed to send installer links",
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

  const showEmailContentDialog = (emailText: string) => {
    // Create a simple dialog to show email content
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; border: 2px solid #ccc; border-radius: 8px;
      padding: 20px; max-width: 80%; max-height: 80%; overflow: auto;
      z-index: 1000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    
    dialog.innerHTML = `
      <h3 style="margin-top: 0; color: #333;">Email Content Ready</h3>
      <p style="color: #666; margin-bottom: 15px;">Copy this content and paste it into your email client:</p>
      <textarea readonly style="width: 100%; height: 300px; font-family: monospace; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">${emailText}</textarea>
      <div style="margin-top: 15px; text-align: right;">
        <button onclick="this.parentElement.parentElement.remove()" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Select all text in textarea
    const textarea = dialog.querySelector('textarea');
    if (textarea) {
      textarea.select();
      textarea.focus();
    }
  };

  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailForm.email) {
      toast({
        title: "Error",
        description: "Email address is required",
        variant: "destructive",
      });
      return;
    }
    sendInstallerLinks.mutate(emailForm);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!user || ((user as any).role !== 'manager' && (user as any).role !== 'admin')) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <TopNav title="Admin Panel" subtitle="Access Denied" />
          <main className="flex-1 p-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
              <p className="text-gray-600 mt-2">You don't have permission to access this page.</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

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

  if (!user || ((user as any).role !== 'manager' && (user as any).role !== 'admin')) {
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

            {/* Email Installer Links Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Mail className="w-5 h-5 mr-2" />
                  Send QuantumCore Access
                </CardTitle>
                <CardDescription>
                  Email QuantumCore access links and desktop installers to clients
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSendEmail} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Client Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="client@company.com"
                        value={emailForm.email}
                        onChange={(e) => setEmailForm(prev => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="clientName">Client Name (Optional)</Label>
                      <Input
                        id="clientName"
                        placeholder="John Smith"
                        value={emailForm.clientName}
                        onChange={(e) => setEmailForm(prev => ({ ...prev, clientName: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Additional Message (Optional)</Label>
                    <Textarea
                      id="message"
                      placeholder="Add any additional instructions or information for the client..."
                      value={emailForm.message}
                      onChange={(e) => setEmailForm(prev => ({ ...prev, message: e.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Email content will be prepared and copied to clipboard for manual sending
                    </div>
                    <Button 
                      type="submit" 
                      disabled={sendInstallerLinks.isPending}
                      className="flex items-center space-x-2"
                    >
                      {sendInstallerLinks.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Sending...</span>
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4" />
                          <span>Prepare Email</span>
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>Note:</strong> Email content will be prepared and copied to your clipboard. 
                      You can then paste and send it through your preferred email client.
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Contextual Download Section */}
            <div className="mb-6">
              <ContextualDownload showAllOptions={false} />
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