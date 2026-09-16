import 'server-only';import {z} from 'zod';
export const emailConfigSchema=z.object({EMAIL_PROVIDER:z.literal('resend'),RESEND_API_KEY:z.string().min(1),EMAIL_WEBHOOK_SECRET:z.string().min(16),EMAIL_FROM:z.string().email(),EMAIL_REPLY_TO:z.string().email().optional(),EMAIL_DAILY_LIMIT:z.coerce.number().int().min(1).max(50).catch(20),EMAIL_CAMPAIGN_DAILY_LIMIT:z.coerce.number().int().min(1).max(50).catch(20)});
export type EmailConfig=z.infer<typeof emailConfigSchema>;export const readEmailConfig=(env:NodeJS.ProcessEnv=process.env)=>emailConfigSchema.parse(env);
