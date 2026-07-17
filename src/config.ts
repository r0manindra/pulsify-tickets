import type jwt from 'jsonwebtoken';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  adminSecret: process.env.API_ADMIN_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  jwt: {
    secret: process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || '',
    issuer:
      process.env.JWT_ISSUER ||
      (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/auth/v1` : 'pulsify-issuer'),
    audience: process.env.JWT_AUDIENCE || 'authenticated',
    algorithm: (process.env.JWT_ALGORITHM || 'HS256') as jwt.Algorithm,
  },
} as const;
