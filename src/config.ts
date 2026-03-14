export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  adminSecret: process.env.API_ADMIN_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  tito: {
    apiToken: process.env.TITO_API_TOKEN || '',
    accountSlug: process.env.TITO_ACCOUNT_SLUG || '',
    webhookSecret: process.env.TITO_WEBHOOK_SECRET || '',
    baseUrl: 'https://api.tito.io/v3',
    checkinBaseUrl: 'https://checkin.tito.io',
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
  },
} as const;
