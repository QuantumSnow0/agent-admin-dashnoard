import { Star } from "lucide-react";

type AgentRatingStarsProps = {
  score?: number | null;
  size?: "sm" | "md";
  variant?: "onColor" | "default";
  showScore?: boolean;
};

export function AgentRatingStars({
  score,
  size = "sm",
  variant = "onColor",
  showScore = false,
}: AgentRatingStarsProps) {
  const iconClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  if (!score || score < 1) {
    return (
      <span
        className={
          variant === "onColor" ? "text-xs text-white/60" : "text-xs text-gray-400"
        }
      >
        Not rated
      </span>
    );
  }

  const filledClass =
    variant === "onColor"
      ? "fill-amber-300 text-amber-300"
      : "fill-amber-400 text-amber-400";
  const emptyClass =
    variant === "onColor" ? "text-white/30" : "text-gray-300";

  return (
    <div className="flex items-center gap-1" title={`${score} out of 5`}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <Star
            key={value}
            className={`${iconClass} ${
              value <= score ? filledClass : emptyClass
            }`}
          />
        ))}
      </div>
      {showScore ? (
        <span
          className={
            variant === "onColor"
              ? "text-xs font-medium text-white/90"
              : "text-xs font-medium text-gray-700"
          }
        >
          {score}/5
        </span>
      ) : null}
    </div>
  );
}
