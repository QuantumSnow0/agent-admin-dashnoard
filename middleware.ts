import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Temporary hard-down switch. Set ADMIN_FORCE_UNAVAILABLE=1 on Vercel
 * to return a generic 503 (looks like a normal outage, not a billing pause).
 * Remove the env var (or set to 0) to restore the dashboard.
 */
function unavailableResponse(): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>503 Service Unavailable</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #fafafa;
      color: #171717;
    }
    main { max-width: 28rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { margin: 0; color: #737373; font-size: 0.95rem; line-height: 1.5; }
    code { font-size: 0.85rem; color: #525252; }
  </style>
</head>
<body>
  <main>
    <h1>Service temporarily unavailable</h1>
    <p>The application could not be reached. Please try again later.</p>
    <p style="margin-top:1rem"><code>HTTP 503</code></p>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "3600",
    },
  });
}

export async function middleware(request: NextRequest) {
  const forced =
    process.env.ADMIN_FORCE_UNAVAILABLE === "1" ||
    process.env.ADMIN_FORCE_UNAVAILABLE === "true";

  if (forced) {
    return unavailableResponse();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
