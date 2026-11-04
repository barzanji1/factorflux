import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Presentation only: preserve deliberate mixed casing and business acronyms. */
export function displayEntityName(value?: string | null): string {
  if (!value) return "—";
  if (value !== value.toUpperCase()) return value;
  return value.split(/(\s+)/).map(word => {
    const letters = word.replace(/[^A-Z]/g, "");
    if (letters.length <= 2 || /^(LLC|INC|CORP|LTD|USA|DOT)$/.test(letters)) return word;
    return word.toLowerCase().replace(/(^|[-'])[a-z]/g, part => part.toUpperCase());
  }).join("");
}
