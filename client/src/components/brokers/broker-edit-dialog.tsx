import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Broker } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { brokerFormSchema, type BrokerFormData } from "./broker-form-schema";
import { NeuButton, NeuInput } from "@/styles/neu/components";

export default function BrokerEditDialog({ broker, onClose }: { broker: Broker; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<BrokerFormData>({
    resolver: zodResolver(brokerFormSchema),
    defaultValues: {
      name: broker.name, contactPerson: broker.contactPerson ?? "",
      email: broker.email ?? "", phone: broker.phone ?? "",
      address: broker.address ?? "", city: broker.city ?? "", state: broker.state ?? "",
      zipCode: broker.zipCode ?? "", mcNumber: broker.mcNumber ?? "", dotNumber: broker.dotNumber ?? "",
      creditLimit: Number(broker.creditLimit ?? 0),
      paymentTerms: (broker.paymentTerms || "net30") as BrokerFormData["paymentTerms"],
      status: (broker.status || "active") as BrokerFormData["status"],
      notes: broker.notes ?? "",
    },
  });
  const update = useMutation({
    mutationFn: (values: BrokerFormData) => apiRequest("PATCH", `/api/brokers/${broker.id}`, values),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/brokers"] });
      toast({ title: "Broker updated successfully" });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Unable to update broker", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={open => { if (!open && !update.isPending) onClose(); }}>
      <DialogContent data-testid="broker-edit-dialog" className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#354548] shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8]">
        <DialogHeader>
          <DialogTitle>Edit Broker</DialogTitle>
          <DialogDescription>Update {broker.name} without leaving this profile.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(values => update.mutate(values))} className="grid grid-cols-2 gap-4">
            {([
              ["name", "Broker Name", true], ["contactPerson", "Contact Person", true],
              ["email", "Email", true], ["phone", "Phone", true], ["address", "Address", false],
              ["city", "City", false], ["state", "State", false], ["zipCode", "ZIP Code", false],
              ["mcNumber", "MC Number", false], ["dotNumber", "DOT Number", false],
            ] as const).map(([name, label, required]) => (
              <FormField key={name} control={form.control} name={name} render={({ field }) => (
                <FormItem className={name === "address" ? "col-span-2" : ""}>
                  <FormLabel>{label}{required ? " *" : ""}</FormLabel>
                  <FormControl><NeuInput data-testid={`broker-edit-${name}`} type={name === "email" ? "email" : "text"} {...field} className="min-h-10 text-sm" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            ))}
            <FormField control={form.control} name="creditLimit" render={({ field }) => (
              <FormItem>
                <FormLabel>Credit Limit</FormLabel>
                <FormControl><NeuInput data-testid="broker-edit-creditLimit" type="number" {...field} onChange={event => field.onChange(Number(event.target.value))} className="min-h-10 text-sm" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {([
              ["paymentTerms", "Payment Terms", [["quickpay", "Quick Pay"], ["net15", "Net 15"], ["net30", "Net 30"], ["net45", "Net 45"], ["net60", "Net 60"]]],
              ["status", "Status", [["active", "Active"], ["inactive", "Inactive"], ["suspended", "Suspended"]]],
            ] as const).map(([name, label, options]) => (
              <FormField key={name} control={form.control} name={name} render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <Select value={field.value} onValueChange={value => { if (value) field.onChange(value); }}>
                    <FormControl><SelectTrigger data-testid={`broker-edit-${name}`} className="min-h-10 rounded-xl border-0 bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            ))}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea data-testid="broker-edit-notes" rows={3} {...field} className="rounded-xl border-0 bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff] focus-visible:ring-[#27aab8]" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {update.error && <p role="alert" className="col-span-2 text-sm text-red-700">{update.error.message}</p>}
            <DialogFooter className="col-span-2">
              <NeuButton data-testid="broker-edit-cancel" type="button" disabled={update.isPending} onClick={onClose}>Cancel</NeuButton>
              <NeuButton data-testid="broker-edit-save" type="submit" variant="accent" disabled={update.isPending}>{update.isPending ? "Saving…" : "Update Broker"}</NeuButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
