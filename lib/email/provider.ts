import 'server-only';
export type EmailPayload={from:string;replyTo?:string;to:string;subject:string;text:string;html?:string;idempotencyKey:string;unsubscribeUrl?:string};
export type EmailAcceptance={providerMessageId:string;accepted:true};
export interface EmailProvider{send(payload:EmailPayload):Promise<EmailAcceptance>}
export class AmbiguousProviderStateError extends Error { readonly retryable=false; constructor(){super('Estado desconhecido após início da requisição; retry automático proibido.');} }
