import type { ProcessTemplate } from '../src/types';
import type { Env } from './types';
import { DEFAULT_SYSTEM_SETTINGS, getSystemConfigValue } from './db';
import {
  decodeDataUrl,
  encodeBase64,
  extractTextFromDocx,
  extractTextFromPdf,
} from './document-parser';

const TEXT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fast',
] as const;

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

function extractResponseText(output: any): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (typeof output.response === 'string') return output.response;
  if (output.response && typeof output.response === 'object') {
    return JSON.stringify(output.response);
  }
  if (Array.isArray(output.choices) && output.choices[0]?.message?.content) {
    return output.choices[0].message.content;
  }
  return JSON.stringify(output);
}

export function cleanAndParseJSON(rawText: string): any {
  let cleaned = (rawText || '').trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');

  let startIdx = -1;
  let endToken = '';

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endToken = '}';
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endToken = ']';
  }

  if (startIdx !== -1) {
    const lastTokenIdx = cleaned.lastIndexOf(endToken);
    if (lastTokenIdx !== -1 && lastTokenIdx > startIdx) {
      cleaned = cleaned.substring(startIdx, lastTokenIdx + 1);
    }
  }

  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function runWorkersAiText(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3072
): Promise<string> {
  if (!env.AI) {
    throw new Error(
      'El binding de Cloudflare Workers AI (env.AI) no está disponible en este entorno.'
    );
  }

  let lastError: any = null;
  const settings = await getSystemConfigValue(env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const chosen = settings.aiModel && TEXT_MODELS.includes(settings.aiModel as typeof TEXT_MODELS[number])
    ? settings.aiModel : TEXT_MODELS[0];
  for (const model of [chosen]) {
    try {
      const result = await (env.AI as any).run(model, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      });
      const text = extractResponseText(result);
      if (text) return text;
    } catch (err: any) {
      lastError = err;
      console.warn(`Workers AI model ${model} failed:`, err?.message || err);
    }
  }

  throw new Error(
    `Error ejecutando Cloudflare Workers AI: ${lastError?.message || 'Sin respuesta de los modelos.'}`
  );
}

async function runWorkersAiVisionOcr(
  env: Env,
  imageBytes: Uint8Array,
  mimeType: string
): Promise<string> {
  if (!env.AI) {
    throw new Error(
      'El binding de Cloudflare Workers AI (env.AI) no está disponible para OCR de imágenes.'
    );
  }

  const base64 = encodeBase64(imageBytes);
  const dataUri = `data:${mimeType};base64,${base64}`;

  const result = await (env.AI as any).run(VISION_MODEL, {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe de forma 100% literal todo el texto visible en esta imagen, preservando títulos, párrafos, líneas de subrayado (_____) y estructura sin agregar comentarios.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUri },
          },
        ],
      },
    ],
    max_tokens: 2048,
  });

  return extractResponseText(result).trim();
}

export async function analyzeDocumentWithAI(
  env: Env,
  params: {
    requirementName: string;
    requirementDescription: string;
    fileName: string;
    r2Key?: string | null;
  }
): Promise<{
  approved: boolean;
  analysis: string;
  suggestedObservation?: string;
}> {
  let documentExcerpt = '';
  if (params.r2Key) {
    try {
      const obj = await env.R2_BUCKET.get(params.r2Key);
      if (obj) {
        const lower = (params.fileName || '').toLowerCase();
        const bytes = new Uint8Array(await obj.arrayBuffer());
        if (lower.endsWith('.txt')) {
          documentExcerpt = new TextDecoder('utf-8').decode(bytes).slice(0, 6000);
        } else if (lower.endsWith('.docx')) {
          documentExcerpt = extractTextFromDocx(bytes).slice(0, 6000);
        } else if (lower.endsWith('.pdf')) {
          documentExcerpt = extractTextFromPdf(bytes).slice(0, 6000);
        }
      }
    } catch (err) {
      console.warn('No se pudo extraer contenido del archivo en R2 para auditoría:', err);
    }
  }

  const systemPrompt =
    'Eres un auditor documental y legal experto. Responde SIEMPRE en JSON válido y estricto sin texto adicional ni bloques markdown.';

  const userPrompt = `Analiza el siguiente documento cargado en un expediente para certificar cumplimiento documental.
Requisito a auditar: "${params.requirementName}"
Descripción del requisito: "${params.requirementDescription}"
Nombre del archivo: "${params.fileName}"
${documentExcerpt ? `\nContenido extraído del documento:\n"""\n${documentExcerpt}\n"""` : '\n(Nota: El archivo es binario o imagen sin texto plano extraído; evalúa su correspondencia formal con el requisito).'}

Retorna ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "approved": boolean,
  "analysis": "informe técnico en markdown con los puntos verificados",
  "suggestedObservation": "observación concisa si approved es false, o cadena vacía si approved es true"
}`;

  const raw = await runWorkersAiText(env, systemPrompt, userPrompt, 1536);
  const parsed = cleanAndParseJSON(raw);

  return {
    approved: Boolean(parsed.approved),
    analysis: String(parsed.analysis || 'Auditoría completada mediante Cloudflare Workers AI.'),
    suggestedObservation: parsed.suggestedObservation
      ? String(parsed.suggestedObservation)
      : undefined,
  };
}

