import crypto from 'node:crypto';

/**
 * Generate a human-readable order reference.
 * Format: PUL-<6 hex chars>
 * Example: PUL-A3F8E2
 */
export function generateOrderReference(): string {
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PUL-${hex}`;
}

/**
 * Generate a human-readable ticket reference.
 * Format: PUL-<6 hex chars>-<sequence number>
 * Example: PUL-A3F8E2-1
 */
export function generateTicketReference(orderRef: string, index: number): string {
  return `${orderRef}-${index + 1}`;
}
