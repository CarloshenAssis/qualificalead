import 'server-only';
import type { RawBusiness } from '@/lib/prospecting/sources/types';
import type { ProspectingProvider, ProviderRun, DatasetPage } from './provider';
import { apifyItemSchema, apifyRunSchema, prospectingRequestSchema, type ProspectingRequest } from './schemas';
import type { ApifyConfig } from './config';

export class ApifyError extends Error { constructor(message: string, readonly retryable: boolean, readonly status?: number) { super(message); } }
const state = (s: string): ProviderRun['state'] => s === 'TIMED-OUT'||s === 'TIMING-OUT' ? 'TIMED_OUT' : s as ProviderRun['state'];
export function normalizeApifyItem(value: unknown): RawBusiness | null {
 const parsed=apifyItemSchema.safeParse(value); if(!parsed.success) return null; const x=parsed.data; const name=x.title??x.name; const sourceId=x.placeId??x.id; if(!name||!sourceId) return null;
 return { source:'APIFY_GOOGLE_MAPS', sourceId, name, category:x.categoryName??x.category, address:x.address, city:x.city, state:x.state, country:x.country??x.countryCode, phone:x.phoneUnformatted??x.phone, website:x.website, sourceUrl:x.url, rating:x.totalScore, reviewCount:x.reviewsCount, latitude:x.location?.lat, longitude:x.location?.lng, email:x.email, metadata:{ importedBy:'apify' } };
}
export class ApifyProspectingProvider implements ProspectingProvider {
 constructor(private readonly config: ApifyConfig, private readonly fetcher: typeof fetch = fetch) {}
 private async request(path:string, init?:RequestInit):Promise<unknown>{ const response=await this.fetcher(`https://api.apify.com/v2${path}`,{...init,headers:{ authorization:`Bearer ${this.config.APIFY_TOKEN}`,'content-type':'application/json',...init?.headers},signal:AbortSignal.timeout(15_000)}); if(!response.ok) throw new ApifyError(`Apify HTTP ${response.status}`,response.status>=500||response.status===429,response.status); return response.json(); }
 async start(raw:ProspectingRequest):Promise<ProviderRun>{ const input=prospectingRequestSchema.parse(raw); if(input.limit>this.config.APIFY_MAX_RESULTS_PER_RUN||input.maxCostCents>this.config.APIFY_MAX_COST_CENTS_PER_CAMPAIGN) throw new ApifyError('Limite ou orçamento excedido',false); const kind=this.config.APIFY_TASK_ID?'actor-tasks':'acts'; const id=encodeURIComponent(this.config.APIFY_TASK_ID??this.config.APIFY_ACTOR_ID!); const payload=await this.request(`/${kind}/${id}/runs?waitForFinish=0`,{method:'POST',body:JSON.stringify({searchStringsArray:[`${input.niche} em ${input.location}`],maxCrawledPlacesPerSearch:input.limit})}) as {data:unknown}; return this.mapRun(payload.data); }
 async getRun(runId:string){ const payload=await this.request(`/actor-runs/${encodeURIComponent(runId)}`) as {data:unknown}; return this.mapRun(payload.data); }
 async datasetPage(datasetId:string,offset:number,limit:number):Promise<DatasetPage>{ const safe=Math.min(limit,this.config.APIFY_MAX_RESULTS_PER_RUN); const items=await this.request(`/datasets/${encodeURIComponent(datasetId)}/items?offset=${offset}&limit=${safe}&clean=true`) as unknown[]; const normalized=items.map(normalizeApifyItem).filter((x):x is RawBusiness=>Boolean(x)); return {items:normalized,offset,nextOffset:items.length===safe?offset+safe:null}; }
 private mapRun(raw:unknown):ProviderRun{ const run=apifyRunSchema.parse(raw); return {runId:run.id,datasetId:run.defaultDatasetId??null,state:state(run.status),amountMinor:Math.ceil((run.usageTotalUsd??0)*100),currency:'USD'}; }
}
