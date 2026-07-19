"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, FileText, Bell, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  iconName: "dashboard" | "agents" | "registrations" | "leads" | "send-notification";
  children: React.ReactNode;
}

const iconMap = {
  dashboard: LayoutDashboard,
  agents: Users,
  registrations: FileText,
  leads: Inbox,
  "send-notification": Bell,
};

export function NavLink({ href, iconName, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");
  const Icon = iconMap[iconName];

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center space-x-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
      )}
    >
      <Icon className="h-5 w-5" />
      <span>{children}</span>
    </Link>
  );
}
