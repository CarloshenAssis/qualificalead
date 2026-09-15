import { NextResponse } from 'next/server';
import { readApifyConfig } from '@/lib/apify/config';
import { parseApifyWebhook, verifyApifyWebhook } from '@/lib/apify/webhook';
export async function POST(request:Request){ const body=await request.text(); const config=readApifyConfig(); if(!verifyApifyWebhook(body,request.headers.get('x-apify-signature'),config.APIFY_WEBHOOK_SECRET))return NextResponse.json({error:'unauthorized'},{status:401}); const event=parseApifyWebhook(body); return NextResponse.json({accepted:true,runId:event.eventData.actorRunId,job:'IMPORT_APIFY_DATASET'},{status:202}); }
