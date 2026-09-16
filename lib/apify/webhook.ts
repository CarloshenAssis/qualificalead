import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { apifyWebhookSchema } from './schemas';
export const APIFY_EVENTS=['ACTOR.RUN.SUCCEEDED','ACTOR.RUN.FAILED','ACTOR.RUN.ABORTED','ACTOR.RUN.TIMED_OUT'] as const;
function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export function verifyApifyWebhook(authorization:string|null,secret:string){if(!authorization?.startsWith('Bearer '))return false;return safeEqual(authorization.slice(7),secret)}
export function parseApifyWebhook(body:string){const parsed=apifyWebhookSchema.parse(JSON.parse(body));if(!APIFY_EVENTS.includes(parsed.eventType as typeof APIFY_EVENTS[number]))throw new Error('Evento Apify não permitido');return parsed;}
