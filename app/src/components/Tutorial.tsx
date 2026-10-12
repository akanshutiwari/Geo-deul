import { useState } from "react";
import { LOCATIONS } from "../lib/locations";
import { PLAYER_COLORS, formatDistance, haversineM, points } from "../lib/geo";
import { ResultMap } from "./maps";
import GuessStage from "./GuessStage";

type Step = "intro" | "drop" | "pin" | "lock" | "result";

const COPY: Record<Step, { text: string; cta?: string }> = {
  intro: {
    text: "Hey, I'm Atlas! Let's play one practice round so you know exactly how a duel works. Nothing is staked here.",
    cta: "Let's go",
  },
  drop: {
    text: "This is your drop, filling the whole screen. A VRF oracle picks it, so nobody can know it in advance. Use the tabs up top: Satellite, the bare Streets grid, and Photos people took around here. Hunt for clues like coastlines, road layouts, roofs, signs and vegetation.",
    cta: "Got it",
  },
  pin: {
    text: "Think you know where this is? The small map in the corner grows when you hover or tap it. Click it to drop your pin, and click again to move it. ⤢ keeps it big.",
  },
  lock: {
    text: "Happy with it? Hit Lock in. In a duel your pin is sealed inside a private rollup. Others see that you locked in, never where.",
  },
  result: {
    text: "The closer your pin, the higher your score. In a duel, whoever lands closest takes the whole pot, paid straight to their wallet!",
  },
};

const randomDrop = () => {
  const loc = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const j = () => (Math.random() - 0.5) * 0.03;
  return { ...loc, lat: loc.lat + j(), lng: loc.lng + j() };
};

/** Guided practice round, shown to first-time players (and from "How to play"). */
export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [round, setRound] = useState(0);
  const [drop, setDrop] = useState(randomDrop);
  const [step, setStep] = useState<Step>("intro");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const dist = pin ? haversineM(drop.lat, drop.lng, pin.lat, pin.lng) : 0;

  const again = () => {
    setPin(null);
    setDrop(randomDrop());
    setRound((r) => r + 1);
    setStep("drop");
  };

  const place = (p: { lat: number; lng: number }) => {
    setPin(p);
    if (step === "pin") setStep("lock");
  };

  return (
    <div className="tutorial">
      <div className="tut-top">
        <span className="logo-small">
          GEO<span className="logo-pin">◉</span>DUELS
        </span>
        <span className="tut-tag">Practice round</span>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Skip tutorial
        </button>
      </div>

      {step !== "result" ? (
        <GuessStage
          key={round}
          target={{ lat: drop.lat, lng: drop.lng }}
          pin={pin}
          onPick={place}
          pinColor={PLAYER_COLORS[0]}
          canPin={step === "pin" || step === "lock"}
          lockLabel={pin ? "Lock in guess" : "Place your pin on the map"}
          canLock={!!pin && step === "lock"}
          onLock={() => setStep("result")}
          spot={step === "drop" ? "views" : step === "pin" ? "map" : step === "lock" ? "lock" : null}
        />
      ) : (
        <div className="tut-result">
          <div className="pane tall">
            <ResultMap
              target={{ lat: drop.lat, lng: drop.lng }}
              pins={pin ? [{ ...pin, color: PLAYER_COLORS[0], label: "1", winner: true }] : []}
            />
          </div>
          <div className="tut-score">
            <p className="eyebrow">You were dropped near</p>
            <h2>
              {drop.name}, <span className="accent">{drop.country}</span>
            </h2>
            <div className="score-row">
              <div>
                <div className="score-big">{formatDistance(dist)}</div>
                <div className="score-label">from the spot</div>
              </div>
              <div>
                <div className="score-big accent">{points(dist)}</div>
                <div className="score-label">of 5,000 points</div>
              </div>
            </div>
            <div className="row wrap">
              <button className="btn btn-primary btn-lg" onClick={onDone}>
                Play for real
              </button>
              <button className="btn btn-lg" onClick={again}>
                Another practice
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="coach coach-left">
        <div className="coach-bubble">
          <p>{COPY[step].text}</p>
          {COPY[step].cta && (
            <button className="btn btn-primary btn-sm" onClick={() => setStep(step === "intro" ? "drop" : "pin")}>
              {COPY[step].cta}
            </button>
          )}
        </div>
        <div className="coach-avatar">🧭</div>
      </div>
    </div>
  );
}
