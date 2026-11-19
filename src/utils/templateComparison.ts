// La igualdad estricta solo ignora espacios: conserva tildes, signos, mayúsculas y caracteres.
export const withoutSpaces = (value: string) => value.replace(/\\s+/gu, '');
export const comparable = (value: string) => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim();
// Legacy processes stored all imported CAMPO requirements as the process description.
// Detect the identifier regardless of the surrounding brackets (e.g. [CAMPO_1], (CAMPO_1)).
export const isImportedFieldListDescription = (description: string): boolean => /CAMPO[_\s-]*\d+/i.test(description || '');

export const similarity = (a: string, b: string): number => {
  const x = comparable(a), y = comparable(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
};
export const requirementLines = (value: string) => value.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
export const compareRequirements = (a: string, b: string) => {
  const left = requirementLines(a), right = requirementLines(b);
  const normalized = (line: string) => comparable(line).replace(/\\b(del|de la|de los|de las)\\b/g, '').replace(/\\s+/g, ' ').trim();
  const other = [...right];
  const removed: string[] = [];
  for (const line of left) {
    const idx = other.findIndex(item => normalized(item) === normalized(line));
    if (idx >= 0) other.splice(idx, 1);
    else removed.push(line);
  }
  return { removed, added: other };
};

