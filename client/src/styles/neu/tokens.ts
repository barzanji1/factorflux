export const neuColors = {
  base: "#e0e0e0",
  dark: "#333333",
  muted: "#888888",
  accent: "#27aab8",
} as const;

export const neuRadii = { card: 16, control: 12 } as const;

export const neuTokenClasses = {
  cardRadius: "rounded-2xl",
  controlRadius: "rounded-xl",
  base: "bg-[#e0e0e0]",
  text: "text-[#333333]",
  mutedText: "text-[#888888]",
  accentText: "text-[#27aab8]",
  accentSurface: "bg-[#27aab8]",
  convex: "shadow-[-7px_-7px_16px_#ffffff,7px_7px_16px_#b8b8b8]",
  concave: "shadow-[inset_6px_6px_12px_#b8b8b8,inset_-6px_-6px_12px_#ffffff]",
  flat: "shadow-[4px_4px_9px_#c1c1c1,-4px_-4px_9px_#ffffff]",
  focus: "focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-[#27aab8] focus-visible:!outline-offset-2",
} as const;
