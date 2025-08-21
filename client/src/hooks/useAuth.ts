// Authentication system completely removed - all functions return mock data for compatibility

export function useAuth() {
  return {
    user: {
      id: "1",
      firstName: "Admin", 
      lastName: "User",
      email: "admin@tpf.com",
      phone: null,
      jobTitle: "System Administrator",
      department: "IT",
      role: "admin",
      profileImageUrl: "/uploads/admin-profile.png",
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
    },
    isLoading: false,
    isAuthenticated: true,
    error: null,
  };
}