import { redirect } from "next/navigation";

/** Alias for bookmark typo: /super_admin → /super-admin */
export default function SuperAdminUnderscoreAlias() {
  redirect("/super-admin");
}
