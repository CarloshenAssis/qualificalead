import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/apify-dataset.json';
import { ApifyProspectingProvider } from '@/lib/apify/adapter';
import { apifyConfigSchema, publicApifyConfig } from '@/lib/apify/config';
import { ingestDataset } from '@/lib/apify/ingestion';
import { verifyApifyWebhook } from '@/lib/apify/webhook';
const config=apifyConfigSchema.parse({APIFY_TOKEN:'secret-token',APIFY_ACTOR_ID:'actor',APIFY_WEBHOOK_SECRET:'1234567890123456',APP_BASE_URL:'https://app.example',APIFY_MAX_RESULTS_PER_RUN:'20',APIFY_MAX_COST_CENTS_PER_CAMPAIGN:'500'});
describe('Apify adapter',()=>{
 it('exige exatamente actor ou task e nunca publica token',()=>{expect(()=>apifyConfigSchema.parse({...config,APIFY_TASK_ID:'task'})).toThrow();expect(JSON.stringify(publicApifyConfig(config))).not.toContain('secret-token');});
 it('inicia run assíncrono sem token na URL',async()=>{const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{expect(url).not.toContain('secret-token');expect(init?.headers).toMatchObject({authorization:'Bearer secret-token'});return new Response(JSON.stringify({data:{id:'r1',status:'RUNNING',defaultDatasetId:'d1'}}),{status:201});});const provider=new ApifyProspectingProvider(config,fetcher as typeof fetch);expect(await provider.start({campaignId:'c',niche:'dentista',location:'Recife',limit:20,maxCostCents:500})).toMatchObject({runId:'r1',state:'RUNNING'});});
 it('bloqueia orçamento e resultado antes da chamada',async()=>{const fetcher=vi.fn();const p=new ApifyProspectingProvider(config,fetcher as typeof fetch);await expect(p.start({campaignId:'c',niche:'dentista',location:'Recife',limit:21,maxCostCents:500})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it('pagina e normaliza dataset',async()=>{const fetcher=vi.fn(async()=>new Response(JSON.stringify(fixture),{status:200}));const page=await new ApifyProspectingProvider(config,fetcher as typeof fetch).datasetPage('d1',0,2);expect(page.items[0]).toMatchObject({name:'Clínica Sol',sourceId:'p1',city:'Recife'});expect(page.nextOffset).toBe(2);});
 it('reprocessamento deduplica por origem e domínio',()=>{const imported=ingestDataset([{source:'APIFY_GOOGLE_MAPS',sourceId:'p1',name:'A',website:'https://a.example'}],new Set());expect(imported).toHaveLength(1);expect(ingestDataset([imported[0].business],new Set(['source:APIFY_GOOGLE_MAPS:p1']))).toHaveLength(0);expect(imported[0].stage).toBe('REVIEW_PENDING');expect(imported[0].observations[0].value).toBeNull();});
 it('autentica webhook e rejeita assinatura inválida',()=>{const body='{"x":1}',secret='1234567890123456';const sig=createHmac('sha256',secret).update(body).digest('hex');expect(verifyApifyWebhook(body,sig,secret)).toBe(true);expect(verifyApifyWebhook(body,'bad',secret)).toBe(false);});
});
