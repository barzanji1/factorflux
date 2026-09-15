import { Link, useLocation } from "wouter";
import { LogOut, FileText, LayoutDashboard, PlusCircle, UserRound, MessageCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import { cn } from "@/lib/utils";

interface PortalUser {
  id: number;
  email: string;
  companyName: string;
  mcNumber?: string;
  dotNumber?: string;
  status: string;
}

interface PortalLayoutProps {
  children: React.ReactNode;
}

interface PortalChatSummary {
  unreadCount?: number;
  unread?: number;
  unreadMessages?: number;
  agent?: { name?: string; avatar?: string; avatarUrl?: string };
}

export default function PortalLayout({ children }: PortalLayoutProps) {
  const [location] = useLocation();
  const queryClient = useQueryClient();

  const { data: me } = useQuery<PortalUser>({
    queryKey: ["/api/portal/me"],
    retry: false,
  });

  const { data: chatSummary } = useQuery<PortalChatSummary>({
    queryKey: ["/api/portal/chat"],
    enabled: !!me,
    refetchInterval: 5000,
    retry: false,
  });

  const unreadMessages = Math.max(
    0,
    Number(chatSummary?.unreadCount ?? chatSummary?.unreadMessages ?? chatSummary?.unread ?? 0),
  );

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/portal/logout", { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/portal/login";
    },
  });

  const navLinks = [
    { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/portal/submit",    label: "Submit Invoice", icon: PlusCircle },
    { href: "/portal/submissions", label: "My Submissions", icon: FileText },
    { href: "/portal/chat", label: "Messages", icon: MessageCircle },
    { href: "/portal/profile", label: "Profile", icon: UserRound },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/portal/dashboard" className="flex items-center gap-2">
            <FactorFluxLogo
              showWordmark={false}
              shine
              markClassName="h-8 w-8"
            />
            <span className="font-semibold text-slate-900 text-sm">Carrier Portal</span>
            <span className="hidden sm:inline text-xs text-slate-400">— TPF</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <button
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    location === link.href || location.startsWith(link.href)
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  <span>{link.label}</span>
                  {link.href === "/portal/chat" && unreadMessages > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none text-white">
                      {unreadMessages > 99 ? "99+" : unreadMessages}
                    </span>
                  )}
                </button>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[140px]">
                {me.companyName}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-600"
              onClick={() => logoutMutation.mutate()}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden border-t border-slate-100 flex">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="flex-1">
              <button
                className={cn(
                  "w-full flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  location === link.href
                    ? "text-blue-700"
                    : "text-slate-500"
                )}
              >
                <link.icon className="h-4 w-4" />
                <span className="relative">
                  {link.label.split(" ")[0]}
                  {link.href === "/portal/chat" && unreadMessages > 0 && (
                    <span className="absolute -right-3 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] leading-none text-white">
                      {unreadMessages > 9 ? "9+" : unreadMessages}
                    </span>
                  )}
                </span>
              </button>
            </Link>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
