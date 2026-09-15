import 'server-only';
import { z } from 'zod';
const positive = (fallback: number) => z.coerce.number().int().positive().catch(fallback);
export const apifyConfigSchema = z.object({ APIFY_ENABLED: z.string().optional(), APIFY_TOKEN: z.string().min(1), APIFY_ACTOR_ID: z.string().min(1).optional(), APIFY_TASK_ID: z.string().min(1).optional(), APIFY_WEBHOOK_SECRET: z.string().min(16), APIFY_MAX_RESULTS_PER_RUN: positive(50), APIFY_MAX_COST_CENTS_PER_CAMPAIGN: positive(2000), APP_BASE_URL: z.string().url() }).superRefine((v,ctx) => { if (Boolean(v.APIFY_ACTOR_ID) === Boolean(v.APIFY_TASK_ID)) ctx.addIssue({ code:'custom', message:'Configure exatamente um de APIFY_ACTOR_ID ou APIFY_TASK_ID' }); });
export type ApifyConfig = z.infer<typeof apifyConfigSchema>;
export function readApifyConfig(env: NodeJS.ProcessEnv = process.env): ApifyConfig { return apifyConfigSchema.parse(env); }
export function publicApifyConfig(config: ApifyConfig) { return { enabled: config.APIFY_ENABLED === 'true', maxResults: config.APIFY_MAX_RESULTS_PER_RUN, maxCostCents: config.APIFY_MAX_COST_CENTS_PER_CAMPAIGN }; }
