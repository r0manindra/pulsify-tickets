export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  adminSecret: process.env.API_ADMIN_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    platformFeePercent: parseInt(process.env.STRIPE_PLATFORM_FEE_PERCENT || '10', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
  },
} as const;
