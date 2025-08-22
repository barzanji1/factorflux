import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateUserProfileSchema, type UpdateUserProfile, type User } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User as UserIcon, 
  Camera, 
  Save, 
  Mail, 
  Phone, 
  Briefcase, 
  Building,
  Calendar,
  Shield
} from "lucide-react";

const departments = [
  "Operations",
  "Finance", 
  "Sales",
  "Customer Service",
  "IT",
  "Human Resources",
  "Management",
  "Other"
];

const jobTitles = [
  "System Administrator",
  "Account Manager",
  "Operations Manager", 
  "Finance Manager",
  "Customer Service Representative",
  "Sales Representative",
  "IT Administrator",
  "Dispatcher",
  "Administrative Assistant",
  "Vice President",
  "Director",
  "Chief Executive Officer",
  "Chief Technology Officer",
  "Chief Financial Officer",
  "Other"
];

export default function Profile() {
  // Mock user data since authentication is removed
  const user = {
    id: "1",
    firstName: "Admin", 
    lastName: "User",
    email: "admin@tpf.com",
    phone: null,
    jobTitle: "System Administrator",
    department: "IT",
    role: "admin",
    profileImageUrl: "/uploads/c20bf48700fe065a95d9858e806bf4ce",
    bio: null,
    location: null,
    timezone: "America/New_York",
    language: "en",
    emailNotifications: true,
    smsNotifications: false,
    desktopNotifications: true,
    startTime: "09:00",
    endTime: "17:00", 
    workDays: "monday,tuesday,wednesday,thursday,friday",
    theme: "system",
    dateFormat: "MM/dd/yyyy",
    timeFormat: "12h",
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const isAuthenticated = true;
  const isLoading = false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Authentication system removed - no redirect needed

  const form = useForm<UpdateUserProfile>({
    resolver: zodResolver(updateUserProfileSchema),
    defaultValues: {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      jobTitle: user.jobTitle || "",
      department: user.department || "",
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (data: UpdateUserProfile) => {
      const response = await apiRequest("PATCH", "/api/user/profile", data);
      
      // Check if response has content before parsing JSON
      const text = await response.text();
      if (text) {
        return JSON.parse(text);
      }
      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: "Profile Updated", 
        description: "Your profile has been updated successfully.",
      });
      // Authentication system removed - simplified refresh
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const uploadProfileImage = useMutation({
    mutationFn: async (file: File) => {
      setIsUploadingImage(true);
      const formData = new FormData();
      formData.append("profileImage", file);
      
      const response = await fetch("/api/user/profile-image", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error("Failed to upload image");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Profile Image Updated",
        description: "Your profile image has been updated successfully.",
      });
      setIsUploadingImage(false);
      // Refresh the page to show the new image
      window.location.reload();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to upload image",
        variant: "destructive",
      });
      setIsUploadingImage(false);
    },
  });

  const onSubmit = (data: UpdateUserProfile) => {
    updateProfile.mutate(data);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type and size
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File Type",
          description: "Please select an image file (JPEG, PNG, GIF).",
          variant: "destructive",
        });
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: "File Too Large",
          description: "Please select an image smaller than 5MB.",
          variant: "destructive",
        });
        return;
      }
      
      uploadProfileImage.mutate(file);
    }
  };

  const triggerImageUpload = () => {
    fileInputRef.current?.click();
  };

  // Authentication system removed - always show profile

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Profile & Settings" 
          subtitle="Manage your personal information and account preferences"
        />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
        {/* Profile Header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="w-5 h-5" />
              Profile Information
            </CardTitle>
            <CardDescription>
              Update your personal information and account settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start space-x-6">
              {/* Profile Image */}
              <div className="flex flex-col items-center space-y-3">
                <Avatar className="w-24 h-24">
                  <AvatarImage 
                    src={user.profileImageUrl || `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=3B82F6&color=fff`} 
                    alt={`${user.firstName} ${user.lastName}`}
                    className="object-cover"
                  />
                  <AvatarFallback className="text-lg">
                    {user.firstName?.[0]}{user.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                
                {/* Name and Job Title */}
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {user.firstName} {user.lastName}
                  </h3>
                  {user.jobTitle && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {user.jobTitle}
                    </p>
                  )}
                </div>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={triggerImageUpload}
                  disabled={isUploadingImage}
                  className="flex items-center gap-1"
                >
                  <Camera className="w-4 h-4" />
                  {isUploadingImage ? "Uploading..." : "Change Photo"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>

              {/* Account Info */}
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-600 flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      Email Address
                    </Label>
                    <p className="text-sm text-gray-900 dark:text-white mt-1">{user.email}</p>
                    <p className="text-xs text-gray-500">Email cannot be changed</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-600 flex items-center gap-1">
                      <Shield className="w-4 h-4" />
                      Role
                    </Label>
                    <p className="text-sm text-gray-900 dark:text-white mt-1 capitalize">{user.role}</p>
                    <p className="text-xs text-gray-500">Role is managed by administrators</p>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-600 flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    Member Since
                  </Label>
                  <p className="text-sm text-gray-900 dark:text-white mt-1">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : 'Unknown'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Profile Form */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your personal details and contact information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your first name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Phone className="w-4 h-4" />
                        Phone Number
                      </FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter your phone number" 
                          {...field} 
                          value={field.value || ""} 
                        />
                      </FormControl>
                      <FormDescription>
                        Optional. Used for important account notifications.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="jobTitle"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          Job Title
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select your job title" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {jobTitles.map((title) => (
                              <SelectItem key={title} value={title}>
                                {title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          <Building className="w-4 h-4" />
                          Department
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select your department" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {departments.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => form.reset()}
                  >
                    Reset
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={updateProfile.isPending}
                    className="flex items-center gap-1"
                  >
                    <Save className="w-4 h-4" />
                    {updateProfile.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
        </main>
      </div>
    </div>
  );
}