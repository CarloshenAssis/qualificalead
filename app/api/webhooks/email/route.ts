import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readEmailConfig } from '@/lib/email/config';
import { emailWebhookSchema,verifyEmailWebhook } from '@/lib/email/webhook';
import { createAdminClient } from '@/lib/supabase/admin';

const eventType=(type:string,bounce?:string)=>({
 'email.delivered':'DELIVERED','email.complained':'COMPLAINT','email.opened':'OPENED',
 'email.clicked':'CLICKED','email.received':'REPLIED','email.bounced':bounce==='soft'?'SOFT_BOUNCE':'HARD_BOUNCE',
}[type]);

export async function POST(request:Request){
 const body=await request.text(),config=readEmailConfig();const headers={id:request.headers.get('svix-id'),timestamp:request.headers.get('svix-timestamp'),signature:request.headers.get('svix-signature')};
 if(!verifyEmailWebhook(body,headers,config.EMAIL_WEBHOOK_SECRET))return NextResponse.json({error:'unauthorized'},{status:401});
 const event=emailWebhookSchema.parse(JSON.parse(body));const type=eventType(event.type,event.data.bounce?.type);if(!type)return NextResponse.json({error:'unsupported event'},{status:422});
 const {data,error}=await createAdminClient().rpc('receive_resend_webhook',{p_provider_event_id:event.id,p_provider_message_id:event.data.email_id,p_event_type:type,p_occurred_at:event.created_at,p_payload_hash:createHash('sha256').update(body).digest('hex'),p_payload:JSON.parse(body)});
 if(error)return NextResponse.json({error:'persistence failed'},{status:500});
 return NextResponse.json({accepted:true,duplicate:data?.[0]?.duplicate??false},{status:200});
}
