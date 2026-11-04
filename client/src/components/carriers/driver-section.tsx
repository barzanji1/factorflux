import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button, Input, DialogContent } from "@/components/admin-neu/adapters";
import { NeuBadge, NeuSelect } from "@/styles/neu/components";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ProfileSection, EmptyState } from "./carrier-profile-section";

type Driver = {
  id: number;
  carrierId: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiration: string | null;
  status: "active" | "inactive";
  photoUrl: string | null;
};

type DriverForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  status: "active" | "inactive";
};

const emptyForm: DriverForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  licenseNumber: "",
  licenseState: "",
  licenseExpiration: "",
  status: "active",
};

function initials(driver: Pick<Driver, "firstName" | "lastName">) {
  return `${driver.firstName[0] || ""}${driver.lastName[0] || ""}`.toUpperCase() || "DR";
}

function Avatar({ driver, editable, onPhoto }: { driver: Driver; editable: boolean; onPhoto: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        disabled={!editable}
        onClick={() => inputRef.current?.click()}
        variant="ghost"
        size="icon"
        className="group relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-[#e0e0e0] p-0 text-sm font-bold text-[#168d99] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1] disabled:cursor-default"
        aria-label={editable ? `Upload photo for ${driver.firstName} ${driver.lastName}` : `${driver.firstName} ${driver.lastName}`}
      >
        {driver.photoUrl ? <img src={driver.photoUrl} alt="" className="h-full w-full object-cover" /> : initials(driver)}
        {editable && <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover:flex"><Camera className="h-4 w-4" /></span>}
      </Button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPhoto(file);
        event.target.value = "";
      }} />
    </div>
  );
}

