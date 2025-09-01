import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import {
  Settings as SettingsIcon,
  Bell,
  Globe,
  Palette,
  Clock,
  Briefcase,
  User,
  MapPin,
  Save,
} from "lucide-react";

// Validation schemas
const personalSettingsSchema = z.object({
  bio: z.string().max(500, "Bio must be less than 500 characters").optional(),
  location: z.string().max(100, "Location must be less than 100 characters").optional(),
  timezone: z.string().default("America/New_York"),
  language: z.string().default("en"),
});

const notificationSettingsSchema = z.object({
  emailNotifications: z.boolean().default(true),
  smsNotifications: z.boolean().default(false),
  desktopNotifications: z.boolean().default(true),
});

const workSettingsSchema = z.object({
  startTime: z.string().default("09:00"),
  endTime: z.string().default("17:00"),
  workDays: z.array(z.string()).default(["monday", "tuesday", "wednesday", "thursday", "friday"]),
});

const appearanceSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  dateFormat: z.string().default("MM/dd/yyyy"),
  timeFormat: z.enum(["12h", "24h"]).default("12h"),
});

type PersonalSettings = z.infer<typeof personalSettingsSchema>;
type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
type WorkSettings = z.infer<typeof workSettingsSchema>;
type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

const timezones = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Phoenix", label: "Arizona Time (MST)" },
  { value: "America/Anchorage", label: "Alaska Time (AKST)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
];

const languages = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
];

const workDaysOptions = [
  { id: "monday", label: "Monday" },
  { id: "tuesday", label: "Tuesday" },
  { id: "wednesday", label: "Wednesday" },
  { id: "thursday", label: "Thursday" },
  { id: "friday", label: "Friday" },
  { id: "saturday", label: "Saturday" },
  { id: "sunday", label: "Sunday" },
];

