'use strict';

// Only models advertised as free AND currently priced at zero may be used.
// The catalog is checked before generation; unavailable pricing never falls
// back to a paid model or a hardcoded price assumption.
const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
const PREFERRED_MODELS = [
  'inclusionai/ling-3.1-flash-free',
  'inclusionai/ling-3.1-flash',
  'poolside/laguna-s-2.1-free'
];

class FreeAIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function zeroPrice(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) === 0;
}

function isFreeTextModel(model) {
  return model && model.type === 'language'
    && Array.isArray(model.tags) && model.tags.includes('free')
    && model.pricing && zeroPrice(model.pricing.input) && zeroPrice(model.pricing.output)
    && model.pricing.varies_by_provider !== true
    // Cache prices and any future billing field must also be zero. Optional
    // cache prices may be null when the model does not support caching.
    && Object.entries(model.pricing).every(([key, value]) =>
      key === 'varies_by_provider' ? value === false
        : ['input_cache_read', 'input_cache_write'].includes(key) && value == null
          ? true : zeroPrice(value))
    && (!model.deprecated_at || model.deprecated_at > Date.now());
}

function publicAIError(error) {
  if (error instanceof FreeAIError) return { code: error.code, message: error.message };
  const status = error && (error.statusCode || error.status || error.cause?.statusCode);
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (status === 402 || status === 429) {
    return { code: 'quota', message: 'Das kostenlose KI-Kontingent oder Anfragelimit ist gerade erreicht. Bitte später erneut versuchen.' };
  }
  if (status === 401 || status === 403 || /authentication|api key|oidc|credential/i.test(name + ' ' + message)) {
    return { code: 'authentication', message: 'Der KI-Zugang ist nicht freigeschaltet. Bitte AI Gateway für das Vercel-Projekt einrichten.' };
  }
  if (/abort|timeout/i.test(name + ' ' + message)) {
    return { code: 'timeout', message: 'Die kostenlose KI hat zu lange gebraucht. Bitte erneut versuchen.' };
  }
  return { code: 'unavailable', message: 'Die kostenlose KI ist gerade nicht erreichbar. Bitte später erneut versuchen.' };
}

function createFreeAI({ fetcher = (...args) => fetch(...args), generate = async options => {
  // AI SDK resolves and refreshes the project's Vercel OIDC credentials.
  const { generateText } = await import('ai');
  return generateText(options);
} } = {}) {
  async function freeModels(signal) {
    let response, catalog;
    try {
      response = await fetcher(CATALOG_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
      });
      if (!response.ok) throw new Error('Catalog unavailable');
      catalog = await response.json();
      if (!Array.isArray(catalog.data)) throw new Error('Invalid catalog');
    } catch {
      throw new FreeAIError('catalog_unavailable', 'Die aktuellen kostenlosen KI-Modelle konnten nicht geprüft werden.');
    }
    const models = catalog.data.filter(isFreeTextModel).sort((a, b) => {
      const rank = m => PREFERRED_MODELS.includes(m.id) ? PREFERRED_MODELS.indexOf(m.id) : PREFERRED_MODELS.length;
      return rank(a) - rank(b);
    });
    if (!models.length) throw new FreeAIError('no_free_model', 'Der Anbieter bietet gerade kein kostenloses Textmodell an.');
    // Two aliases of the same Ling model do not constitute useful failover.
    const unique = models.filter((m, i, list) => !list.slice(0, i).some(other =>
      other.id.replace(/-free$/, '') === m.id.replace(/-free$/, '')));
    return unique.slice(0, 2);
  }

  async function generateFreeText(prompt, { maxOutputTokens = 3200, signal = AbortSignal.timeout(39000), attemptTimeoutMs = 29000, validateText, instructions } = {}) {
    const models = await freeModels(signal);
    let lastError;
    modelLoop: for (const model of models) {
      if (signal.aborted) break;
      for(let attempt=0;attempt<2;attempt++){
      try {
        const result = await generate({
          model: model.id,
          prompt,
          ...(instructions ? { instructions } : {}),
          maxOutputTokens,
          reasoning: 'none',
          maxRetries: 0,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(220000,Math.max(1,Math.trunc(Number(attemptTimeoutMs)||29000))))])
        });
        const text = String(result?.text || '').trim();
        if (!text) throw new FreeAIError('invalid_response', 'Die KI hat keine verwendbare Antwort geliefert.');
        if (validateText && !validateText(text)) throw new FreeAIError('invalid_response', 'Die KI-Antwort enthält keine gültigen Quizfragen.');
        return { text, model: model.id, modelName: model.name || model.id, pricing: 'free' };
      } catch (error) {
        lastError = error;
        const code = publicAIError(error).code;
        const status=error?.statusCode||error?.cause?.statusCode;
        console.warn('free-ai-attempt',JSON.stringify({model:model.id,code,status:status||null}));
        if (code === 'authentication' || code === 'quota') break modelLoop;
        if(attempt===0&&[502,503,504].includes(status)&&!signal.aborted){
          await new Promise(resolve=>setTimeout(resolve,500));
          continue;
        }
        break;
      }
      }
    }
    const error = publicAIError(lastError || { name: 'AbortError' });
    throw new FreeAIError(error.code, error.message);
  }

  return { generateFreeText };
}

module.exports = { ...createFreeAI(), createFreeAI, isFreeTextModel, publicAIError, FreeAIError };
