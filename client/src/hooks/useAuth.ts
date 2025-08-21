// Authentication system completely removed - all functions return mock data for compatibility

export function useAuth() {
  return {
    user: { id: "1", firstName: "Admin", lastName: "User", role: "admin" },
    isLoading: false,
    isAuthenticated: true,
    error: null,
  };
}