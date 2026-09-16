import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SendEligibilityInput } from './eligibility';
import type { EmailPayload } from './provider';
import type { OutboundStore } from './controlled-send';

export type OutboundContext={userId:string;campaignLeadId:string;sequenceStepId:string;contactId:string;senderId:string;templateId:string;templateVersion:number};

/** PostgreSQL-backed state machine. AMBIGUOUS is terminal until explicit reconciliation. */
export class SupabaseOutboundStore implements OutboundStore{
 constructor(private readonly db:SupabaseClient,private readonly context:OutboundContext,private readonly eligibilityLoader:(messageId:string)=>Promise<SendEligibilityInput>){}
 async persist(payload:EmailPayload,mode:'DRY_RUN'|'LIVE'){
  const row={user_id:this.context.userId,campaign_lead_id:this.context.campaignLeadId,sequence_step_id:this.context.sequenceStepId,contact_id:this.context.contactId,sender_id:this.context.senderId,template_id:this.context.templateId,template_version:this.context.templateVersion,subject:payload.subject,body_text:payload.text,body_html:payload.html,to_email:payload.to.toLowerCase(),idempotency_key:payload.idempotencyKey,delivery_mode:mode,provider_state:'NOT_REQUESTED'};
  const {data:existing,error:readError}=await this.db.from('outbound_messages').select('id').eq('user_id',this.context.userId).eq('idempotency_key',payload.idempotencyKey).maybeSingle();if(readError)throw new Error(readError.message);if(existing)return{id:existing.id,existing:true};
  const {data,error}=await this.db.from('outbound_messages').insert(row).select('id').single();if(error){const {data:raced,error:raceError}=await this.db.from('outbound_messages').select('id').eq('user_id',this.context.userId).eq('idempotency_key',payload.idempotencyKey).single();if(raceError)throw new Error(error.message);return{id:raced.id,existing:true};}return{id:data.id,existing:false};
 }
 loadEligibility(id:string){return this.eligibilityLoader(id);}
 private async mark(id:string,values:Record<string,unknown>){const {error}=await this.db.from('outbound_messages').update(values).eq('id',id).eq('user_id',this.context.userId);if(error)throw new Error(error.message);}
 markRequesting(id:string){return this.mark(id,{provider_state:'REQUESTING'});}
 markAccepted(id:string,providerId:string){return this.mark(id,{provider_state:'ACCEPTED',provider_message_id:providerId,status:'SENT',sent_at:new Date().toISOString()});}
 markRejected(id:string,error:string){return this.mark(id,{provider_state:'REJECTED',status:'FAILED',error});}
 markAmbiguous(id:string,error:string){return this.mark(id,{provider_state:'AMBIGUOUS',error});}
}
