'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';
const schema=z.object({name:z.string().min(2),segment:z.string().min(2),location:z.string().min(2),limit:z.coerce.number().int().min(1).max(50),cost:z.coerce.number().int().min(0)});
export async function createCampaign(form:FormData){const user=await requireUser();const value=schema.parse(Object.fromEntries(form));const [city,state]=value.location.split(',').map(x=>x.trim());const db=await createClient();const {error}=await db.from('campaigns').insert({user_id:user.id,name:value.name,segment:value.segment,city,state:state||null,max_companies:value.limit,budget_limit_cents:value.cost,status:'PAUSED',daily_send_limit:20,max_email_contacts:Math.min(value.limit,50)});if(error)throw new Error(error.message);revalidatePath('/campaigns');}
export async function pauseCampaign(form:FormData){const user=await requireUser();const id=z.string().uuid().parse(form.get('id'));const db=await createClient();await db.from('campaigns').update({status:'PAUSED'}).eq('id',id).eq('user_id',user.id);revalidatePath('/campaigns');}

import { mayCallApify } from '@/lib/pilot/config';
import { readApifyConfig } from '@/lib/apify/config';
import { ApifyProspectingProvider } from '@/lib/apify/adapter';
import { startCampaignRun } from '@/lib/apify/start-campaign';
import { SupabaseCampaignRunRepository } from '@/lib/apify/supabase-run-repository';
export async function startCampaignCollection(form:FormData){const user=await requireUser();const id=z.string().uuid().parse(form.get('id'));if(!mayCallApify())throw new Error('Coleta Apify está desabilitada. Defina APIFY_ENABLED=true após validar limites.');const db=await createClient();await startCampaignRun(user.id,id,new ApifyProspectingProvider(readApifyConfig()),new SupabaseCampaignRunRepository(db));revalidatePath('/campaigns');}
