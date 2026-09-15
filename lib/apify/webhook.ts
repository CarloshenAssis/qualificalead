import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { apifyWebhookSchema } from './schemas';
export function verifyApifyWebhook(body:string,signature:string|null,secret:string){ if(!signature)return false; const expected=createHmac('sha256',secret).update(body).digest('hex'); const supplied=signature.replace(/^sha256=/,''); return supplied.length===expected.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)); }
export function parseApifyWebhook(body:string){ return apifyWebhookSchema.parse(JSON.parse(body)); }
