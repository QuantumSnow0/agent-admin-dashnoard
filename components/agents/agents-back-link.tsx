"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { readAgentsListHref } from "@/lib/agents-list-return";

export function AgentsBackLink() {
  const [href, setHref] = useState("/dashboard/agents");

  useEffect(() => {
    setHref(readAgentsListHref());
  }, []);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
    >
      <ChevronLeft className="h-4 w-4" />
      Agents
    </Link>
  );
}
