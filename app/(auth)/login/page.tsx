"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for error message from URL params (e.g., from middleware redirect)
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam === "admin_access_required") {
      setError("Admin access required. Please log in with an admin account.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Step 1: Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Step 2: Check if user is admin
    if (authData.user) {
      console.log("🔒 [Login] Checking admin status for user:", authData.user.id);
      
      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("is_admin, id, email, status")
        .eq("id", authData.user.id)
        .single();

      if (agentError) {
        console.error("❌ [Login] Error checking admin status:");
        console.error("   Error code:", agentError.code);
        console.error("   Error message:", agentError.message);
        console.error("   Error details:", agentError.details);
        console.error("   User ID:", authData.user.id);
        console.error("   User email:", authData.user.email);
        
        // Agent record doesn't exist - sign out and show error
        await supabase.auth.signOut();
        setError(
          `Account check failed: ${agentError.message || "Please contact support"}`
        );
        setLoading(false);
        return;
      }

      if (!agent) {
        console.error("⚠️ [Login] Agent record is null");
        await supabase.auth.signOut();
        setError("Account not found. Please contact support.");
        setLoading(false);
        return;
      }

      console.log("✅ [Login] Agent data:", {
        id: agent.id,
        email: agent.email,
        is_admin: agent.is_admin,
        status: agent.status,
      });

      if (!agent.is_admin) {
        console.error("⚠️ [Login] User is not an admin. is_admin:", agent.is_admin);
        // User is not admin - sign out and show error
        await supabase.auth.signOut();
        setError("Access denied. Admin privileges required.");
        setLoading(false);
        return;
      }

      console.log("✅ [Login] Admin access verified, redirecting to dashboard");
    }

    // Step 3: User is admin - redirect to dashboard
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold text-gray-900">
            Airtel Agents
          </h1>
          <p className="mt-2 text-sm text-gray-600">Admin Dashboard</p>
        </div>

        <Card className="border-gray-200 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-semibold">Welcome back</CardTitle>
            <CardDescription>
              Sign in to your admin account to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@airtel.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
                  {error}
                </div>
              )}
              <Button 
                type="submit" 
                className="w-full h-11 text-base font-medium" 
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-gray-500">
          © 2024 Airtel Kenya. All rights reserved.
        </p>
      </div>
    </div>
  );
}
