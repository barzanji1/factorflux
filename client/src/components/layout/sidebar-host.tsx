import { createContext, useCallback, useContext, useState, type ComponentType, type ReactNode } from "react";

const SidebarHosted = createContext<((sidebar: ComponentType) => () => void) | null>(null);
export const useSidebarHosted = () => useContext(SidebarHosted);

/** The desktop rail belongs to the session, not to a disposable route page. */
export function StaffSidebarHost({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [Sidebar, setSidebar] = useState<ComponentType | null>(null);
  const [slots, setSlots] = useState(0);
  const register = useCallback((component: ComponentType) => {
    // The route already imported the rail. Register that exact component
    // synchronously, without pulling staff code into the login entry bundle.
    setSidebar((previous: ComponentType | null) => previous ?? component);
    setSlots(count => count + 1);
    return () => setSlots(count => count - 1);
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-staff-frame>
      {enabled && slots > 0 && Sidebar && <Sidebar />}
      <SidebarHosted.Provider value={enabled ? register : null}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </SidebarHosted.Provider>
    </div>
  );
}
