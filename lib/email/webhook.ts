import 'server-only';import{createHmac,timingSafeEqual}from'node:crypto';import{z}from'zod';
export const emailWebhookSchema=z.object({id:z.string(),type:z.enum(['email.delivered','email.bounced','email.complained','email.opened','email.clicked','email.received']),created_at:z.string(),data:z.object({email_id:z.string(),bounce:z.object({type:z.enum(['hard','soft'])}).optional()}).passthrough()});
export type SvixHeaders={id:string|null;timestamp:string|null;signature:string|null};
export function verifyEmailWebhook(body:string,headers:SvixHeaders,secret:string,now=Date.now()){
 if(!headers.id||!headers.timestamp||!headers.signature)return false;
 const seconds=Number(headers.timestamp);if(!Number.isInteger(seconds)||Math.abs(Math.floor(now/1000)-seconds)>300)return false;
 try{
  const encoded=secret.startsWith('whsec_')?secret.slice(6):secret;
  const key=Buffer.from(encoded,'base64');if(key.length===0)return false;
  const expected=createHmac('sha256',key).update(`${headers.id}.${headers.timestamp}.${body}`).digest('base64');
  return headers.signature.split(' ').some(part=>{const [version,value]=part.split(',');if(version!=='v1'||!value)return false;const a=Buffer.from(expected);const b=Buffer.from(value);return a.length===b.length&&timingSafeEqual(a,b);});
 }catch{return false;}
}
