export type BrokerInvoiceStatus = "pending" | "confirmed" | "disputed";
export interface BrokerPortalAccount {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  brokerName: string;
}
export interface BrokerPortalSession {
  user: BrokerPortalAccount;
  csrfToken: string;
}
export interface BrokerPortalInvoice {
  id: number;
  invoiceNumber: string;
  clientName: string;
  amount: string;
  status: BrokerInvoiceStatus;
  submittedAt: string | null;
  actedAt: string | null;
}
export interface BrokerPortalInvoicePage {
  invoices: BrokerPortalInvoice[];
  total: number;
  page: number;
  pageSize: number;
}
export interface BrokerPortalInvoiceDetail extends BrokerPortalInvoice {
  carrierInvoiceNumber: string | null;
  loadNumber: string | null;
  origin: string | null;
  destination: string | null;
  disputeReason: string | null;
  actedBy: string | null;
  canRespond: boolean;
  responseNotice: string | null;
}
export interface BrokerPortalDocument {
  id: number;
  name: string;
  type: string;
  size: number;
  createdAt: string | null;
  downloadUrl: string;
}
export interface BrokerPortalNote {
  id: number;
  parentId: number | null;
  authorName: string;
  authorKind: "broker" | "staff";
  message: string;
  createdAt: string;
}
export interface BrokerPortalNotesPage {
  notes: BrokerPortalNote[];
  total: number;
  page: number;
  pageSize: number;
}
