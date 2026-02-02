"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReactNode, useEffect, useState, useTransition } from "react";

interface RegistrationsTabsWrapperProps {
  statusFilter: string;
  counts: {
    all: number;
    pending: number;
    approved: number;
    installed: number;
  };
  children: ReactNode;
}

export function RegistrationsTabsWrapper({
  statusFilter: initialStatusFilter,
  counts,
  children,
}: RegistrationsTabsWrapperProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  
  // Get status filter from URL params (client-side)
  const urlStatusFilter = searchParams.get("status") || "all";
  const [statusFilter, setStatusFilter] = useState(urlStatusFilter);

  // Update local state when URL changes
  useEffect(() => {
    const newStatusFilter = searchParams.get("status") || "all";
    setStatusFilter(newStatusFilter);
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setStatusFilter(value); // Update local state immediately for UI responsiveness
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    const newUrl = `/dashboard/registrations${params.toString() ? `?${params.toString()}` : ""}`;
    
    // Use replace instead of push to avoid history buildup
    router.replace(newUrl);
  };

  // Use URL status filter as the source of truth for rendering content
  const activeFilter = searchParams.get("status") || "all";

  return (
    <Tabs value={statusFilter} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="all" disabled={isPending}>All ({counts.all})</TabsTrigger>
        <TabsTrigger value="pending" disabled={isPending}>Pending ({counts.pending})</TabsTrigger>
        <TabsTrigger value="approved" disabled={isPending}>Approved ({counts.approved})</TabsTrigger>
        <TabsTrigger value="installed" disabled={isPending}>Installed ({counts.installed})</TabsTrigger>
      </TabsList>

      <TabsContent value={statusFilter} key={activeFilter} className="mt-6">
        {isPending ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        ) : (
          children
        )}
      </TabsContent>
    </Tabs>
  );
}
