import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Wallet, PiggyBank } from "lucide-react";

export function CommissionLiabilityRow({
  totalEarned,
  totalPaid,
  outstanding,
}: {
  totalEarned: number;
  totalPaid: number;
  outstanding: number;
}) {
  const cards = [
    {
      title: "Total commission earned",
      value: `KSh ${totalEarned.toLocaleString()}`,
      icon: DollarSign,
      cardBg: "bg-teal-600",
    },
    {
      title: "Total paid to agents",
      value: `KSh ${totalPaid.toLocaleString()}`,
      icon: PiggyBank,
      cardBg: "bg-emerald-600",
    },
    {
      title: "Outstanding balance",
      value: `KSh ${outstanding.toLocaleString()}`,
      icon: Wallet,
      cardBg: "bg-orange-600",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ title, value, icon: Icon, cardBg }) => (
        <Card
          key={title}
          className={`relative gap-0 overflow-hidden rounded-none border-0 ${cardBg} py-4 shadow-sm transition-all hover:shadow-md`}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/5 to-transparent"
            aria-hidden
          />
          <div className="relative z-10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 pt-0">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-white/90">
                {title}
              </CardTitle>
              <div className="rounded-none bg-white/20 p-1.5">
                <Icon className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-0 pt-0">
              <div className="text-xl font-bold text-white">{value}</div>
            </CardContent>
          </div>
        </Card>
      ))}
    </div>
  );
}
