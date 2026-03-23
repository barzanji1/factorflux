"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function Topbar() {
  return (
    <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
      <div className="flex items-center gap-3">
        <Input placeholder="Search..." className="w-64" />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline">Notifications</Button>
        <Button>New Invoice</Button>
      </div>
    </div>
  )
}