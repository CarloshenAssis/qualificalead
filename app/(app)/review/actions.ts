'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient,requireUser } from '@/lib/supabase/server';
import { reviewTransition } from '@/lib/review/workflow';
import { isEmailStatusSendable } from '@/lib/email/sendability';

export async function decideLead(form:FormData){
 const user=await requireUser();const parsed=z.object({id:z.string().uuid(),decision:z.enum(['APPROVE','REJECT','RESEARCH_MORE','DO_NOT_CONTACT']),confirm:z.string().optional()}).parse(Object.fromEntries(form));const db=await createClient();
 const {data:lead,error:leadError}=await db.from('campaign_leads').select('id,user_id,stage,campaign_id,company_id,contact_id,qualification_id').eq('id',parsed.id).eq('user_id',user.id).single();if(leadError||!lead)throw new Error(leadError?.message??'Lead não encontrado');
 const stage=reviewTransition(lead.stage,parsed.decision,parsed.confirm==='yes');
 if(stage==='APPROVED_FOR_EMAIL'){
  if(!lead.contact_id||!lead.qualification_id)throw new Error('Contato e qualificação são obrigatórios.');
  const [{data:q,error:qError},{data:contact,error:contactError},{data:campaign,error:campaignError}]=await Promise.all([
   db.from('qualification_results').select('score_version,recommended_action,evidence_ids').eq('id',lead.qualification_id).eq('user_id',user.id).eq('company_id',lead.company_id).single(),
   db.from('contacts').select('id,email,email_normalized,email_verification_status').eq('id',lead.contact_id).eq('user_id',user.id).eq('company_id',lead.company_id).single(),
   db.from('campaigns').select('id,status,sequence_id').eq('id',lead.campaign_id).eq('user_id',user.id).single(),
  ]);
  if(qError||!q||q.score_version!==2||q.recommended_action!=='READY_FOR_EMAIL')throw new Error(qError?.message??'Qualificação READY_FOR_EMAIL v2 inválida.');
  if(contactError||!contact?.email||!isEmailStatusSendable(contact.email_verification_status))throw new Error(contactError?.message??'Contato selecionado não é enviável.');
  if(campaignError||!campaign||!['REVIEW_REQUIRED','ACTIVE','PAUSED'].includes(campaign.status)||!campaign.sequence_id)throw new Error(campaignError?.message??'Campanha ou sequência inválida.');
  const evidenceIds=(q.evidence_ids??[]) as string[];if(!evidenceIds.length)throw new Error('Aprovação exige evidências ativas.');
  const {data:evidence,error:evidenceError}=await db.from('company_observations').select('id').eq('user_id',user.id).eq('company_id',lead.company_id).in('id',evidenceIds).in('status',['OBSERVED','CONFIRMED']).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);if(evidenceError||evidence?.length!==evidenceIds.length)throw new Error(evidenceError?.message??'Evidências desatualizadas.');
  const {data:suppression,error:suppressionError}=await db.from('suppression_entries').select('id').eq('user_id',user.id).eq('scope','EMAIL').eq('value',contact.email_normalized??contact.email.toLowerCase()).limit(1);if(suppressionError)throw new Error(suppressionError.message);if(suppression?.length)throw new Error('Contato suprimido.');
  const {data:step,error:stepError}=await db.from('sequence_steps').select('id,template_id,email_templates(id,status,subject_template,body_text_template)').eq('user_id',user.id).eq('sequence_id',campaign.sequence_id).order('step_number').limit(1).single();if(stepError||!step||!step.template_id)throw new Error(stepError?.message??'Template ausente.');
  const template=step.email_templates as unknown as {id:string;status:string;subject_template:string;body_text_template:string}|null;if(!template||template.status!=='APPROVED'||!template.subject_template.trim()||!template.body_text_template.trim())throw new Error('Template ou mensagem não aprovado.');
 }
 const {data:updated,error:updateError}=await db.from('campaign_leads').update({stage,approved_at:stage==='APPROVED_FOR_EMAIL'?new Date().toISOString():null,approved_by:stage==='APPROVED_FOR_EMAIL'?user.id:null}).eq('id',parsed.id).eq('user_id',user.id).eq('stage',lead.stage).select('id').maybeSingle();if(updateError)throw new Error(updateError.message);if(!updated)throw new Error('Lead foi alterado durante a revisão.');
 const {error:auditError}=await db.from('audit_log').insert({user_id:user.id,action:`LEAD_${parsed.decision}`,entity_type:'campaign_lead',entity_id:lead.id,actor_id:user.id,data:{from:lead.stage,to:stage,confirmed:parsed.confirm==='yes'}});if(auditError)throw new Error(auditError.message);
 revalidatePath('/review');
}
