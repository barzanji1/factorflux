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
    <Avatar className={cn("ff-team-chat-avatar h-6 w-6 shrink-0 text-[8px] font-bold", className)} data-testid="chat-agent-avatar">
      <AvatarImage src={profileImageUrl?.trim() || undefined} alt={`${name}'s profile picture`} className="object-cover" />
      <AvatarFallback className="bg-[#098b9f] text-white" title={name}>{initials}</AvatarFallback>
    </Avatar>
  );
}
