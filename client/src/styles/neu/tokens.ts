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
  convex: "shadow-[4px_4px_8px_#c8c8c8,-4px_-4px_8px_#ffffff]",
  concave: "shadow-[inset_3px_3px_6px_#c8c8c8,inset_-3px_-3px_6px_#ffffff]",
  flat: "shadow-[2px_2px_4px_#c8c8c8,-2px_-2px_4px_#ffffff]",
  button: "shadow-[3px_3px_6px_#c8c8c8,-3px_-3px_6px_#ffffff]",
  buttonPressed: "active:shadow-[inset_3px_3px_6px_#c8c8c8,inset_-3px_-3px_6px_#ffffff]",
  input: "!shadow-[inset_2px_2px_4px_#c8c8c8,inset_-2px_-2px_4px_#ffffff]",
  focus: "focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-[#27aab8] focus-visible:!outline-offset-2",
} as const;
