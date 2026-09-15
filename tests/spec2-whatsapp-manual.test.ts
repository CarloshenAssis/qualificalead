import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManualWhatsappAction, buildManualWhatsappLog } from '@/lib/whatsapp/manual';
import { JOB_TYPES } from '@/types/spec2';

/**
 * WhatsApp e manual (SPEC 2.0 §22/§33.5/§37 item 9).
 *
 * A segunda metade deste arquivo nao testa uma funcao: testa uma **ausencia**. A
 * decisao de nao automatizar WhatsApp so vale enquanto ninguem adicionar um cliente
 * de API "so para um caso". Uma promessa em comentario nao impede isso; um teste que
 * varre o codigo, sim.
 */

describe('acao manual de WhatsApp (SPEC 2.0 §22.1)', () => {
  it('monta link wa.me com o texto sugerido', () => {
    const action = buildManualWhatsappAction({
      companyName: 'Clinica Sorriso',
      phone: '(12) 98888-7777',
      senderName: 'Carlos',
    });

    expect(action.link).toContain('https://wa.me/5512988887777');
    expect(action.normalizedPhone).toBe('5512988887777');
    expect(action.displayPhone).toBe('(12) 98888-7777');
    expect(action.requiresManualSend).toBe(true);
  });

  it('o texto sugerido vai codificado na URL', () => {
    const action = buildManualWhatsappAction({
      companyName: 'Padaria Sao Jose',
      phone: '11999998888',
    });
    expect(action.link).toContain('?text=');
    expect(action.link).not.toContain(' ');
  });

  it('telefone invalido nao vira link chutado', () => {
    for (const phone of [null, '', '123', 'sem numero']) {
      const action = buildManualWhatsappAction({ companyName: 'Empresa', phone });
      expect(action.link, String(phone)).toBeNull();
      expect(action.normalizedPhone, String(phone)).toBeNull();
    }
  });

  it('sem observacao com evidencia, a mensagem fica generica em vez de inventar (§3.3)', () => {
    const semEvidencia = buildManualWhatsappAction({
      companyName: 'Empresa X',
      phone: '11999998888',
    });
    expect(semEvidencia.suggestedMessage).not.toContain('undefined');
    expect(semEvidencia.suggestedMessage).toContain('Empresa X');

    const comEvidencia = buildManualWhatsappAction({
      companyName: 'Empresa X',
      phone: '11999998888',
      observation: 'Vi que o site de voces nao tem formulario de contato.',
    });
    expect(comEvidencia.suggestedMessage).toContain('formulario de contato');
  });

  it('a interacao registrada e sempre manual', () => {
    const log = buildManualWhatsappLog('company-1', 'contact-1', 'Cliente pediu orcamento.', '2026-09-15T12:00:00Z');
    expect(log.recordedManually).toBe(true);
  });
});

describe('ausencia de automacao de WhatsApp (SPEC 2.0 §33.5)', () => {
  const ROOTS = ['lib', 'app', 'components', 'types'];

  function sourceFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    return entries.flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(path) ? [path] : [];
    });
  }

  const files = ROOTS.flatMap((root) => sourceFiles(root));

  it('encontra os arquivos de codigo (guarda contra um teste que passa por engano)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('nenhum arquivo fala com uma API de WhatsApp', () => {
    /** Assinaturas de envio automatizado: API oficial, bibliotecas nao oficiais e credenciais. */
    const forbidden = [
      'graph.facebook.com',
      'whatsapp-web.js',
      'whatsapp_business',
      'whatsappbusiness',
      'baileys',
      'venom-bot',
      'wppconnect',
      'WHATSAPP_TOKEN',
      'WHATSAPP_API',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_WEBHOOK',
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8').toLowerCase();
      for (const pattern of forbidden) {
        if (content.includes(pattern.toLowerCase())) offenders.push(`${file}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('nenhum tipo de job envolve WhatsApp', () => {
    for (const type of JOB_TYPES) {
      expect(type.toUpperCase(), type).not.toContain('WHATSAPP');
    }
  });

  it('nenhuma rota de API atende WhatsApp', () => {
    const routes = sourceFiles('app').filter((file) => file.endsWith('route.ts'));
    for (const route of routes) {
      expect(route.toLowerCase(), route).not.toContain('whatsapp');
    }
  });

  it('o unico uso de wa.me e a abertura manual da conversa', () => {
    const usages = files.filter((file) => readFileSync(file, 'utf8').includes('wa.me'));
    expect(usages.sort()).toEqual(['lib/whatsapp/manual.ts', 'lib/whatsapp/phone.ts']);
  });
});
