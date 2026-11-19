import type { Participant, ParticipantType } from '../types';
export type DraftRecord = {
  id: string; title: string; description: string; templateId: string; advisorId: string;
  participants: Participant[]; fieldValues: Record<string,string>; pendingActor: Record<string,string>;
  documentContent: string; escribano: boolean; updatedAt: string;
};
// Session-only snapshot: returning to Legajos must not hide already loaded drafts.
// Scoped to the authenticated user; never persisted to localStorage.
export const draftSnapshots = new Map<string, DraftRecord[]>();
export const normalizedActor = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const roleForField = (actor: string): ParticipantType | null => {
  const a = normalizedActor(actor);
  if (/locador/.test(a)) return 'Locador';
  if (/locatario/.test(a)) return 'Locatario';
  if (/garante/.test(a)) return 'Garante';
  if (/vendedor/.test(a)) return 'Vendedor';
  if (/comprador/.test(a)) return 'Comprador';
  if (/titular/.test(a)) return 'Titular';
  if (/apoderado/.test(a)) return 'Apoderado';
  return null;
};
export const importedField = (name: string) => {
  const match = name.match(/^(.*?)\s+—\s+(.*?)\s+\(\[?(CAMPO_\d+)\]?\)/i);
  return match ? { actor: match[1].trim(), label: match[2].trim(), id: match[3].toUpperCase() } : null;
};

