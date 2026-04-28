import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Users, Shield, UserPlus, Pencil, Trash2, Ban, CheckCircle,
  Loader2, Mail,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";

// ---------- Types ----------
interface UserRecord {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role: string;
  status?: string;
  createdAt?: string;
  jobTitle?: string;
  department?: string;
  profileImageUrl?: string;
}

// ---------- Schemas ----------
const addAgentSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  email: z.string().email("Valid email required"),
  role: z.enum(["employee", "manager", "admin"]),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const editUserSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  email: z.string().email("Valid email required"),
  role: z.enum(["employee", "manager", "admin"]),
});

type AddAgentForm = z.infer<typeof addAgentSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;

// ---------- Helpers ----------
const ROLE_BADGE: Record<string, JSX.Element> = {
  admin: <Badge className="bg-purple-600 hover:bg-purple-700 text-white">Admin</Badge>,
  manager: <Badge className="bg-blue-600 hover:bg-blue-700 text-white">Manager</Badge>,
  employee: <Badge variant="outline">Employee</Badge>,
};

const STATUS_BADGE: Record<string, JSX.Element> = {
  active: <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300">Active</Badge>,
  suspended: <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300">Suspended</Badge>,
  inactive: <Badge variant="outline" className="text-slate-500">Inactive</Badge>,
};

// ---------- Component ----------
export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Current session user
  const { data: session } = useQuery<{ user: UserRecord }>({
    queryKey: ["/api/auth/verify"],
  });
  const currentUser = session?.user;

  // Guard: only admin
  if (currentUser && currentUser.role !== "admin") {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopNav title="Admin Panel" subtitle="Access Denied" />
          <main className="flex flex-1 items-center justify-center p-6">
            <Card className="max-w-md w-full text-center">
              <CardHeader>
                <Shield className="h-12 w-12 mx-auto text-red-500 mb-2" />
                <CardTitle className="text-red-600">Access Denied</CardTitle>
                <CardDescription>Admin role required to access this panel.</CardDescription>
              </CardHeader>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  // ----- State -----
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  // ----- Queries -----
  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ["/api/admin/users"],
    enabled: currentUser?.role === "admin",
  });

  // ----- Mutations -----
  const createMutation = useMutation({
    mutationFn: async (data: AddAgentForm) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create agent");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setAddOpen(false);
      toast({ title: "Agent created", description: "Welcome email sent with login credentials." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<UserRecord> }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditUser(null);
      toast({ title: "User updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteTarget(null);
      toast({ title: "User removed" });
    },
    onError: (e: Error) => {
      setDeleteTarget(null);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // ----- Forms -----
  const addForm = useForm<AddAgentForm>({
    resolver: zodResolver(addAgentSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "employee", password: "" },
  });

  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "employee" },
  });

  const openEdit = (u: UserRecord) => {
    setEditUser(u);
    editForm.reset({
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      email: u.email || "",
      role: (u.role as "employee" | "manager" | "admin") || "employee",
    });
  };

  const handleSuspend = (u: UserRecord) => {
    if (u.id === currentUser?.id) {
      toast({ title: "Not allowed", description: "You cannot suspend your own account.", variant: "destructive" });
      return;
    }
    const newStatus = u.status === "suspended" ? "active" : "suspended";
    updateMutation.mutate({ id: u.id, updates: { status: newStatus } });
  };

  const isSelf = (id: string) => id === currentUser?.id;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Admin Panel" subtitle="User and agent management" />
        <main className="custom-scrollbar flex-1 overflow-auto p-6">
          <div className="space-y-6 max-w-7xl mx-auto">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {users.length} {users.length === 1 ? "account" : "accounts"} in the system
                </p>
              </div>
              <Button onClick={() => { addForm.reset(); setAddOpen(true); }} className="gap-2">
                <UserPlus className="h-4 w-4" />
                Add Agent
              </Button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: "Total Users", value: users.length, color: "text-slate-900 dark:text-white" },
                { label: "Admins", value: users.filter((u) => u.role === "admin").length, color: "text-purple-600 dark:text-purple-400" },
                { label: "Managers", value: users.filter((u) => u.role === "manager").length, color: "text-blue-600 dark:text-blue-400" },
                { label: "Suspended", value: users.filter((u) => u.status === "suspended").length, color: "text-amber-600 dark:text-amber-400" },
              ].map((stat) => (
                <Card key={stat.label} className="rounded-[20px] border border-[hsl(var(--border))]">
                  <CardContent className="p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">{stat.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Users Table */}
            <Card className="rounded-[24px] border border-[hsl(var(--border))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  System Users
                </CardTitle>
                <CardDescription>Manage roles, status, and access for all accounts</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading users...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date Added</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id} className={u.status === "suspended" ? "opacity-60" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <img
                                src={u.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent((u.firstName || "?") + "+" + (u.lastName || ""))}&background=3B82F6&color=fff&size=32`}
                                alt=""
                                className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                              />
                              <div>
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {u.firstName} {u.lastName}
                                  {isSelf(u.id) && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                                </div>
                                {u.jobTitle && <div className="text-xs text-slate-500">{u.jobTitle}</div>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300 text-sm">
                            {u.email || "—"}
                          </TableCell>
                          <TableCell>{ROLE_BADGE[u.role] || <Badge variant="outline">{u.role}</Badge>}</TableCell>
                          <TableCell>{STATUS_BADGE[u.status || "active"] || STATUS_BADGE.active}</TableCell>
                          <TableCell className="text-sm text-slate-500">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {/* Edit */}
                              <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="Edit">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {/* Suspend / Reactivate */}
                              {!isSelf(u.id) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSuspend(u)}
                                  disabled={updateMutation.isPending}
                                  title={u.status === "suspended" ? "Reactivate" : "Suspend"}
                                >
                                  {u.status === "suspended" ? (
                                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                                  ) : (
                                    <Ban className="h-4 w-4 text-amber-600" />
                                  )}
                                </Button>
                              )}
                              {/* Delete */}
                              {!isSelf(u.id) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteTarget(u)}
                                  title="Remove"
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {!isLoading && users.length === 0 && (
                  <div className="py-12 text-center text-slate-500">No users found</div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* ---- Add Agent Modal ---- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add New Agent
            </DialogTitle>
            <DialogDescription>
              Create a new agent account. A welcome email with login credentials will be sent automatically.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl><Input {...field} placeholder="Jane" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl><Input {...field} placeholder="Doe" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={addForm.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl><Input {...field} type="email" placeholder="jane.doe@example.com" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Temporary Password</FormLabel>
                    <FormControl><Input {...field} type="password" placeholder="Min 6 characters" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
                <Mail className="h-4 w-4 flex-shrink-0" />
                Login credentials will be emailed to the agent automatically.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Agent"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ---- Edit User Modal ---- */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Edit User
            </DialogTitle>
            <DialogDescription>Update name, email, or role for {editUser?.firstName} {editUser?.lastName}.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => {
              if (editUser) updateMutation.mutate({ id: editUser.id, updates: d });
            })} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={editForm.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input {...field} type="email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isSelf(editUser?.id || "")}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf(editUser?.id || "") && (
                    <p className="text-xs text-slate-500">You cannot change your own role.</p>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User Account</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.firstName} {deleteTarget?.lastName}</strong>'s account.
              This action cannot be undone. Consider suspending the account instead if you may need to restore access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
