import Stripe from 'stripe';
import { config } from '../config.js';

const stripe = new Stripe(config.stripe.secretKey);

export { stripe };

/**
 * Create a Stripe Express Connected Account for a business.
 */
export async function createConnectedAccount(organizationName: string) {
  return stripe.accounts.create({
    type: 'express',
    business_type: 'company',
    company: { name: organizationName },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

/**
 * Generate onboarding link for a connected account.
 */
export async function createOnboardingLink(accountId: string, orgId: string) {
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${config.appUrl}/api/v1/orgs/${orgId}/stripe-status`,
    return_url: `${config.appUrl}/api/v1/orgs/${orgId}/stripe-status`,
    type: 'account_onboarding',
  });
}

/**
 * Check if a connected account can accept charges.
 */
export async function getAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

/**
 * Create a Stripe Checkout Session with platform fee (application_fee_amount).
 */
export async function createCheckoutSession(params: {
  connectedAccountId: string;
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  orderId: string;
  platformFeeAmount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  metadata?: Record<string, string>;
}) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: params.lineItems,
    payment_intent_data: {
      application_fee_amount: params.platformFeeAmount,
      transfer_data: {
        destination: params.connectedAccountId,
      },
    },
    customer_email: params.customerEmail,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      orderId: params.orderId,
      ...params.metadata,
    },
  });
}

/**
 * Create a refund for a payment intent.
 */
export async function createRefund(paymentIntentId: string, amount?: number) {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amount ? { amount } : {}),
  });
}

/**
 * Verify and construct a Stripe webhook event.
 */
export function constructWebhookEvent(body: string, signature: string) {
  return stripe.webhooks.constructEvent(body, signature, config.stripe.webhookSecret);
}
