import type { CollectionEvent } from "@shared/broker-collections";

const labels: Record<string, string> = {
  actorId: "Staff user ID",
  brokerId: "Broker ID",
  invoiceNumber: "Invoice",
  loadNumber: "Load number",
  wouldSendEmail: "Would send email",
  wouldNotifyAlan: "Would notify collection handler",
};

const actions: Record<string, string> = {
  vp_confirmed: "Receipt confirmed by staff",
  paid: "Collection workflow marked paid",
  pause: "Collections paused",
  resume: "Collections resumed",
  stop: "Collections stopped",
  start_live: "Live collections started",
};

function parsedDetails(details: unknown): unknown {
  if (typeof details !== "string") return details;
  try { return JSON.parse(details); } catch { return details; }
}

function fieldLabel(key: string) {
  return labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
}

function valueLabel(value: unknown, key: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "action") return actions[String(value)] ?? fieldLabel(String(value));
  if (key === "phase") return ({ vp: "Receipt confirmation (VP)", rps: "Payment status (RPS)" } as Record<string, string>)[String(value)] ?? String(value);
  return String(value);
}

export function collectionEventTitle(event: Pick<CollectionEvent, "step" | "details">) {
  const details = parsedDetails(event.details);
  if (event.step.startsWith("control_")) {
    const action = details && typeof details === "object" && "action" in details ? String(details.action) : "";
    return actions[action] ?? "Collection workflow updated";
  }
  const followup = /^(vp|rps)_(\d+|escalation)$/.exec(event.step);
  if (!followup) return fieldLabel(event.step);
  const phase = followup[1] === "vp" ? "Receipt confirmation" : "Payment status";
  return followup[2] === "escalation" ? `${phase} escalated` : `${phase} follow-up ${followup[2]}`;
}

export function collectionEventFields(details: unknown): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  function visit(value: unknown, path: string[], key: string) {
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) fields.push({ label: path.join(" · ") || "Details", value: "None" });
      for (const [childKey, childValue] of entries) {
        visit(childValue, [...path, Array.isArray(value) ? `Item ${Number(childKey) + 1}` : fieldLabel(childKey)], childKey);
      }
    } else {
      fields.push({ label: path.join(" · ") || "Details", value: valueLabel(value, key) });
    }
  }
  visit(parsedDetails(details), [], "");
  return fields;
}
