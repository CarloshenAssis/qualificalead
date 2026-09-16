import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { apifyWebhookSchema } from './schemas';
export function verifyApifyWebhook(_body:string,authorization:string|null,secret:string){
 if(!authorization?.startsWith('Bearer '))return false;
 const supplied=Buffer.from(authorization.slice(7));const expected=Buffer.from(secret);
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
export function parseApifyWebhook(body:string){ return apifyWebhookSchema.parse(JSON.parse(body)); }
