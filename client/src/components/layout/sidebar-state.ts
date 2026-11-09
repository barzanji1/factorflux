// Page-owned sidebars remount on navigation. Keep only session-local chrome
// state here so changing pages cannot collapse the rail or reopen its groups.
type Mode = "desktop" | "mobile";
type Snapshot = {
  hovered: boolean;
  sections: Record<Mode, Record<string, boolean>>;
};

let snapshot: Snapshot = { hovered: false, sections: { desktop: {}, mobile: {} } };
const listeners = new Set<() => void>();
let focusDestination: string | null = null;

export function requestSidebarFocus(path: string) {
  focusDestination = path;
}
export function consumeSidebarFocus(path: string) {
  if (focusDestination !== path) return false;
  focusDestination = null;
  return true;
}

export const getSidebarState = () => snapshot;
export function subscribeSidebarState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}
export function setSidebarHovered(hovered: boolean) {
  if (snapshot.hovered !== hovered) publish({ ...snapshot, hovered });
}
export function toggleSidebarSection(mode: Mode, title: string) {
  publish({
    ...snapshot,
    sections: {
      ...snapshot.sections,
      [mode]: { ...snapshot.sections[mode], [title]: !(snapshot.sections[mode][title] ?? true) },
    },
  });
}
