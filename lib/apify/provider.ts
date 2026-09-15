import type { RawBusiness } from '@/lib/prospecting/sources/types';
import type { ProspectingRequest } from './schemas';
export type RunState = 'RUNNING'|'SUCCEEDED'|'FAILED'|'ABORTED'|'TIMED_OUT';
export type ProviderRun = { runId: string; datasetId: string | null; state: RunState; costCents: number };
export type DatasetPage = { items: RawBusiness[]; offset: number; nextOffset: number | null };
export interface ProspectingProvider { start(input: ProspectingRequest): Promise<ProviderRun>; getRun(runId: string): Promise<ProviderRun>; datasetPage(datasetId: string, offset: number, limit: number): Promise<DatasetPage> }
