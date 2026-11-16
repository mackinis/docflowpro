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

export async function generateTemplateWithAI(
  env: Env,
  params: {
    industry: string;
    description: string;
  }
): Promise<Omit<ProcessTemplate, 'id'>> {
  const systemPrompt =
    'Eres un Ingeniero de Procesos Documentales experto. Responde EXCLUSIVAMENTE con un objeto JSON válido, sin markdown ni texto fuera del JSON.';

  const userPrompt = `Genera una plantilla de proceso reutilizable para el rubro "${params.industry}" basada en esta descripción:
"${params.description}"

Debe tener entre 2 y 4 etapas lógicas, cada una con 2 o 3 requisitos distribuidos entre "document", "form" y "task".
Para los requisitos de tipo "form", incluye "formFields" con al menos 2 campos.

Esquema JSON obligatorio:
{
  "name": "Título formal del proceso",
  "description": "Descripción detallada",
  "industry": "Inmobiliaria" | "Jurídico" | "Seguros" | "Financiera" | "Recursos Humanos" | "Administrativo",
  "stages": [
    {
      "name": "1. Nombre de la etapa",
      "description": "Objetivo de la etapa",
      "requirements": [
        {
          "name": "Título del requisito",
          "type": "document" | "form" | "task",
          "description": "Instrucciones para el asesor",
          "isRequired": true,
          "formFields": [
            { "id": "campo_1", "label": "Etiqueta", "type": "text" | "number" | "date" | "select" | "boolean", "required": true }
          ]
        }
      ]
    }
  ]
}`;

  const raw = await runWorkersAiText(env, systemPrompt, userPrompt, 3072);
  const parsed = cleanAndParseJSON(raw);
  const now = Date.now();

  return {
    name: parsed.name || `Proceso IA - ${params.industry}`,
    description: parsed.description || 'Proceso generado mediante Cloudflare Workers AI.',
    industry: (parsed.industry || params.industry || 'Administrativo') as ProcessTemplate['industry'],
    stages: (Array.isArray(parsed.stages) ? parsed.stages : []).map((stg: any, sIdx: number) => ({
      id: `stg-ai-${sIdx}-${now}`,
      name: stg.name || `Etapa ${sIdx + 1}`,
      description: stg.description || '',
      requirements: (Array.isArray(stg.requirements) ? stg.requirements : []).map(
        (req: any, rIdx: number) => ({
          id: `req-ai-${sIdx}-${rIdx}-${now}`,
          name: req.name || `Requisito ${rIdx + 1}`,
          type: ['document', 'form', 'task'].includes(req.type) ? req.type : 'document',
          description: req.description || '',
          isRequired: req.isRequired !== undefined ? Boolean(req.isRequired) : true,
          formFields: Array.isArray(req.formFields) ? req.formFields : undefined,
        })
      ),
    })),
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
    generateFlow: boolean;
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

  const systemPrompt =
    'Eres un transcriptor y digitalizador documental minucioso. Responde EXCLUSIVAMENTE con un objeto JSON válido sin markdown adicional.';

  const userPrompt = params.generateFlow
    ? `Digitaliza este documento para el rubro "${params.industry}".
REGLAS:
1. "originalDocumentContent" debe conservar de forma 100% literal el texto del documento, manteniendo sus líneas de subrayado "_________" sin inventar comentarios.
2. "stages" debe contener entre 2 y 5 etapas lógicas basadas en el documento, cada una con requisitos de tipo "document", "form" o "task".

Documento fuente:
"""
${extractedText.slice(0, 12000)}
"""

Retorna ÚNICAMENTE JSON válido:
{
  "name": "Título formal",
  "description": "Descripción breve",
  "industry": "${params.industry}",
  "originalDocumentContent": "Texto literal íntegro",
  "stages": [
    {
      "name": "1. Etapa",
      "description": "Objetivo",
      "requirements": [
        { "name": "Requisito", "type": "document" | "form" | "task", "description": "Detalle", "isRequired": true }
      ]
    }
  ]
}`
    : `Genera metadatos para el siguiente documento digitalizado del rubro "${params.industry}".
No modifiques ni resumas el contenido; devuelve el texto literal en "originalDocumentContent" y un arreglo "stages" vacío [].

Documento fuente:
"""
${extractedText.slice(0, 12000)}
"""

Retorna ÚNICAMENTE JSON válido:
{
  "name": "Título formal",
  "description": "Descripción breve",
  "industry": "${params.industry}",
  "originalDocumentContent": "Texto literal íntegro",
  "stages": []
}`;

  const raw = await runWorkersAiText(env, systemPrompt, userPrompt, 3584);
  const parsed = cleanAndParseJSON(raw);
  const now = Date.now();

  return {
    name: parsed.name || `Proceso Digitalizado - ${params.industry}`,
    description:
      parsed.description || 'Proceso digitalizado mediante Cloudflare Workers AI.',
    industry: (parsed.industry || params.industry || 'Administrativo') as ProcessTemplate['industry'],
    originalDocumentContent: parsed.originalDocumentContent || extractedText,
    showDocumentToAll: true,
    stages: params.generateFlow
      ? (Array.isArray(parsed.stages) ? parsed.stages : []).map((stg: any, sIdx: number) => ({
          id: `stg-dig-${sIdx}-${now}`,
          name: stg.name || `Etapa ${sIdx + 1}`,
          description: stg.description || '',
          requirements: (Array.isArray(stg.requirements) ? stg.requirements : []).map(
            (req: any, rIdx: number) => ({
              id: `req-dig-${sIdx}-${rIdx}-${now}`,
              name: req.name || `Requisito ${rIdx + 1}`,
              type: ['document', 'form', 'task'].includes(req.type) ? req.type : 'document',
              description: req.description || '',
              isRequired: req.isRequired !== undefined ? Boolean(req.isRequired) : true,
              formFields: Array.isArray(req.formFields) ? req.formFields : undefined,
            })
          ),
        }))
      : [],
  };
}