export default function Settings() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("personal");

  // Fetch current user data
  const { data: user, isLoading: userLoading, error: userError } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // Forms
  const personalForm = useForm<PersonalSettings>({
    resolver: zodResolver(personalSettingsSchema),
    defaultValues: {
      bio: "",
      location: "",
      timezone: "America/New_York",
      language: "en",
    },
  });

  const notificationForm = useForm<NotificationSettings>({
    resolver: zodResolver(notificationSettingsSchema),
    defaultValues: {
      emailNotifications: true,
      smsNotifications: false,
      desktopNotifications: true,
    },
  });

  const workForm = useForm<WorkSettings>({
    resolver: zodResolver(workSettingsSchema),
    defaultValues: {
      startTime: "09:00",
      endTime: "17:00",
      workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    },
  });

  const appearanceForm = useForm<AppearanceSettings>({
    resolver: zodResolver(appearanceSettingsSchema),
    defaultValues: {
      theme: theme || "light",
      dateFormat: "MM/dd/yyyy",
      timeFormat: "12h",
    },
  });

  // Update form when theme changes
  useEffect(() => {
    if (theme && (theme === "light" || theme === "dark")) {
      appearanceForm.setValue("theme", theme);
    }
  }, [theme, appearanceForm]);

  // Update forms when user data loads
  useEffect(() => {
    if (user) {
      personalForm.reset({
        bio: (user as any)?.bio || "",
        location: (user as any)?.location || "",
        timezone: (user as any)?.timezone || "America/New_York",
        language: (user as any)?.language || "en",
      });

      notificationForm.reset({
        emailNotifications: (user as any)?.emailNotifications ?? true,
        smsNotifications: (user as any)?.smsNotifications ?? false,
        desktopNotifications: (user as any)?.desktopNotifications ?? true,
      });

      workForm.reset({
        startTime: (user as any)?.startTime || "09:00",
        endTime: (user as any)?.endTime || "17:00",
        workDays: (user as any)?.workDays?.split(',') || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      });

      // Sync appearance form with database data but preserve localStorage theme
      const savedTheme = localStorage.getItem("theme") as "light" | "dark" || (user as any)?.theme || "light";
      appearanceForm.reset({
        theme: savedTheme,
        dateFormat: (user as any)?.dateFormat || "MM/dd/yyyy",
        timeFormat: (user as any)?.timeFormat || "12h",
      });
      // Ensure theme is applied when form loads
      setTheme(savedTheme);
    }
  }, [user, personalForm, notificationForm, workForm, appearanceForm]);

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: any) => {
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
        title: "Settings Updated",
        description: "Your settings have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update settings",
        variant: "destructive",
      });
    },
  });

  const onPersonalSubmit = (data: PersonalSettings) => {
    updateSettings.mutate(data);
  };

  const onNotificationSubmit = (data: NotificationSettings) => {
    updateSettings.mutate(data);
  };

  const onWorkSubmit = (data: WorkSettings) => {
    const workData = {
      ...data,
      workDays: data.workDays.join(','),
    };
    updateSettings.mutate(workData);
  };

  const onAppearanceSubmit = (data: AppearanceSettings) => {
    // Update theme immediately for visual feedback
    if (data.theme) {
      setTheme(data.theme as "light" | "dark");
    }
    updateSettings.mutate(data);
  };


  // Handle loading and error states
  if (userLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav 
            title="Settings" 
            subtitle="Customize your experience and preferences"
          />
          <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </main>
        </div>
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav 
            title="Settings" 
            subtitle="Customize your experience and preferences"
          />
          <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
            <div className="text-center">
              <p className="text-red-600">Failed to load user data. Please try logging in again.</p>
            </div>
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
          title="Settings" 
          subtitle="Customize your experience and preferences"
        />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center space-x-2">
              <SettingsIcon className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="personal" className="flex items-center space-x-2">
                  <User className="w-4 h-4" />
                  <span>Personal</span>
                </TabsTrigger>
                <TabsTrigger value="notifications" className="flex items-center space-x-2">
                  <Bell className="w-4 h-4" />
                  <span>Notifications</span>
                </TabsTrigger>
                <TabsTrigger value="work" className="flex items-center space-x-2">
                  <Briefcase className="w-4 h-4" />
                  <span>Work</span>
                </TabsTrigger>
                <TabsTrigger value="appearance" className="flex items-center space-x-2">
                  <Palette className="w-4 h-4" />
                  <span>Appearance</span>
                </TabsTrigger>
              </TabsList>

              {/* Personal Settings */}
              <TabsContent value="personal">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <User className="w-5 h-5" />
                      <span>Personal Information</span>
                    </CardTitle>
                    <CardDescription>
                      Update your personal details and preferences
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...personalForm}>
                      <form onSubmit={personalForm.handleSubmit(onPersonalSubmit)} className="space-y-6">
                        <FormField
                          control={personalForm.control}
                          name="bio"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bio</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Tell us about yourself..."
                                  className="resize-none"
                                  rows={3}
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                A brief description about yourself (max 500 characters)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={personalForm.control}
                          name="location"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center space-x-2">
                                <MapPin className="w-4 h-4" />
                                <span>Location</span>
                              </FormLabel>
                              <FormControl>
                                <Input placeholder="City, State" {...field} />
                              </FormControl>
                              <FormDescription>
                                Your current location or preferred work location
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={personalForm.control}
                            name="timezone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center space-x-2">
                                  <Globe className="w-4 h-4" />
                                  <span>Timezone</span>
                                </FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select timezone" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {timezones.map((tz) => (
                                      <SelectItem key={tz.value} value={tz.value}>
                                        {tz.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={personalForm.control}
                            name="language"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Language</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select language" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {languages.map((lang) => (
                                      <SelectItem key={lang.value} value={lang.value}>
                                        {lang.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <Button type="submit" disabled={updateSettings.isPending} className="flex items-center space-x-2">
                          <Save className="w-4 h-4" />
                          <span>{updateSettings.isPending ? "Saving..." : "Save Personal Settings"}</span>
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Notification Settings */}
              <TabsContent value="notifications">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Bell className="w-5 h-5" />
                      <span>Notification Preferences</span>
                    </CardTitle>
                    <CardDescription>
                      Choose how you want to be notified about important updates
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...notificationForm}>
                      <form onSubmit={notificationForm.handleSubmit(onNotificationSubmit)} className="space-y-6">
                        <FormField
                          control={notificationForm.control}
                          name="emailNotifications"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">Email Notifications</FormLabel>
                                <FormDescription>
                                  Receive notifications via email for important updates
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={notificationForm.control}
                          name="smsNotifications"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">SMS Notifications</FormLabel>
                                <FormDescription>
                                  Receive notifications via SMS for urgent updates
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={notificationForm.control}
                          name="desktopNotifications"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">Desktop Notifications</FormLabel>
                                <FormDescription>
                                  Show browser notifications when the app is open
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <Button type="submit" disabled={updateSettings.isPending} className="flex items-center space-x-2">
                          <Save className="w-4 h-4" />
                          <span>{updateSettings.isPending ? "Saving..." : "Save Notification Settings"}</span>
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Work Settings */}
              <TabsContent value="work">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Briefcase className="w-5 h-5" />
                      <span>Work Preferences</span>
                    </CardTitle>
                    <CardDescription>
                      Set your work schedule and availability preferences
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...workForm}>
                      <form onSubmit={workForm.handleSubmit(onWorkSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={workForm.control}
                            name="startTime"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center space-x-2">
                                  <Clock className="w-4 h-4" />
                                  <span>Start Time</span>
                                </FormLabel>
                                <FormControl>
                                  <Input type="time" {...field} />
                                </FormControl>
                                <FormDescription>
                                  Your typical work start time
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={workForm.control}
                            name="endTime"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center space-x-2">
                                  <Clock className="w-4 h-4" />
                                  <span>End Time</span>
                                </FormLabel>
                                <FormControl>
                                  <Input type="time" {...field} />
                                </FormControl>
                                <FormDescription>
                                  Your typical work end time
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={workForm.control}
                          name="workDays"
                          render={() => (
                            <FormItem>
                              <div className="mb-4">
                                <FormLabel className="text-base">Work Days</FormLabel>
                                <FormDescription>
                                  Select the days you typically work
                                </FormDescription>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {workDaysOptions.map((day) => (
                                  <FormField
                                    key={day.id}
                                    control={workForm.control}
                                    name="workDays"
                                    render={({ field }) => {
                                      return (
                                        <FormItem
                                          key={day.id}
                                          className="flex flex-row items-start space-x-3 space-y-0"
                                        >
                                          <FormControl>
                                            <Checkbox
                                              checked={field.value?.includes(day.id)}
                                              onCheckedChange={(checked) => {
                                                return checked
                                                  ? field.onChange([...field.value, day.id])
                                                  : field.onChange(
                                                      field.value?.filter(
                                                        (value) => value !== day.id
                                                      )
                                                    )
                                              }}
                                            />
                                          </FormControl>
                                          <FormLabel className="font-normal">
                                            {day.label}
                                          </FormLabel>
                                        </FormItem>
                                      )
                                    }}
                                  />
                                ))}
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button type="submit" disabled={updateSettings.isPending} className="flex items-center space-x-2">
                          <Save className="w-4 h-4" />
                          <span>{updateSettings.isPending ? "Saving..." : "Save Work Settings"}</span>
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Appearance Settings */}
              <TabsContent value="appearance">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Palette className="w-5 h-5" />
                      <span>Appearance & Display</span>
                    </CardTitle>
                    <CardDescription>
                      Customize the look and feel of your interface
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...appearanceForm}>
                      <form onSubmit={appearanceForm.handleSubmit(onAppearanceSubmit)} className="space-y-6">
                        <FormField
                          control={appearanceForm.control}
                          name="theme"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Theme</FormLabel>
                              <Select 
                                onValueChange={(value) => {
                                  console.log(`Theme selector changed to: ${value}`);
                                  field.onChange(value);
                                  // Apply theme immediately for instant visual feedback
                                  setTheme(value as "light" | "dark");
                                  // Auto-save theme selection to database
                                  updateSettings.mutate({ theme: value });
                                }} 
                                value={field.value || theme}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select theme" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="light">
                                    <div className="flex items-center space-x-2">
                                      <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                                      <span>Light</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="dark">
                                    <div className="flex items-center space-x-2">
                                      <div className="w-3 h-3 rounded-full bg-gray-800"></div>
                                      <span>Dark</span>
                                    </div>
                                  </SelectItem>

                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Choose your preferred theme. Changes apply immediately and are saved automatically.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={appearanceForm.control}
                            name="dateFormat"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date Format</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select date format" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="MM/dd/yyyy">MM/DD/YYYY</SelectItem>
                                    <SelectItem value="dd/MM/yyyy">DD/MM/YYYY</SelectItem>
                                    <SelectItem value="yyyy-MM-dd">YYYY-MM-DD</SelectItem>
                                    <SelectItem value="MMM dd, yyyy">MMM DD, YYYY</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={appearanceForm.control}
                            name="timeFormat"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Time Format</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select time format" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="12h">12 Hour (AM/PM)</SelectItem>
                                    <SelectItem value="24h">24 Hour</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <Button type="submit" disabled={updateSettings.isPending} className="flex items-center space-x-2">
                          <Save className="w-4 h-4" />
                          <span>{updateSettings.isPending ? "Saving..." : "Save Appearance Settings"}</span>
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}