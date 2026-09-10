import { useEffect } from "react";
import { useDay } from "@/context/DayContext";

const PARTICLES = Array.from({ length: 14 });

export default function Reward() {
  const { reward, clearReward } = useDay();

  useEffect(() => {
    if (!reward) return;
    const id = setTimeout(clearReward, 1600);
    return () => clearTimeout(id);
  }, [reward, clearReward]);

  if (!reward) return null;
  const tint =
    reward.name === "aura" || reward.name === "spark" ? "var(--amber)" : "var(--sage)";

  return (
    <div
      data-testid="reward-overlay"
      className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center overflow-hidden"
    >
      {(reward.name === "aura" || reward.name === "bloom") && (
        <div
          key={reward.key}
          className="h-80 w-80 rounded-full"
          style={{
            background: `radial-gradient(circle, ${tint}44, transparent 62%)`,
            animation: "burst 1.5s ease-out forwards",
          }}
        />
      )}
      {reward.name === "ripple" && (
        <>
          {[0, 1, 2].map((i) => (
            <div
              key={`${reward.key}-${i}`}
              className="absolute rounded-full border"
              style={{
                borderColor: tint,
                height: 120 + i * 90,
                width: 120 + i * 90,
                animation: "burst 1.5s ease-out forwards",
                animationDelay: `${i * 0.14}s`,
                opacity: 0,
              }}
            />
          ))}
        </>
      )}
      {(reward.name === "confetti" || reward.name === "spark") && (
        <>
          {PARTICLES.map((_, i) => (
            <span
              key={`${reward.key}-${i}`}
              className="absolute rounded-full"
              style={{
                height: reward.name === "spark" ? 4 : 7,
                width: reward.name === "spark" ? 4 : 3,
                background: i % 3 === 0 ? "var(--amber)" : i % 3 === 1 ? "var(--sage)" : "var(--sky)",
                left: `${8 + i * 6.2}%`,
                bottom: "26%",
                animation: "drift-up 1.5s ease-out forwards",
                animationDelay: `${(i % 5) * 0.08}s`,
                opacity: 0,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
