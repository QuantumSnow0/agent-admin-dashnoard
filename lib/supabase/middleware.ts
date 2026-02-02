import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect /dashboard routes - redirect to login if not authenticated
  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/api/auth")
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Check admin access for dashboard routes
  if (
    user &&
    request.nextUrl.pathname.startsWith("/dashboard") &&
    !request.nextUrl.pathname.startsWith("/api/auth")
  ) {
    console.log("🔒 [Middleware] Checking admin access for user:", user.id);
    console.log("🔒 [Middleware] User email:", user.email);
    
    // Check if user is admin
    const { data: agent, error } = await supabase
      .from("agents")
      .select("is_admin, id, email, status")
      .eq("id", user.id)
      .single();

    // Detailed error logging
    if (error) {
      console.error("❌ [Middleware] Error checking admin status:");
      console.error("   Error code:", error.code);
      console.error("   Error message:", error.message);
      console.error("   Error details:", error.details);
      console.error("   Error hint:", error.hint);
      console.error("   User ID:", user.id);
      console.error("   User email:", user.email);
      
      // Check if it's a column error (column doesn't exist)
      const errorMessage = error.message || "";
      if (
        errorMessage.includes("column") ||
        errorMessage.includes("is_admin") ||
        error.code === "42703" // PostgreSQL error code for undefined column
      ) {
        console.error("⚠️ [Middleware] is_admin column not found. Please run add_admin_role.sql migration.");
        // Allow access for now (during development)
        return supabaseResponse;
      }

      // Check if agent record doesn't exist
      if (error.code === "PGRST116" || errorMessage.includes("No rows found")) {
        console.error("⚠️ [Middleware] Agent record not found for user:", user.id);
        console.error("   User needs to have a record in the agents table.");
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "agent_not_found");
        return NextResponse.redirect(url);
      }

      // For RLS errors
      if (error.code === "42501" || errorMessage.includes("permission denied") || errorMessage.includes("row-level security")) {
        console.error("⚠️ [Middleware] RLS policy blocking access. Check admin RLS policies.");
        console.error("   Make sure you've run: add_admin_rls_policies.sql");
      }

      // For other errors, deny access
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "admin_check_failed");
      return NextResponse.redirect(url);
    }

    console.log("✅ [Middleware] Agent data retrieved:", {
      id: agent?.id,
      email: agent?.email,
      is_admin: agent?.is_admin,
      status: agent?.status,
    });

    // If agent record doesn't exist or user is not admin, deny access
    if (!agent) {
      console.error("⚠️ [Middleware] Agent record is null");
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "agent_not_found");
      return NextResponse.redirect(url);
    }

    if (!agent.is_admin) {
      console.error("⚠️ [Middleware] User is not an admin. is_admin:", agent.is_admin);
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "admin_access_required");
      return NextResponse.redirect(url);
    }

    console.log("✅ [Middleware] Admin access granted");
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely.

  return supabaseResponse;
}
