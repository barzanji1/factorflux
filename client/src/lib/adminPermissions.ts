import { ALL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from "@shared/schema";

export interface PermissionPresentation {
  label: string;
  group: string;
}

const PERMISSION_PRESENTATION: Record<string, PermissionPresentation> = {
  dashboard: { label: "Dashboard", group: "Workspace" },
  carriers: { label: "Carriers", group: "Workspace" },
  invoices: { label: "Invoices", group: "Workspace" },
  documents: { label: "Documents", group: "Workspace" },
  tasks: { label: "Tasks", group: "Workspace" },
  bulk_invoices: { label: "Bulk Invoices", group: "Workspace" },
  portal_submissions: { label: "Portal Submissions", group: "Workspace" },
  client_email: { label: "Client Email", group: "Workspace" },
  factoring: { label: "Factoring", group: "Funding" },
  payments: { label: "Payments", group: "Funding" },
  lockbox: { label: "Lockbox", group: "Funding" },
  fuel_advance: { label: "Fuel Advance", group: "Funding" },
  bank_transfers: { label: "Bank Transfers", group: "Funding" },
  dispatchers: { label: "Dispatchers", group: "Operations" },
  trucks: { label: "Trucks", group: "Operations" },
  release_letters: { label: "Release Letters", group: "Operations" },
  brokers: { label: "Brokers", group: "Risk" },
  cb_reviews: { label: "C/B Reviews", group: "Risk" },
  mc_check: { label: "MC Check", group: "Risk" },
  held: { label: "Held", group: "Risk" },
  logs: { label: "Audit Logs", group: "Risk" },
  calendar: { label: "Calendar", group: "Workspace" },
  bulk_sms: { label: "Bulk SMS", group: "Workspace" },
  followups: { label: "Followups", group: "Recovery" },
  reports: { label: "Reports", group: "Recovery" },
  payroll: { label: "Payroll", group: "Admin" },
  expenses: { label: "Expenses", group: "Admin" },
  vault: { label: "Vault", group: "Admin" },
  help: { label: "Help", group: "Admin" },
  settings: { label: "Settings", group: "Admin" },
  rules: { label: "Doc Rules", group: "Admin" },
  workflow_builder: { label: "Workflow Builder", group: "Admin" },
  admin: { label: "Admin Panel", group: "Admin" },
  earl: { label: "Earl (AI Assistant)", group: "Workspace" },
  chat: { label: "Chat", group: "Workspace" },
  tickets: { label: "Tickets", group: "Workspace" },
};

export interface PermissionCatalogItem extends PermissionPresentation {
  key: string;
}

export interface PermissionCatalogGroup {
  id: string;
  label: string;
  items: PermissionCatalogItem[];
}

export function humanizePermissionKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || key;
}

/** Catalog entries always come from the shared registry; metadata only decorates them. */
export function getPermissionCatalog(
  permissions: readonly string[] = ALL_PERMISSIONS,
): PermissionCatalogGroup[] {
  const groups: PermissionCatalogGroup[] = [];

  permissions.forEach((key) => {
    const presentation = PERMISSION_PRESENTATION[key] ?? {
      label: humanizePermissionKey(key),
      group: "Other",
    };
    let group = groups[groups.length - 1];
    if (!group || group.label !== presentation.group) {
      group = { id: `${presentation.group}-${groups.length}`, label: presentation.group, items: [] };
      groups.push(group);
    }
    group.items.push({ key, ...presentation });
  });

  return groups;
}

/** Presets are projected onto the live registry to retain its exact membership and order. */
export function getRolePresetPermissions(
  role: string,
  permissions: readonly string[] = ALL_PERMISSIONS,
): string[] {
  if (role === "admin") return [...permissions];
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
  const granted = new Set<string>(defaults);
  return permissions.filter((key) => granted.has(key));
}
