import { unzipSync, unzlibSync } from 'fflate';

export function decodeDataUrl(dataUrlOrBase64: string, fallbackMime = 'application/octet-stream'): {
  bytes: Uint8Array;
  mimeType: string;
} {
  let mimeType = fallbackMime;
  let base64 = dataUrlOrBase64;

  if (dataUrlOrBase64.startsWith('data:')) {
    const commaIdx = dataUrlOrBase64.indexOf(',');
    if (commaIdx !== -1) {
      const header = dataUrlOrBase64.slice(5, commaIdx);
      const semiIdx = header.indexOf(';');
      if (semiIdx !== -1) {
        mimeType = header.slice(0, semiIdx) || fallbackMime;
      } else if (header) {
        mimeType = header;
      }
      base64 = dataUrlOrBase64.slice(commaIdx + 1);
    }
  }

  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mimeType };
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function guessMimeType(fileName: string, provided?: string): string {
  if (provided && provided !== 'application/octet-stream') return provided;
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

export function sanitizeFileName(name: string): string {
  return (name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractTextFromDocx(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const docXml = entries['word/document.xml'];
  if (!docXml) {
    throw new Error('No se encontró word/document.xml en el archivo DOCX.');
  }
  const xml = new TextDecoder('utf-8').decode(docXml);
  const withBreaks = xml
    .replace(/<w:p\b[^>]*>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '');

  return decodeXmlEntities(withBreaks)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractTextFromPdf(bytes: Uint8Array): string {
  // Lightweight pure-JS PDF text extractor for Workers isolates.
  // Extracts literal text strings from uncompressed and FlateDecode content streams.
  const raw = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];

  const decodePdfLiteral = (s: string): string => {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
  };

  const extractTj = (content: string) => {
    const tjMatches = content.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g);
    for (const m of tjMatches) {
      const txt = decodePdfLiteral(m[1]).trim();
      if (txt) chunks.push(txt);
    }
    const tjArrMatches = content.matchAll(/\[(.*?)\]\s*TJ/gs);
    for (const m of tjArrMatches) {
      const inner = m[1];
      const parts: string[] = [];
      for (const sm of inner.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)) {
        parts.push(decodePdfLiteral(sm[1]));
      }
      const joined = parts.join('').trim();
      if (joined) chunks.push(joined);
    }
  };

  // Search streams
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamRegex)) {
    const dict = match[1];
    const bodyStr = match[2];
    if (dict.includes('/FlateDecode')) {
      try {
        const compressed = new Uint8Array(bodyStr.length);
        for (let i = 0; i < bodyStr.length; i++) {
          compressed[i] = bodyStr.charCodeAt(i) & 0xff;
        }
        const decompressed = unzlibSync(compressed);
        const textStream = new TextDecoder('latin1').decode(decompressed);
        extractTj(textStream);
      } catch {
        // Ignore non-text or non-standard flate streams
      }
    } else {
      extractTj(bodyStr);
    }
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
