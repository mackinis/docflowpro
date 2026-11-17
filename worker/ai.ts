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


  // Extract explicit blanks without changing existing placeholder IDs.
  const existing = [...extractedText.matchAll(/\[CAMPO_(\d+)\*?\]/g)].map(m => Number(m[1]));
  let number = Math.max(0, ...existing);
  const next = () => `[CAMPO_${++number}]`;
  let content = extractedText.replace(/_{3,}|\.{3,}|…{2,}/g, next);
  type Field = { id:string; label:string; actor:string; source:'explicit'|'semantic'|'manual'; confidence:'high'|'medium'|'low'; review:boolean };
  const fields: Field[] = [];
  const notes: string[] = [];
  const originalLines = content.split('\n');
  // Analyze bounded chunks: truncating the whole document silently loses later fields.
  const chunks: string[] = [];
  let chunk = '';
  for (const line of originalLines) {
    if (chunk.length + line.length > 8500 && chunk) { chunks.push(chunk); chunk=''; }
    chunk += line + '\n';
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 16) throw new Error('Documento demasiado extenso para una digitalización segura. Dividilo en archivos más pequeños.');
  let title = params.fileName || 'Documento digitalizado';
  let description = 'Documento digitalizado pendiente de revisión.';
  const prompt = `Sos un especialista en formularios inmobiliarios, jurídicos y administrativos.
Devolvé EXCLUSIVAMENTE JSON: {"name":"título","description":"resumen","fields":[{"id":"[CAMPO_1]","label":"DNI","actor":"Locador 1","confidence":"high"}],"insertions":[{"anchor":"fragmento literal exacto terminado en dos puntos","label":"Fecha de nacimiento","actor":"Locador 1","confidence":"high"}],"reviewNotes":[]}.
Identificá el significado de CADA marcador existente. Los actores son distintos: locador, locatario, garante, cónyuge, representante, etc. Usá actor "No determinado" cuando corresponda.
Detectá etiquetas que solicitan datos sin marcador. Para cada omisión devolvé un anchor LITERAL, único, que termine exactamente en el lugar donde debería insertarse el campo.
No propongas campos en instrucciones, títulos, narraciones ni valores ya escritos. No inventes contenido ni modifiques el texto. Si hay dudas, reviewNotes.
Máximo 80 campos e inserciones por fragmento.`;
  for (let index=0; index<chunks.length; index++) {
    const raw = await runWorkersAiText(env, prompt, `Fragmento ${index+1}/${chunks.length}:\n${chunks[index]}`, 4096);
    const parsed = cleanAndParseJSON(raw);
    if (index===0) {
      title = typeof parsed.name==='string' && parsed.name.trim() ? parsed.name.trim().slice(0,160) : title;
      description = typeof parsed.description==='string' && parsed.description.trim() ? parsed.description.trim().slice(0,400) : description;
    }
    if (Array.isArray(parsed.reviewNotes)) for(const n of parsed.reviewNotes.slice(0,30)) if(typeof n==='string') notes.push(n.slice(0,200));
    if (Array.isArray(parsed.fields)) for(const f of parsed.fields.slice(0,100)) {
      if (!f || typeof f.id!=='string' || !/^\[CAMPO_\d+\*?\]$/.test(f.id) || !content.includes(f.id)) continue;
      if (fields.some(v=>v.id===f.id)) continue;
      fields.push({id:f.id,label:String(f.label||'Dato sin identificar').slice(0,120),actor:String(f.actor||'No determinado').slice(0,100),source:'explicit',confidence:f.confidence==='high'?'high':f.confidence==='medium'?'medium':'low',review:f.confidence!=='high'});
    }
    if (!Array.isArray(parsed.insertions)) continue;
    for (const ins of parsed.insertions.slice(0,100)) {
      if (!ins || typeof ins.anchor!=='string' || typeof ins.label!=='string') continue;
      const anchor=ins.anchor;
      // Only unique, unambiguous anchors ending at a field label are eligible.
      if(anchor.length<6 || anchor.length>200 || !/[:：]\s*$/.test(anchor)) {notes.push('Revisar posible campo: '+String(ins.label).slice(0,90));continue;}
      const pos=content.indexOf(anchor);
      if(pos<0 || content.indexOf(anchor,pos+1)!==-1) {notes.push('Ubicación ambigua: '+String(ins.label).slice(0,90));continue;}
      const at=pos+anchor.length;
      const sameLine=content.slice(at).split('\n',1)[0];
      if (/^\s*\[CAMPO_\d+\*?\]/.test(sameLine) || /^\s*[\p{L}\p{N}]{2,}/u.test(sameLine)) continue;
      const id=next();
      content=content.slice(0,at)+' '+id+content.slice(at);
      fields.push({id,label:String(ins.label).slice(0,120),actor:String(ins.actor||'No determinado').slice(0,100),source:'semantic',confidence:ins.confidence==='high'?'high':ins.confidence==='medium'?'medium':'low',review:ins.confidence!=='high'});
    }
  }
  // Include every marker, even when AI did not understand its meaning.
  for(const m of content.matchAll(/\[CAMPO_\d+\*?\]/g)) if(!fields.some(f=>f.id===m[0]))
    fields.push({id:m[0],label:'Pendiente de identificar',actor:'No determinado',source:'explicit',confidence:'low',review:true});
  const ids=new Set<string>();
  for(const f of fields) {
    if(ids.has(f.id)) continue;
    ids.add(f.id);
    if(f.review) notes.push('Revisar '+f.id+': '+f.label+' — '+f.actor);
  }
  return {
    name:title,description,industry:(params.industry||'Administrativo') as ProcessTemplate['industry'],
    originalDocumentContent:content,showDocumentToAll:true,stages:[],
    fieldMap:fields, digitizationReviewNotes:[...new Set(notes)].slice(0,100)
  };

}
