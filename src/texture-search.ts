export function textureSearchTokens(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function textureSearchScore(
  name: string,
  query: string,
  semantics: Record<string, unknown> | null,
  surfaceParms: string[],
): number | null {
  const normalizedName = name.toLowerCase().replace(/\\/g, '/');
  const tokens = textureSearchTokens(query);
  if (tokens.length === 0) return 0;
  const semanticTerms = semantics
    ? Object.entries(semantics).filter(([, enabled]) => enabled === true).map(([term]) => term)
    : [];
  const haystack = `${normalizedName.replace(/[^a-z0-9]+/g, ' ')} ${normalizedName.replace(/[^a-z0-9]+/g, '')} ${surfaceParms.join(' ')} ${semanticTerms.join(' ')}`;
  if (!tokens.every(token => haystack.includes(token))) return null;
  const normalizedQuery = tokens.join(' ');
  let score = tokens.reduce((total, token) => total + (normalizedName.includes(token) ? 20 : 5), 0);
  if (normalizedName.replace(/[^a-z0-9]+/g, ' ').includes(normalizedQuery)) score += 50;
  if (normalizedName.endsWith(tokens.join(''))) score += 20;
  return score;
}
