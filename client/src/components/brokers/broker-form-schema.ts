import { z } from "zod";

// Shared by list creation/editing and the profile edit dialog.
export const brokerFormSchema = z.object({
  name: z.string().min(1, "Broker name is required"),
  contactPerson: z.string().min(1, "Contact person is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  mcNumber: z.string().optional(),
  dotNumber: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.enum(["net15", "net30", "net45", "net60", "quickpay"]).default("net30"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  notes: z.string().optional(),
});

export type BrokerFormData = z.infer<typeof brokerFormSchema>;