export function DriverSection({ carrierId, canEdit, legacyDriver }: { carrierId: number; canEdit: boolean; legacyDriver?: { name?: string; phone?: string; email?: string } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState<DriverForm>(emptyForm);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const queryKey = ["/api/drivers", carrierId];
  const { data: drivers = [], isLoading, isError, refetch } = useQuery<Driver[]>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/drivers?carrierId=${carrierId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load drivers");
      return response.json();
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  async function uploadPhoto(driverId: number, file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error("Choose a JPEG or PNG no larger than 5MB");
    }
    const body = new FormData();
    body.append("photo", file);
    const response = await fetch(`/api/drivers/${driverId}/photo`, { method: "POST", body, credentials: "include" });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.message || "Photo upload failed");
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/drivers/${editing.id}` : "/api/drivers", {
        ...form,
        ...(!editing ? { carrierId } : {}),
      });
      const driver = await response.json() as Driver;
      let photoError: string | null = null;
      if (pendingPhoto) {
        try {
          await uploadPhoto(driver.id, pendingPhoto);
        } catch (error) {
          photoError = error instanceof Error ? error.message : "Photo upload failed";
        }
      }
      return { photoError };
    },
    onSuccess: ({ photoError }) => {
      setOpen(false);
      setPendingPhoto(null);
      setPreview(null);
      refresh();
      toast({
        title: editing ? "Driver updated" : "Driver added",
        description: photoError ? `The driver was saved, but the photo was not uploaded: ${photoError}` : undefined,
        variant: photoError ? "destructive" : "default",
      });
    },
    onError: (error: Error) => toast({ title: "Could not save driver", description: error.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/drivers/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Driver removed" });
    },
    onError: () => toast({ title: "Could not remove driver", variant: "destructive" }),
  });

  const openDriver = (driver?: Driver) => {
    setEditing(driver || null);
    setForm(driver ? {
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone || "",
      email: driver.email || "",
      licenseNumber: driver.licenseNumber || "",
      licenseState: driver.licenseState || "",
      licenseExpiration: driver.licenseExpiration ? driver.licenseExpiration.slice(0, 10) : "",
      status: driver.status,
    } : emptyForm);
    setPendingPhoto(null);
    setPreview(driver?.photoUrl || null);
    setOpen(true);
  };

  const choosePendingPhoto = (file: File) => {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: "Choose a JPEG or PNG no larger than 5MB", variant: "destructive" });
      return;
    }
    setPendingPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  return (
    <>
      <ProfileSection title="Drivers" action={canEdit ? <Button onClick={() => openDriver()} variant="outline" size="sm" className="h-8 gap-1 text-[10px]"><Plus className="h-3 w-3" />Add driver</Button> : undefined}>
        {isLoading ? <div className="h-20 animate-pulse border border-[#d0d9dc] bg-[#eef3f1]" />
          : isError ? <EmptyState label="Drivers could not be loaded" actionLabel="Retry" onAction={() => refetch()} />
          : drivers.length ? <div className="grid gap-2 sm:grid-cols-2">
          {drivers.map((driver) => (
            <div key={driver.id} className="flex gap-3 rounded-2xl bg-[#e0e0e0] p-3 shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
              <Avatar driver={driver} editable={canEdit} onPhoto={async (file) => {
                try {
                  await uploadPhoto(driver.id, file);
                  refresh();
                  toast({ title: "Driver photo updated" });
                } catch (error) {
                  toast({ title: "Photo upload failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
                }
              }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="truncate text-[12px] font-bold text-[#263b44]">{driver.firstName} {driver.lastName}</p>
                    <NeuBadge tone={driver.status === "active" ? "success" : "neutral"} className="mt-1 px-1.5 py-0.5 text-[9px] uppercase">{driver.status}</NeuBadge>
                  </div>
                  {canEdit && <div className="flex">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-[#087d8d]" onClick={() => openDriver(driver)} aria-label={`Edit ${driver.firstName}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-[#a33131]" onClick={() => window.confirm(`Remove ${driver.firstName} ${driver.lastName}?`) && remove.mutate(driver.id)} aria-label={`Remove ${driver.firstName}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>}
                </div>
                <div className="mt-2 space-y-1 text-[10px] text-[#667a80]">
                  <p className="flex items-center gap-1 truncate"><Phone className="h-3 w-3" />{driver.phone || "Phone not recorded"}</p>
                  <p className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{driver.email || "Email not recorded"}</p>
                  <p>License: {[driver.licenseState, driver.licenseNumber].filter(Boolean).join(" · ") || "Not recorded"}</p>
                </div>
              </div>
            </div>
          ))}
        </div> : legacyDriver?.name ? <div className="flex items-center gap-3 rounded-2xl bg-[#e0e0e0] p-3 shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#e0e0e0] text-sm font-bold text-[#718187] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
            {legacyDriver.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold">{legacyDriver.name}</p>
            <p className="mt-1 text-[10px] text-[#718187]">{legacyDriver.phone || "Phone not recorded"} · {legacyDriver.email || "Email not recorded"}</p>
            <p className="mt-1 text-[9px] uppercase tracking-wide text-[#946316]">Legacy onboarding record</p>
          </div>
          {canEdit && <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => {
            const parts = legacyDriver.name!.trim().split(/\s+/);
            setEditing(null);
            setForm({ ...emptyForm, firstName: parts.shift() || "", lastName: parts.join(" "), phone: legacyDriver.phone || "", email: legacyDriver.email || "" });
            setPendingPhoto(null);
            setPreview(null);
            setOpen(true);
          }}>Convert</Button>}
        </div> : <EmptyState label="No drivers linked to this carrier" />}
      </ProfileSection>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit driver" : "Add driver"}</DialogTitle>
            <DialogDescription>Driver details are linked directly to this carrier.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 flex items-center gap-3">
              <label className="group relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#e0e0e0] font-bold text-[#168d99] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
                {preview ? <img src={preview} alt="Driver preview" className="h-full w-full object-cover" /> : <><span>{(form.firstName[0] || "") + (form.lastName[0] || "") || "DR"}</span><Camera className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-[#e0e0e0] p-0.5 text-[#168d99]" /></>}
                <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => event.target.files?.[0] && choosePendingPhoto(event.target.files[0])} />
              </label>
              <div><p className="text-xs font-semibold">Driver photo</p><p className="text-[10px] text-muted-foreground">Click the avatar to choose a JPEG or PNG, up to 5MB.</p></div>
            </div>
            <div><Label>First Name</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div><Label>Last Name</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>License #</Label><Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} /></div>
            <div><Label>License State</Label><Input maxLength={2} value={form.licenseState} onChange={(e) => setForm({ ...form, licenseState: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></div>
            <div><Label>License Expiration</Label><Input type="date" value={form.licenseExpiration} onChange={(e) => setForm({ ...form, licenseExpiration: e.target.value })} /></div>
            <div><Label>Status</Label><NeuSelect aria-label="Driver status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}><option value="active">Active</option><option value="inactive">Inactive</option></NeuSelect></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.firstName.trim() || !form.lastName.trim()}>{save.isPending ? "Saving…" : "Save driver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}