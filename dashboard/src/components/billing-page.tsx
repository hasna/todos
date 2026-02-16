import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckIcon, ZapIcon, CrownIcon, BuildingIcon, SparklesIcon } from "lucide-react";

interface BillingData {
  customer: {
    id: string;
    plan: string;
    subscription_status: string | null;
    current_period_end: string | null;
    email: string | null;
  };
  usage: { metric: string; count: number }[];
  limits: Record<string, number>;
  plans: Record<string, { monthly: number; yearly: number }>;
  stripe_configured: boolean;
}

interface BillingPageProps {
  showToast: (message: string, type: "success" | "error") => void;
}

const planFeatures: Record<string, string[]> = {
  free: [
    "100 tasks",
    "3 projects",
    "5 plans",
    "1 API key",
    "Community support",
  ],
  pro: [
    "10,000 tasks",
    "50 projects",
    "100 plans",
    "10 API keys",
    "10 webhooks",
    "Priority support",
  ],
  team: [
    "100,000 tasks",
    "500 projects",
    "1,000 plans",
    "50 API keys",
    "50 webhooks",
    "Team collaboration",
    "Priority support",
  ],
  enterprise: [
    "Unlimited everything",
    "Unlimited API keys",
    "Unlimited webhooks",
    "Custom integrations",
    "Dedicated support",
    "SLA guarantee",
  ],
};

const planIcons: Record<string, React.ReactNode> = {
  free: <SparklesIcon className="size-5" />,
  pro: <ZapIcon className="size-5" />,
  team: <CrownIcon className="size-5" />,
  enterprise: <BuildingIcon className="size-5" />,
};

const planLabels: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

export function BillingPage({ showToast }: BillingPageProps) {
  const [billing, setBilling] = React.useState<BillingData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [interval, setInterval] = React.useState<"monthly" | "yearly">("monthly");
  const [upgrading, setUpgrading] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/billing")
      .then((r) => r.json())
      .then((data) => setBilling(data))
      .catch(() => showToast("Failed to load billing info", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

  async function handleUpgrade(plan: string) {
    setUpgrading(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval: interval === "yearly" ? "year" : "month" }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || "Failed to start checkout", "error");
      }
    } catch {
      showToast("Failed to start checkout", "error");
    } finally {
      setUpgrading(null);
    }
  }

  async function handleManage() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || "Failed to open billing portal", "error");
      }
    } catch {
      showToast("Failed to open billing portal", "error");
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  if (!billing) return <div className="py-8 text-center text-muted-foreground">Failed to load billing.</div>;

  const currentPlan = billing.customer.plan;
  const prices = billing.plans;

  return (
    <div className="space-y-8 max-w-5xl">
      <h2 className="text-lg font-semibold">Billing</h2>

      {/* Current Plan */}
      <div className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {planIcons[currentPlan]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">{planLabels[currentPlan]} Plan</h3>
                {billing.customer.subscription_status && billing.customer.subscription_status !== "active" && (
                  <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">
                    {billing.customer.subscription_status}
                  </Badge>
                )}
              </div>
              {billing.customer.current_period_end && (
                <p className="text-xs text-muted-foreground">
                  Renews {new Date(billing.customer.current_period_end).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          {currentPlan !== "free" && billing.stripe_configured && (
            <Button variant="outline" size="sm" onClick={handleManage}>
              Manage Subscription
            </Button>
          )}
        </div>

        {/* Usage */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(billing.limits).map(([key, limit]) => {
            const usage = billing.usage.find((u) => u.metric === key);
            const count = usage?.count || 0;
            const isUnlimited = limit === -1;
            const pct = isUnlimited ? 0 : limit > 0 ? Math.min((count / limit) * 100, 100) : 0;
            return (
              <div key={key} className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground capitalize">{key.replace("_", " ")}</p>
                <p className="text-lg font-bold">
                  {count}
                  <span className="text-xs font-normal text-muted-foreground">
                    /{isUnlimited ? "\u221e" : limit.toLocaleString()}
                  </span>
                </p>
                {!isUnlimited && (
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-yellow-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Billing interval toggle */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setInterval("monthly")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            interval === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval("yearly")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            interval === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
          }`}
        >
          Yearly
          <span className="ml-1 text-xs text-green-600 dark:text-green-400">Save 22%</span>
        </button>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["free", "pro", "team", "enterprise"] as const).map((plan) => {
          const price = prices[plan];
          const isCurrent = currentPlan === plan;
          const isPopular = plan === "pro";
          const monthlyPrice = interval === "monthly" ? price?.monthly || 0 : Math.round((price?.yearly || 0) / 12);

          return (
            <div
              key={plan}
              className={`rounded-lg border p-6 space-y-4 relative ${
                isPopular ? "border-primary shadow-md" : ""
              } ${isCurrent ? "bg-accent/30" : ""}`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">Popular</Badge>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {planIcons[plan]}
                  <h3 className="text-base font-semibold">{planLabels[plan]}</h3>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${monthlyPrice}</span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                {interval === "yearly" && plan !== "free" && (
                  <p className="text-xs text-muted-foreground">
                    ${price?.yearly || 0}/year billed annually
                  </p>
                )}
              </div>
              <ul className="space-y-2">
                {planFeatures[plan]?.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="size-4 mt-0.5 text-green-500 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2">
                {isCurrent ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Current Plan
                  </Button>
                ) : plan === "free" ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Free Forever
                  </Button>
                ) : !billing.stripe_configured ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Set STRIPE_SECRET_KEY
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleUpgrade(plan)}
                    disabled={upgrading === plan}
                  >
                    {upgrading === plan ? "Redirecting..." : "Upgrade"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!billing.stripe_configured && (
        <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Stripe is not configured. To enable paid plans, set these environment variables:
          </p>
          <div className="space-y-1">
            <code className="block text-xs bg-muted px-2 py-1 rounded">STRIPE_SECRET_KEY=sk_...</code>
            <code className="block text-xs bg-muted px-2 py-1 rounded">STRIPE_WEBHOOK_SECRET=whsec_...</code>
            <code className="block text-xs bg-muted px-2 py-1 rounded">STRIPE_PRICE_PRO_MONTH=price_...</code>
            <code className="block text-xs bg-muted px-2 py-1 rounded">STRIPE_PRICE_PRO_YEAR=price_...</code>
          </div>
        </div>
      )}
    </div>
  );
}
