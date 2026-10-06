'use strict';

const { generateFreeText, publicAIError, FreeAIError } = require('../lib/free-ai');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Nur GET ist erlaubt.' });
  try {
    const result = await generateFreeText('Antworte ausschließlich mit diesem Wort: KI_OK', { maxOutputTokens: 64 });
    if (!/\bKI_OK\b/.test(result.text)) {
      throw new FreeAIError('invalid_response', 'Die KI hat geantwortet, aber den Verbindungstest nicht bestanden.');
    }
    console.info('ai-status', JSON.stringify({ connected: true, model: result.model, pricing: 'free' }));
    return res.status(200).json({ connected: true, model: result.model, modelName: result.modelName, pricing: 'free', unlimited: false });
  } catch (error) {
    const issue = publicAIError(error);
    console.warn('ai-status', JSON.stringify({ connected: false, code: issue.code }));
    return res.status(issue.code === 'quota' ? 429 : 503).json({ connected: false, error: issue.message, code: issue.code, unlimited: false });
  }
};
