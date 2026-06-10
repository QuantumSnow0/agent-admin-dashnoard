"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReactNode, useEffect, useState, useTransition } from "react";

interface RegistrationsTabsWrapperProps {
  statusFilter: string;
  counts: {
    all: number;
    pending: number;
    installed: number;
    closed: number;
    rejected: number;
    duplicate: number;
    cancelled: number;
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
  
  const urlStatusFilter = searchParams.get("status") || "all";
  const [statusFilter, setStatusFilter] = useState(urlStatusFilter);

  useEffect(() => {
    const newStatusFilter = searchParams.get("status") || "all";
    setStatusFilter(newStatusFilter);
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    const newUrl = `/dashboard/registrations${params.toString() ? `?${params.toString()}` : ""}`;
    router.replace(newUrl);
  };

  const activeFilter = searchParams.get("status") || "all";

  return (
    <Tabs value={statusFilter} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-3 sm:grid-cols-7">
        <TabsTrigger value="all" disabled={isPending}>All ({counts.all})</TabsTrigger>
        <TabsTrigger value="pending" disabled={isPending}>Pending ({counts.pending})</TabsTrigger>
        <TabsTrigger value="installed" disabled={isPending}>Installed ({counts.installed})</TabsTrigger>
        <TabsTrigger value="closed" disabled={isPending}>Closed ({counts.closed})</TabsTrigger>
        <TabsTrigger value="rejected" disabled={isPending}>Rejected ({counts.rejected})</TabsTrigger>
        <TabsTrigger value="duplicate" disabled={isPending}>Duplicate ({counts.duplicate})</TabsTrigger>
        <TabsTrigger value="cancelled" disabled={isPending}>Cancelled ({counts.cancelled})</TabsTrigger>
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
