export type RatingDistributionRow = {
  score: string;
  count: number;
  label: string;
};

export type AppRatingSummary = {
  totalRatings: number;
  averageScore: number | null;
  distribution: RatingDistributionRow[];
  playStoreOpens: number;
};

export function buildAppRatingSummary(
  ratings: { score: number; opened_play_store?: boolean | null }[]
): AppRatingSummary {
  const counts = [0, 0, 0, 0, 0];
  let playStoreOpens = 0;

  for (const rating of ratings) {
    if (rating.score >= 1 && rating.score <= 5) {
      counts[rating.score - 1] += 1;
    }
    if (rating.opened_play_store) {
      playStoreOpens += 1;
    }
  }

  const totalRatings = counts.reduce((sum, count) => sum + count, 0);
  const weightedSum = counts.reduce(
    (sum, count, index) => sum + count * (index + 1),
    0
  );

  return {
    totalRatings,
    averageScore: totalRatings > 0 ? weightedSum / totalRatings : null,
    playStoreOpens,
    distribution: [5, 4, 3, 2, 1].map((score) => ({
      score: String(score),
      count: counts[score - 1],
      label: `${score} star${score === 1 ? "" : "s"}`,
    })),
  };
}
