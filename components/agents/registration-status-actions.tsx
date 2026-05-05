"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Clock, CheckCircle2, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type RegistrationSource = "airtel" | "safaricom";

interface RegistrationStatusActionsProps {
  registration: {
    id: string;
    status: string;
    source: RegistrationSource;
  };
}

const REGISTRATION_STATUSES = [
  { value: "pending", label: "Pending", icon: Clock },
  { value: "approved", label: "Approved", icon: CheckCircle2 },
  { value: "installed", label: "Installed", icon: Package },
] as const;

export function RegistrationStatusActions({ registration }: RegistrationStatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    setLoading(true);
    try {
      const supabase = createClient();
      const table =
        registration.source === "safaricom" ? "safaricom_registrations" : "customer_registrations";
      const { error } = await supabase.from(table).update({ status: newStatus }).eq("id", registration.id);

      if (error) {
        console.error("Error updating registration status:", error);
        alert(`Failed to update status: ${error.message}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred while updating the registration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={loading} className="h-8 w-8 p-0">
          <span className="sr-only">Change status</span>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        {REGISTRATION_STATUSES.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => handleStatusChange(value)}
            disabled={loading || registration.status === value}
            className={registration.status === value ? "bg-gray-50 font-medium" : ""}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
