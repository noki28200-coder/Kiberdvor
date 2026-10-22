/** Посев по среднему рейтингу команды: сильнейшая получает первый номер. */
export function seedTeams(teams: { id: string; avgRating: number }[]): string[] {
  return [...teams]
    .sort((a, b) => b.avgRating - a.avgRating || a.id.localeCompare(b.id))
    .map((t) => t.id);
}
