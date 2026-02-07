import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User } from "lucide-react";
import { NavLink } from "@/components/dashboard/nav-link";
import Image from "next/image";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  // Verify user is admin
  const { data: agent, error } = await supabase
    .from("agents")
    .select("is_admin, name, email, status")
    .eq("id", user.id)
    .single();

  if (error || !agent || !agent.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "A";
  };

  const navItems = [
    {
      name: "Dashboard",
      href: "/dashboard",
      iconName: "dashboard" as const,
    },
    {
      name: "Agents",
      href: "/dashboard/agents",
      iconName: "agents" as const,
    },
    {
      name: "Registrations",
      href: "/dashboard/registrations",
      iconName: "registrations" as const,
    },
    {
      name: "Send notification",
      href: "/dashboard/send-notification",
      iconName: "send-notification" as const,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-white shadow-sm">
        <div className="flex h-full flex-col">
          {/* Logo/Brand */}
          <div className="flex h-16 items-center border-b px-6">
            <div className="flex items-center space-x-2">
  
                <Image src={"/logo.png"} alt="wam app logo" height={52} width={52}/>
              
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  Airtel Agents
                </h1>
                <p className="text-xs text-gray-500">Admin Dashboard</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href} iconName={item.iconName}>
                {item.name}
              </NavLink>
            ))}
          </nav>

          {/* User Section */}
          <div className="border-t p-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center space-x-3 rounded-lg px-3 py-2 hover:bg-gray-100">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-600 text-white">
                    {getInitials(agent.name, agent.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-gray-900">
                    {agent.name || "Admin"}
                  </p>
                  <p className="text-xs text-gray-500">{agent.email}</p>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action="/api/auth/logout" method="post">
                  <DropdownMenuItem asChild>
                    <button
                      type="submit"
                      className="w-full cursor-pointer text-red-600 focus:text-red-600"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="ml-64">
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
