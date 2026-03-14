export type StripeOnboardingStatus = 'not_started' | 'pending' | 'complete';

export interface AuthPayload {
  type: 'api_key' | 'jwt';
  organizationId?: string;
  userId?: string;
}
