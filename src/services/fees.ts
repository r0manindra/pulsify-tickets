/**
 * Platform fee calculation based on organization tier.
 *
 * Freemium: 10% + 1€ per ticket
 * Basic:     8% + 1€ per ticket
 * Premium:   5% + 1€ per ticket
 */

const TIER_FEES: Record<string, { percent: number; fixedPerTicketCents: number }> = {
  freemium: { percent: 10, fixedPerTicketCents: 100 },
  basic:    { percent: 8,  fixedPerTicketCents: 100 },
  premium:  { percent: 5,  fixedPerTicketCents: 100 },
};

/**
 * Calculate the platform fee in cents.
 *
 * @param tier - Organization tier (freemium, basic, premium)
 * @param totalAmountCents - Total order amount in cents
 * @param ticketQuantity - Number of tickets in the order
 * @returns Platform fee in cents
 */
export function calculatePlatformFee(
  tier: string,
  totalAmountCents: number,
  ticketQuantity: number,
): number {
  const fees = TIER_FEES[tier] ?? TIER_FEES.freemium;
  const percentageFee = Math.round(totalAmountCents * fees.percent / 100);
  const fixedFee = fees.fixedPerTicketCents * ticketQuantity;
  return percentageFee + fixedFee;
}
