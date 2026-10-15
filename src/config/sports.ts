export const ALLOWED_SPORTS = ['cricket', 'football', 'wwe', 'aew'] as const;
export type AllowedSport = typeof ALLOWED_SPORTS[number];

export const SPORT_ALIASES: Record<string, AllowedSport> = {
  soccer: 'football',
  football: 'football',
  cricket: 'cricket',
  wwe: 'wwe',
  wrestling: 'wwe',
  'professional wrestling': 'wwe',
  fighting: 'wwe',
  aew: 'aew',
};

export function normalizeSport(sport?: string): AllowedSport | null {
  if (!sport) return null;
  const s = sport.trim().toLowerCase();
  return SPORT_ALIASES[s] || null;
}

export function isAllowedSport(sport?: string): boolean {
  return normalizeSport(sport) !== null;
}
