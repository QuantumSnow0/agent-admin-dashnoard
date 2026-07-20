export type HomePromoCtaAction =
  | "register_safaricom"
  | "register_airtel"
  | "leads";

export type HomePromo = {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string;
  cta_label: string;
  cta_action: HomePromoCtaAction;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export const HOME_PROMO_CTA_OPTIONS: {
  value: HomePromoCtaAction;
  label: string;
}[] = [
  { value: "register_safaricom", label: "Onboard Safaricom" },
  { value: "register_airtel", label: "Onboard Airtel" },
  { value: "leads", label: "Open Leads" },
];

export function isHomePromoCtaAction(
  value: string,
): value is HomePromoCtaAction {
  return (
    value === "register_safaricom" ||
    value === "register_airtel" ||
    value === "leads"
  );
}
