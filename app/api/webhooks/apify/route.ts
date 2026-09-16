import { NextResponse } from 'next/server';
import { readApifyConfig } from '@/lib/apify/config';
import { parseApifyWebhook, verifyApifyWebhook } from '@/lib/apify/webhook';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
export async function POST(request:Request){
 const body=await request.text();const config=readApifyConfig();
 if(!verifyApifyWebhook(body,request.headers.get('authorization'),config.APIFY_WEBHOOK_SECRET))return NextResponse.json({error:'unauthorized'},{status:401});
 const event=parseApifyWebhook(body);const status=event.resource?.status;
 const terminal:Record<string,string>={SUCCEEDED:'SUCCEEDED',FAILED:'FAILED',ABORTED:'ABORTED','TIMED-OUT':'TIMED_OUT'};
 if(!status||!terminal[status])return NextResponse.json({error:'unsupported event state'},{status:422});
 const db=createAdminClient();const {data,error}=await db.rpc('receive_apify_webhook',{p_run_id:event.eventData.actorRunId,p_status:terminal[status],p_dataset_id:event.resource?.defaultDatasetId??null,p_payload_hash:createHash('sha256').update(body).digest('hex'),p_payload:JSON.parse(body)});
 if(error)return NextResponse.json({error:'persistence failed'},{status:500});
 return NextResponse.json({accepted:true,duplicate:data?.[0]?.duplicate??false},{status:200});
}