export async function digitizeTemplateWithAI(
  env: Env,
  params: {
    fileBase64?: string;
    mimeType?: string;
    fileName?: string;
    textProposal?: string;
    industry: string;
  }
): Promise<Omit<ProcessTemplate, 'id'>> {
  let extractedText = (params.textProposal || '').trim();

  if (params.fileBase64) {
    const { bytes, mimeType } = decodeDataUrl(
      params.fileBase64,
      params.mimeType || 'application/octet-stream'
    );
    const lowerName = (params.fileName || '').toLowerCase();

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lowerName.endsWith('.docx')
    ) {
      extractedText = extractTextFromDocx(bytes);
    } else if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
      const pdfText = extractTextFromPdf(bytes);
      if (pdfText) {
        extractedText = pdfText;
      } else if (!extractedText) {
        throw new Error(
          'El PDF no contiene texto seleccionable extraíble de forma nativa en Workers (PDF escaneado como imagen). Sube una imagen PNG/JPG del documento o pega el texto para digitalizarlo con Workers AI.'
        );
      }
    } else if (mimeType.startsWith('text/') || lowerName.endsWith('.txt')) {
      extractedText = new TextDecoder('utf-8').decode(bytes);
    } else if (
      mimeType.startsWith('image/') ||
      lowerName.endsWith('.png') ||
      lowerName.endsWith('.jpg') ||
      lowerName.endsWith('.jpeg') ||
      lowerName.endsWith('.webp')
    ) {
      extractedText = await runWorkersAiVisionOcr(env, bytes, mimeType);
    }
  }

  if (!extractedText) {
    throw new Error('No se pudo extraer contenido del documento proporcionado.');
  }

  // Phase 1: deterministic discovery of explicit blanks. Preserve all other source
  // characters and never renumber pre-existing placeholders.
  const existingNumbers = Array.from(extractedText.matchAll(/\[CAMPO_(\d+)\*?\]/g), m => Number(m[1]));
  let fieldNumber = Math.max(0, ...existingNumbers);
  const explicitBlank = /_{3,}|\.{3,}|…{2,}/g;
  const used = new Set<number>(existingNumbers);
  const nextField = () => {
    do { fieldNumber++; } while (used.has(fieldNumber));
    used.add(fieldNumber);
    return `[CAMPO_${fieldNumber}]`;
  };
  let interactiveContent = extractedText.replace(explicitBlank, () => nextField());

  // Phase 2: ask AI to identify missing semantic slots using literal source
  // anchors, not to rewrite the document. Anchors are verified before insertion.
  const systemPrompt = `Sos especialista en digitalización de formularios en español.
  Devolvé únicamente JSON válido. NO reescribas ni resumas el documento.
  Detectá etiquetas que solicitan un dato pero no tienen un marcador [CAMPO_N].
  Ejemplos: "FECHA DE NACIMIENTO:", "DNI:", "DOMICILIO:", "CUIT:".
  Distinguí cada actor (locador, locatario, garante, cónyuge, etc.) según contexto.
  No insertes campos en títulos, instrucciones, párrafos narrativos ni cuando
  la etiqueta ya tiene un valor fijo o un marcador existente.
  Para cada omisión devolvé un ancla EXACTA que exista literalmente en el texto
  y termine inmediatamente donde debe insertarse el campo.
  Si hay dudas, no inventes: agregá una observación de revisión.
  Formato: {"name":"Título","description":"Descripción breve",
  "insertions":[{"anchor":"texto literal exacto","label":"Fecha de nacimiento","actor":"Locador 1"}],
  "reviewNotes":["duda concreta"]}. Máximo 100 inserciones.`;
  const userPrompt = `Analizá íntegramente esta plantilla para encontrar campos omitidos.
  Los marcadores existentes son correctos y no deben alterarse.
  Documento completo:
  ${interactiveContent.slice(0, 26000)}`;
  const raw = await runWorkersAiText(env, systemPrompt, userPrompt, 4096);
  const parsed = cleanAndParseJSON(raw);
  const reviewNotes: string[] = Array.isArray(parsed.reviewNotes)
    ? parsed.reviewNotes.filter((v: unknown) => typeof v === 'string').slice(0, 30)
    : [];
  const insertions = Array.isArray(parsed.insertions) ? parsed.insertions.slice(0, 100) : [];
  const seenAnchors = new Set<string>();
  let inserted = 0;
  for (const item of insertions) {
    if (!item || typeof item.anchor !== 'string' || typeof item.label !== 'string') continue;
    const anchor = item.anchor;
    if (anchor.length < 6 || anchor.length > 220 || seenAnchors.has(anchor)) continue;
    seenAnchors.add(anchor);
    const first = interactiveContent.indexOf(anchor);
    if (first < 0 || interactiveContent.indexOf(anchor, first + 1) !== -1) {
      reviewNotes.push(`Revisar campo ambiguo: ${item.label.slice(0, 80)}`);
      continue;
    }
    const at = first + anchor.length;
    const after = interactiveContent.slice(at).split('\n', 1)[0];
    // Do not insert over an existing marker or an explicit same-line value.
    if (/^\s*\[CAMPO_\d+\*?\]/.test(after) || /^\s*[^\s,.;:\[\]()_-]{2,}/.test(after)) continue;
    const field = nextField();
    interactiveContent = interactiveContent.slice(0, at) + ' ' + field + interactiveContent.slice(at);
    inserted++;
  }
  // Keep human review explicit; do not claim exhaustive automatic detection.
  const description = String(parsed.description || 'Documento digitalizado pendiente de revisión.');
  const note = reviewNotes.length
    ? ` Revisar: ${reviewNotes.slice(0, 5).join('; ').slice(0, 600)}`
    : '';
  parsed.description = `${description} · ${inserted} campos semánticos incorporados.${note}`;

  return {
    name: parsed.name || params.fileName || 'Documento digitalizado',
    description: parsed.description || 'Documento interactivo pendiente de aprobación.',
    industry: (params.industry || 'Administrativo') as ProcessTemplate['industry'],
    originalDocumentContent: interactiveContent,
    showDocumentToAll: true,
    stages: [],
  };
}
