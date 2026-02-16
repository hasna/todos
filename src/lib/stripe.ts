import Stripe from "stripe";
import { getOrCreateCustomer, updateCustomer, getCustomerByStripeId, type BillingCustomer } from "../db/billing.js";

function getStripe(): Stripe | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  return new Stripe(key);
}

export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

export async function createCheckoutSession(
  plan: "pro" | "team" | "enterprise",
  interval: "month" | "year",
  successUrl: string,
  cancelUrl: string,
): Promise<{ url: string } | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customer = getOrCreateCustomer();
  let stripeCustomerId = customer.stripe_customer_id;

  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      metadata: { todos_customer_id: customer.id },
    });
    stripeCustomerId = stripeCustomer.id;
    updateCustomer(customer.id, { stripe_customer_id: stripeCustomerId });
  }

  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`];
  if (!priceId) return null;

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { url: session.url || "" };
}

export async function createPortalSession(returnUrl: string): Promise<{ url: string } | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customer = getOrCreateCustomer();
  if (!customer.stripe_customer_id) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: returnUrl,
  });

  return { url: session.url };
}

export async function handleWebhook(body: string, signature: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;

  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!webhookSecret) return false;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return false;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.customer && session.subscription) {
        const customer = getCustomerByStripeId(session.customer as string);
        if (customer) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const plan = (sub.metadata?.["plan"] || "pro") as BillingCustomer["plan"];
          updateCustomer(customer.id, {
            plan,
            stripe_subscription_id: sub.id,
            subscription_status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          });
        }
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customer = getCustomerByStripeId(sub.customer as string);
      if (customer) {
        updateCustomer(customer.id, {
          subscription_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          plan: sub.status === "canceled" ? "free" : customer.plan,
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer) {
        const customer = getCustomerByStripeId(invoice.customer as string);
        if (customer) {
          updateCustomer(customer.id, { subscription_status: "past_due" });
        }
      }
      break;
    }
  }

  return true;
}
