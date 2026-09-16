'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
import { mayCallApify } from '@/lib/pilot/config';
import { readApifyConfig } from '@/lib/apify/config';
import { ApifyProspectingProvider } from '@/lib/apify/adapter';
const schema=z.object({name:z.string().min(2),segment:z.string().min(2),location:z.string().min(2),limit:z.coerce.number().int().min(1).max(50),cost:z.coerce.number().int().min(0)});
export async function createCampaign(form:FormData){const user=await requireUser();const value=schema.parse(Object.fromEntries(form));const [city,state]=value.location.split(',').map(x=>x.trim());const db=await createClient();const {error}=await db.from('campaigns').insert({user_id:user.id,name:value.name,segment:value.segment,city,state:state||null,max_companies:value.limit,apify_budget_minor:value.cost,budget_limit_cents:value.cost,status:'PAUSED',daily_send_limit:20,max_email_contacts:Math.min(value.limit,50)});if(error)throw new Error(error.message);revalidatePath('/campaigns');}
export async function pauseCampaign(form:FormData){const user=await requireUser();const id=z.string().uuid().parse(form.get('id'));const db=await createClient();await db.from('campaigns').update({status:'PAUSED'}).eq('id',id).eq('user_id',user.id);revalidatePath('/campaigns');}

export async function startCampaignCollection(form:FormData){
 const user=await requireUser();
 if(!mayCallApify())throw new Error('A integração Apify está desativada.');
 const campaignId=z.string().uuid().parse(form.get('id'));const db=await createClient();
 const {data:campaign,error}=await db.from('campaigns').select('id,segment,city,state,max_companies,apify_budget_minor,status').eq('id',campaignId).eq('user_id',user.id).single();
 if(error||!campaign)throw new Error(error?.message??'Campanha não encontrada.');
 if(!['READY','PAUSED'].includes(campaign.status))throw new Error('Estado da campanha não permite coleta.');
 const config=readApifyConfig();const limit=Math.min(campaign.max_companies,config.APIFY_MAX_RESULTS_PER_RUN);
 const budget=campaign.apify_budget_minor??0;if(limit<1||budget<0||budget>config.APIFY_MAX_COST_CENTS_PER_CAMPAIGN)throw new Error('Limite ou orçamento Apify inválido.');
 const input={campaignId,niche:campaign.segment??'',location:[campaign.city,campaign.state].filter(Boolean).join(', '),limit,maxCostCents:budget};
 const run=await new ApifyProspectingProvider(config).start(input);
 const {error:persistError}=await db.rpc('start_apify_collection',{p_campaign_id:campaignId,p_run_id:run.runId,p_dataset_id:run.datasetId,p_input:input,p_amount_minor:run.costCents});
 if(persistError)throw new Error(persistError.message);
 revalidatePath('/campaigns');
}
