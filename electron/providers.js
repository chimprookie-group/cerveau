'use strict';

/**
 * Fournisseurs d'IA avec streaming SSE.
 * Trois familles d'API :
 *  - anthropic : /v1/messages (Claude)
 *  - openai    : /chat/completions compatible OpenAI (DeepSeek, OpenRouter, LM Studio…)
 * Toutes normalisées vers un flux d'événements :
 *   { type: 'texte', delta } | { type: 'outil', id, nom, arguments }
 *   { type: 'fin', raison, usage } | { type: 'erreur', message }
 */

const ANTHROPIC_VERSION = '2023-06-01';

function classify(id) {
  if (id === 'anthropic') return 'anthropic';
  return 'openai';
}

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          yield trimmed.slice(5).trim();
        }
      }
    }
    if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim();
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

function errorMessage(status, body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || body;
  } catch { /* texte brut */ }
  const conseils = {
    400: "requête refusée — le modèle gère-t-il les outils et ce format de message ?",
    401: "clé d'API invalide ou absente",
    402: 'crédit épuisé sur ce compte fournisseur',
    403: 'accès refusé (vérifie les droits de la clé)',
    404: 'modèle ou URL introuvable — vérifie le nom du modèle',
    413: 'requête trop volumineuse — réduis la pièce jointe ou l\'historique',
    422: 'paramètres refusés par le fournisseur',
    429: 'quota ou limite de débit atteinte — attends un instant',
    500: 'erreur interne du fournisseur',
    502: 'passerelle du fournisseur indisponible',
    503: 'service temporairement indisponible',
    529: 'fournisseur surchargé, réessaie plus tard'
  };
  const hint = conseils[status] ? ` — ${conseils[status]}` : '';
  return `Erreur ${status}${hint} : ${String(detail).slice(0, 500)}`;
}

/* ---------------------------- Anthropic (Claude) ------------------------- */

async function* streamAnthropic({ apiKey, baseUrl, model, messages, system, tools, signal, maxTokens, temperature }) {
  const url = `${(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;
  const body = {
    model,
    max_tokens: maxTokens || 8192,
    stream: true,
    messages
  };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;
  if (typeof temperature === 'number') body.temperature = temperature;

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    yield { type: 'erreur', message: errorMessage(res.status, await res.text()) };
    return;
  }

  // état des blocs d'outils en cours
  const toolBlocks = new Map();
  let stopReason = null;
  let usage = null;

  for await (const data of sseLines(res)) {
    if (!data || data === '[DONE]') continue;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }

    switch (evt.type) {
      case 'content_block_start': {
        const blk = evt.content_block;
        if (blk?.type === 'tool_use') {
          toolBlocks.set(evt.index, { id: blk.id, nom: blk.name, json: '' });
          yield { type: 'outil_debut', id: blk.id, nom: blk.name };
        } else if (blk?.type === 'text' && blk.text) {
          yield { type: 'texte', delta: blk.text };
        }
        break;
      }
      case 'content_block_delta': {
        const d = evt.delta;
        if (d?.type === 'text_delta') yield { type: 'texte', delta: d.text };
        else if (d?.type === 'input_json_delta') {
          const t = toolBlocks.get(evt.index);
          if (t) t.json += d.partial_json || '';
        }
        break;
      }
      case 'content_block_stop': {
        const t = toolBlocks.get(evt.index);
        if (t) {
          let args = {};
          try { args = t.json ? JSON.parse(t.json) : {}; } catch { args = { _brut: t.json }; }
          yield { type: 'outil', id: t.id, nom: t.nom, arguments: args };
          toolBlocks.delete(evt.index);
        }
        break;
      }
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage) usage = evt.usage;
        break;
      case 'message_stop':
        yield { type: 'fin', raison: stopReason, usage };
        return;
      case 'error':
        yield { type: 'erreur', message: evt.error?.message || 'Erreur de flux Anthropic' };
        return;
      default:
        break;
    }
  }
  yield { type: 'fin', raison: stopReason || 'end_turn', usage };
}

/* --------------------- OpenAI-compatible (DeepSeek, etc.) --------------- */

async function* streamOpenAI({ apiKey, baseUrl, model, messages, tools, signal, maxTokens, temperature }) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = /\/v\d+$/.test(base) || base.endsWith('/chat/completions')
    ? (base.endsWith('/chat/completions') ? base : `${base}/chat/completions`)
    : `${base}/v1/chat/completions`;

  const body = {
    model,
    stream: true,
    messages,
    max_tokens: maxTokens || 8192
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (typeof temperature === 'number') body.temperature = temperature;

  // Un serveur local (LM Studio, Ollama, vLLM…) n'a pas de clé : envoyer
  // « Authorization: Bearer » vide ferait rejeter certains serveurs.
  const entetes = { 'content-type': 'application/json' };
  if (apiKey) entetes.authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: entetes,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    yield { type: 'erreur', message: errorMessage(res.status, await res.text()) };
    return;
  }

  const toolCalls = new Map(); // index -> { id, nom, json }
  let stopReason = null;
  let usage = null;

  for await (const data of sseLines(res)) {
    if (!data || data === '[DONE]') continue;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }

    if (evt.usage) usage = evt.usage;
    const choice = evt.choices?.[0];
    if (!choice) continue;

    if (choice.delta?.content) {
      yield { type: 'texte', delta: choice.delta.content };
    }

    if (Array.isArray(choice.delta?.tool_calls)) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;
        let cur = toolCalls.get(idx);
        if (!cur) {
          cur = { id: tc.id || `call_${idx}_${Date.now()}`, nom: tc.function?.name || '', json: '' };
          toolCalls.set(idx, cur);
          if (cur.nom) yield { type: 'outil_debut', id: cur.id, nom: cur.nom };
        }
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.nom = tc.function.name;
        if (tc.function?.arguments) cur.json += tc.function.arguments;
      }
    }

    if (choice.finish_reason) stopReason = choice.finish_reason;
  }

  for (const [, t] of toolCalls) {
    let args = {};
    try { args = t.json ? JSON.parse(t.json) : {}; } catch { args = { _brut: t.json }; }
    yield { type: 'outil', id: t.id, nom: t.nom, arguments: args };
  }

  yield {
    type: 'fin',
    raison: stopReason === 'tool_calls' ? 'tool_use' : (stopReason || 'end_turn'),
    usage
  };
}

function stream(options) {
  const kind = classify(options.providerId);
  if (kind === 'anthropic') return streamAnthropic(options);
  return streamOpenAI(options);
}

module.exports = { stream, classify };
