import type { PipelineStage } from '@/types/spec2';
export type ReviewDecision='APPROVE'|'REJECT'|'RESEARCH_MORE'|'DO_NOT_CONTACT';
export function reviewTransition(current:PipelineStage,decision:ReviewDecision,confirmed=false):PipelineStage{
 if(current!=='REVIEW_PENDING')throw new Error('Lead não está pendente de revisão');
 if(decision==='APPROVE'){if(!confirmed)throw new Error('Aprovação exige confirmação explícita');return 'APPROVED_FOR_EMAIL';}
 if(decision==='DO_NOT_CONTACT')return 'DO_NOT_CONTACT';
 if(decision==='RESEARCH_MORE')return 'ENRICHED';
 return 'LOST';
}
