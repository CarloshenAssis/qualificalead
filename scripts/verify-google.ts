/**
 * Smoke test da integracao com o Google (SPEC 1.1 §8/§9).
 *
 *   npm run verify:google
 *   npm run verify:google -- "Restaurante" "Sao Jose dos Campos" "SP" 20
 *
 * Le GOOGLE_MAPS_API_KEY de .env.local ou do ambiente. A chave nunca e impressa.
 * Executa uma busca real, mostra as empresas encontradas e o que o sistema derivaria
 * delas — score, classificacao, situacao do site e acao recomendada.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(file: string): void {
  try {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  } catch {
    // Arquivo opcional.
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

async function main() {
  const [segment = 'Restaurante', city = 'Sao Jose dos Campos', state = 'SP', radius = '20'] =
    process.argv.slice(2);

  if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
    console.error('FAIL  GOOGLE_MAPS_API_KEY nao configurada.');
    console.error('      Defina em .env.local e rode novamente.');
    process.exit(1);
  }

  // Importados apos carregar o env, pois os modulos leem process.env.
  const { geocodeLocation, textSearch, GooglePlacesError } = await import('../lib/google/places');
  const { normalizePlace } = await import('../lib/google/mappers');
  const { computeGoogleBusinessQuality, computeNextAction, computeOpportunityScore } = await import(
    '../lib/scoring/score'
  );
  const { normalizePhone, whatsappLink } = await import('../lib/whatsapp/phone');

  console.log(`Consulta: ${segment} em ${city}${state ? ` - ${state}` : ''} (raio ${radius} km)\n`);

  try {
    console.log('1/3  Geocodificando a regiao...');
    const center = await geocodeLocation({ city, state, country: 'Brasil' });
    console.log(
      center
        ? `PASS  Geocoding: ${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`
        : 'WARN  Geocoding nao encontrou a regiao; a busca segue sem raio.',
    );

    console.log('\n2/3  Consultando Places Text Search...');
    const places = await textSearch({
      textQuery: `${segment} em ${city}, ${state}, Brasil`,
      center,
      radiusMeters: Number(radius) * 1000,
      limit: 20,
      onPage: (info) =>
        console.log(`      pagina ${info.page}: ${info.received} resultados (total ${info.total})`),
    });

    if (!places.length) {
      console.log('WARN  A API respondeu, mas sem resultados para esta consulta.');
      process.exit(0);
    }

    console.log(`PASS  ${places.length} empresas reais retornadas pela API.\n`);

    console.log('3/3  Qualificacao das 5 primeiras:\n');

    const normalized = places.map(normalizePlace).filter((p) => p !== null).slice(0, 5);

    for (const place of normalized) {
      const scoreInput = {
        website_status: place.website_status,
        rating: place.rating,
        review_count: place.review_count,
        phone: place.phone ?? place.phone_international,
        // O smoke test nao faz enriquecimento: mede apenas os dados do Google.
        instagram_url: null,
        instagram_confidence: null,
        instagram_status: 'NOT_FOUND' as const,
        business_status: place.business_status,
        address: place.address,
        category: place.category,
        opening_hours: place.opening_hours,
        description: place.description,
        google_maps_url: place.google_maps_url,
      };

      const score = computeOpportunityScore(scoreInput);
      const quality = computeGoogleBusinessQuality(scoreInput);
      const action = computeNextAction({
        score: score.score,
        quality,
        hasPhone: Boolean(normalizePhone(place.phone ?? place.phone_international)),
        websiteStatus: place.website_status,
        businessStatus: place.business_status,
      });

      console.log(`  ${place.name}`);
      console.log(`    categoria .... ${place.category ?? 'nao informada'}`);
      console.log(
        `    avaliacao .... ${place.rating ?? 'nao informada'} (${place.review_count ?? 0} avaliacoes)`,
      );
      console.log(`    telefone ..... ${place.phone ?? 'nao encontrado'}`);
      console.log(`    whatsapp ..... ${whatsappLink(place.phone_international ?? place.phone) ?? 'indisponivel'}`);
      console.log(
        `    site ......... ${place.website_status === 'HAS_WEBSITE' ? place.website : 'nao identificado'}`,
      );
      console.log(`    score ........ ${score.score}/100 (${score.level}), perfil ${quality}`);
      console.log(`    acao ......... ${action.action}\n`);
    }

    console.log('RESULTADO: Google Places PASS');
  } catch (error) {
    if (error instanceof GooglePlacesError) {
      console.error(`FAIL  ${error.code}: ${error.message}`);
    } else {
      console.error('FAIL  Erro inesperado ao consultar o Google.');
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
