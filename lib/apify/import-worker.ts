import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { readApifyConfig } from './config';
import { ApifyProspectingProvider } from './adapter';
import { ingestDataset } from './ingestion';

const PAGE_SIZE = 50;
type ImportJob = { id:string;user_id:string;campaign_id:string;attempts:number;max_attempts:number;payload:{campaignSourceId:string;datasetId:string} };

/** Durable, resumable dataset importer. Only a successfully acquired DB lease may work. */
export async function importApifyDataset(jobId:string,workerId=randomUUID()){
 const db=createAdminClient();const now=new Date().toISOString();const lockUntil=new Date(Date.now()+60_000).toISOString();
 const {data:claimed,error:lockError}=await db.from('jobs').update({status:'RUNNING',locked_by:workerId,locked_until:lockUntil,started_at:now}).eq('id',jobId).in('status',['PENDING','FAILED']).or(`locked_until.is.null,locked_until.lt.${now}`).select('id,user_id,campaign_id,attempts,max_attempts,payload').maybeSingle();
 if(lockError)throw new Error(lockError.message);if(!claimed)return {kind:'NOT_CLAIMED' as const};
 const job=claimed as ImportJob;const provider=new ApifyProspectingProvider(readApifyConfig());
 const {data:source,error:sourceError}=await db.from('campaign_sources').select('id,external_dataset_id,import_offset,items_imported,campaign_id,user_id').eq('id',job.payload.campaignSourceId).eq('user_id',job.user_id).single();
 if(sourceError||!source)throw new Error(sourceError?.message??'Campaign source missing');
 const datasetId=source.external_dataset_id??job.payload.datasetId;if(!datasetId)throw new Error('Apify dataset id missing');
 try{
  let offset=source.import_offset;let imported=source.items_imported;
  for(;;){
   const page=await provider.datasetPage(datasetId,offset,PAGE_SIZE);const rows=ingestDataset(page.items,new Set());
   for(const row of rows){
    const b=row.business;const dedupKey=`apify:${b.sourceId}`;
    const {data:company,error:companyError}=await db.from('companies').upsert({user_id:job.user_id,name:b.name,category:b.category,address:b.address,city:b.city,state:b.state,country:b.country,phone:b.phone,phone_international:b.phoneInternational,website:b.website,google_maps_url:b.sourceUrl,rating:b.rating,review_count:b.reviewCount,latitude:b.latitude,longitude:b.longitude,operational_dedupe_key:dedupKey,source_data:b.metadata},{onConflict:'user_id,operational_dedupe_key'}).select('id').single();
    if(companyError)throw new Error(companyError.message);
    const {error:originError}=await db.from('lead_sources').upsert({user_id:job.user_id,company_id:company.id,source:'APIFY_GOOGLE_MAPS',source_id:b.sourceId,source_url:b.sourceUrl,raw_data:b},{onConflict:'user_id,source,source_id'});if(originError)throw new Error(originError.message);
    if(b.email){const normalized=b.email.trim().toLowerCase();const {error}=await db.from('contacts').upsert({user_id:job.user_id,company_id:company.id,email:b.email,email_normalized:normalized,source:'APIFY_GOOGLE_MAPS',source_url:b.sourceUrl,confidence:'LOW',email_verification_status:'UNKNOWN'},{onConflict:'user_id,company_id,email_normalized'});if(error)throw new Error(error.message);}
    const importKey=`apify:${datasetId}:${b.sourceId}:WEBSITE_REACHABLE`;const {error:observationError}=await db.from('company_observations').upsert({user_id:job.user_id,company_id:company.id,type:'WEBSITE_REACHABLE',value:null,source_url:b.sourceUrl??b.website??null,source_type:'APIFY_DATASET',confidence:'LOW',raw_evidence:{datasetId,sourceId:b.sourceId},status:'OBSERVED',import_key:importKey},{onConflict:'user_id,import_key'});if(observationError)throw new Error(observationError.message);
    const {error:leadError}=await db.from('campaign_leads').upsert({user_id:job.user_id,campaign_id:job.campaign_id,company_id:company.id,stage:'REVIEW_PENDING'},{onConflict:'campaign_id,company_id'});if(leadError)throw new Error(leadError.message);imported++;
   }
   offset=page.nextOffset??offset+page.items.length;const done=page.nextOffset===null;
   const {error:checkpointError}=await db.from('campaign_sources').update({import_offset:offset,items_imported:imported,...(done?{status:'SUCCEEDED',finished_at:new Date().toISOString()}:{})}).eq('id',source.id).eq('user_id',job.user_id);if(checkpointError)throw new Error(checkpointError.message);
   if(done)break;
  }
  const {error:finishError}=await db.from('jobs').update({status:'SUCCEEDED',progress:100,finished_at:new Date().toISOString(),locked_by:null,locked_until:null}).eq('id',job.id).eq('locked_by',workerId);if(finishError)throw new Error(finishError.message);
  await db.from('job_events').insert({user_id:job.user_id,job_id:job.id,type:'SUCCEEDED',data:{datasetId,imported}});
  return {kind:'SUCCEEDED' as const,imported};
 }catch(error){
  const attempts=job.attempts+1;const dead=attempts>=job.max_attempts;await db.from('jobs').update({status:dead?'DEAD_LETTER':'PENDING',attempts,error:error instanceof Error?error.message:'Unknown import error',scheduled_for:new Date(Date.now()+Math.min(3600,2**attempts*30)*1000).toISOString(),dead_lettered_at:dead?new Date().toISOString():null,locked_by:null,locked_until:null}).eq('id',job.id).eq('locked_by',workerId);
  await db.from('job_events').insert({user_id:job.user_id,job_id:job.id,type:dead?'DEAD_LETTER':'RETRY',message:error instanceof Error?error.message:'Unknown import error',data:{attempts}});throw error;
 }
}
