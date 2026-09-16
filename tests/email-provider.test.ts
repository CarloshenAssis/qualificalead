import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SendEligibilityInput } from '@/lib/email/eligibility';
import { controlledSend, type OutboundStore } from '@/lib/email/controlled-send';
import { ResendEmailProvider } from '@/lib/email/providers/resend';
import { AmbiguousProviderStateError, type EmailPayload } from '@/lib/email/provider';
import { verifyResendWebhook } from '@/lib/email/webhook';
const payload: EmailPayload={from:'a@example.com',to:'b@example.com',subject:'Oi',text:'Identidade\nSair',idempotencyKey:'k'};
const eligible: SendEligibilityInput={campaignStatus:'ACTIVE',leadStage:'APPROVED_FOR_EMAIL',leadApproved:true,contactEmail:'b@example.com',emailVerificationStatus:'VALID',isSuppressed:false,hasReplied:false,hasHardBounced:false,hasUnsubscribed:false,alreadySentForStep:false,hoursSinceLastSend:null,minIntervalHours:24,senderIsActive:true,senderSpf:'PASS',senderDkim:'PASS',senderDmarc:'PASS',senderSentToday:0,senderDailyLimit:20,campaignSentToday:0,campaignDailyLimit:20,templateStatus:'APPROVED',messageHasIdentityAndOptOut:true,withinSendingWindow:true};
function store(){return {persist:vi.fn(async()=>({id:'m1',existing:false})),markAccepted:vi.fn()} as OutboundStore}
describe('envio controlado',()=>{
 it('dry-run persiste sem chamar provedor',async()=>{const provider={send:vi.fn()},s=store();expect(await controlledSend({payload,eligibility:eligible,provider,store:s,env:{NODE_ENV:'production'} as NodeJS.ProcessEnv})).toMatchObject({kind:'DRY_RUN'});expect(provider.send).not.toHaveBeenCalled()});
 it('envio real exige gates',async()=>{const provider={send:vi.fn(async()=>({accepted:true as const,providerMessageId:'r1'}))},s=store();const env={NODE_ENV:'production',EMAIL_SENDING_ENABLED:'true',EMAIL_DRY_RUN:'false',POSTGRES_VALIDATED:'true',EMAIL_DNS_VALIDATED:'true'} as NodeJS.ProcessEnv;expect(await controlledSend({payload,eligibility:eligible,provider,store:s,env})).toMatchObject({kind:'SENT'})});
 it('duplicata nunca chama provider',async()=>{const provider={send:vi.fn()},s=store();vi.mocked(s.persist).mockResolvedValue({id:'m1',existing:true});expect(await controlledSend({payload,eligibility:eligible,provider,store:s})).toMatchObject({kind:'DUPLICATE'});expect(provider.send).not.toHaveBeenCalled()});
 it('timeout iniciado é ambíguo',async()=>{const p=new ResendEmailProvider('secret',vi.fn(async()=>{throw new TypeError('network')}) as typeof fetch);await expect(p.send(payload)).rejects.toBeInstanceOf(AmbiguousProviderStateError)});
 it('adapter usa header idempotente',async()=>{const f=vi.fn(async(url:string,init?:RequestInit)=>{expect(url).not.toContain('secret');expect(init?.headers).toMatchObject({'Idempotency-Key':'k'});return new Response('{"id":"r1"}',{status:200})});expect(await new ResendEmailProvider('secret',f as typeof fetch).send(payload)).toMatchObject({providerMessageId:'r1'})});
 it('valida Svix e tolerância',()=>{const body='{"type":"email.sent"}',id='msg_1',timestamp='1700000000',secret='whsec_'+Buffer.from('secret').toString('base64');const signature=createHmac('sha256',Buffer.from('secret')).update(`${id}.${timestamp}.${body}`).digest('base64');const headers={id,timestamp,signature:`v1,${signature}`};expect(verifyResendWebhook(body,headers,secret,1700000000*1000)).toBe(true);expect(verifyResendWebhook(body,headers,secret,1700001000*1000)).toBe(false)});
});
