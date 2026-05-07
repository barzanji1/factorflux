import { useState, useCallback } from "react";

export type SavedView = {
  id: string;
  label: string;
  emoji: string;
  filters: Record<string, string>;
  isPreset?: boolean;
};

const PRESET_VIEWS: Record<string, SavedView[]> = {
  factoring: [
    { id: "ready",        label: "Ready to Fund",  emoji: "💚", filters: { tab: "approved" },      isPreset: true },
    { id: "new",          label: "New",             emoji: "🆕", filters: { tab: "new" },           isPreset: true },
    { id: "docs_pending", label: "Awaiting Docs",  emoji: "📄", filters: { tab: "docs_pending" },  isPreset: true },
    { id: "held",         label: "Held Loads",     emoji: "🔴", filters: { tab: "held" },           isPreset: true },
  ],
  exceptions: [
    { id: "open_critical", label: "Critical",    emoji: "🔴", filters: { tab: "open",         severity: "critical" }, isPreset: true },
    { id: "all_open",      label: "All Open",    emoji: "⚠️",  filters: { tab: "open",         severity: "all"      }, isPreset: true },
    { id: "in_review",     label: "In Review",   emoji: "🔍", filters: { tab: "under_review", severity: "all"      }, isPreset: true },
  ],
  collections: [
    { id: "overdue",      label: "Overdue",      emoji: "⏰", filters: { tab: "overdue"     }, isPreset: true },
    { id: "in_progress",  label: "In Progress",  emoji: "🔧", filters: { tab: "in_progress" }, isPreset: true },
    { id: "pending",      label: "Not Started",  emoji: "⏳", filters: { tab: "pending"     }, isPreset: true },
  ],
  cash: [
    { id: "unapplied", label: "Unapplied",    emoji: "💰", filters: { status: "unapplied"         }, isPreset: true },
    { id: "partial",   label: "Partial Match", emoji: "⚡", filters: { status: "partially_applied" }, isPreset: true },
  ],
  brokers: [
    { id: "active",    label: "Active",    emoji: "✅", filters: { status: "active"    }, isPreset: true },
    { id: "quickpay",  label: "Quick Pay", emoji: "⚡", filters: { terms: "quickpay"  }, isPreset: true },
    { id: "suspended", label: "Suspended", emoji: "🔴", filters: { status: "suspended" }, isPreset: true },
  ],
};

function getStorageKey(pageKey: string) {
  return `ff:views:${pageKey}`;
}

function loadUserViews(pageKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(getStorageKey(pageKey));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserViews(pageKey: string, views: SavedView[]) {
  try {
    localStorage.setItem(getStorageKey(pageKey), JSON.stringify(views));
  } catch {}
}

export function useSavedViews(pageKey: string) {
  const [userViews, setUserViewsState] = useState<SavedView[]>(() => loadUserViews(pageKey));

  const presets = PRESET_VIEWS[pageKey] ?? [];
  const allViews = [...presets, ...userViews];

  const saveView = useCallback((view: Omit<SavedView, "isPreset">) => {
    const newView: SavedView = { ...view, isPreset: false };
    setUserViewsState(prev => {
      const filtered = prev.filter(v => v.id !== view.id);
      const next = [...filtered, newView];
      saveUserViews(pageKey, next);
      return next;
    });
  }, [pageKey]);

  const deleteView = useCallback((id: string) => {
    setUserViewsState(prev => {
      const next = prev.filter(v => v.id !== id);
      saveUserViews(pageKey, next);
      return next;
    });
  }, [pageKey]);

  return { presets, userViews, allViews, saveView, deleteView };
}
