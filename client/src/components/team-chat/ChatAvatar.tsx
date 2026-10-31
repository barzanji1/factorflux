import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function ChatAvatar({ name, profileImageUrl, className }: {
  name: string;
  profileImageUrl?: string | null;
  className?: string;
}) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : (parts[0]?.[0] || "?").toUpperCase();
  return (
    <Avatar className={cn("h-7 w-7 shrink-0 rounded-full bg-[#e0e0e0] text-[9px] font-bold shadow-[-3px_-3px_6px_#fff,3px_3px_6px_#b8b8b8]", className)} data-testid="chat-agent-avatar">
      <AvatarImage src={profileImageUrl?.trim() || undefined} alt={`${name}'s profile picture`} className="object-cover" />
      <AvatarFallback className="rounded-full bg-[#27aab8] text-white" title={name}>{initials}</AvatarFallback>
    </Avatar>
  );
}
