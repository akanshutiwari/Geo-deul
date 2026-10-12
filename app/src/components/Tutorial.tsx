import { useEffect, useState } from "react";
import { LOCATIONS } from "../lib/locations";
import { PLAYER_COLORS, formatDistance, haversineM, points, speedBonus } from "../lib/geo";
import { drivesOnLeft } from "../lib/clues";
import { ResultMap } from "./maps";
import GuessStage from "./GuessStage";

type Step = "intro" | "drop" | "clues" | "pin" | "lock" | "result";
const PRACTICE_SECS = 90;

const COPY: Record<Step, { text: string; cta?: string; next?: Step }> = {
  intro: {
    text: "Hey, I'm Atlas! Let's play one practice round so you know exactly how a duel works. Nothing is staked here.",
    cta: "Let's go",
    next: "drop",
  },
  drop: {
    text: "This is your drop, filling the whole screen. A VRF oracle picks it, so nobody can know it in advance. Drag around and zoom. The tabs up top switch between Satellite, the bare Streets grid, and Photos people took nearby.",
    cta: "Next",
    next: "clues",
  },
  clues: {
    text: "Hunt for clues! The panel shows the local time, weather and which side people drive on. Pan the map to find hidden 🔍 markers. Each one is a real sign from around here, written in the local script.",
    cta: "Got it",
    next: "pin",
  },
  pin: {
    text: "Think you know where this is? The small map in the corner grows when you hover or tap it. Click it to drop your pin, and click again to move it. ⤢ keeps it big.",
  },
  lock: {
    text: "Happy with it? Lock in! Distance matters most, but locking in early earns a speed bonus too. The bonus only counts if your guess is good, so blind fast guesses earn nothing.",
  },
  result: {
    text: "The closer and faster, the higher your score. In a duel the top score takes the whole pot, paid straight to your wallet!",
  },
};

const randomDrop = () => {
  // dev-only: `?practice=Berlin` forces a pool location for testing
  const forced = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("practice") : null;
  const match = forced ? LOCATIONS.find((l) => l.name.toLowerCase().includes(forced.toLowerCase())) : undefined;
  const loc = match ?? LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const j = () => (Math.random() - 0.5) * 0.03;
  return { ...loc, lat: loc.lat + j(), lng: loc.lng + j() };
};

/** Guided practice round, shown to first-time players (and from "How to play"). */
export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [round, setRound] = useState(0);
  const [drop, setDrop] = useState(randomDrop);
  const [step, setStep] = useState<Step>("intro");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lockedLeft, setLockedLeft] = useState(0);
  const [now, setNow] = useState(Date.now());
  const dist = pin ? haversineM(drop.lat, drop.lng, pin.lat, pin.lng) : 0;
  const timeLeft = startedAt ? Math.max(0, PRACTICE_SECS - (now - startedAt) / 1000) : PRACTICE_SECS;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const go = (s: Step) => {
    if (s === "drop" && !startedAt) setStartedAt(Date.now());
    setStep(s);
  };

  const again = () => {
    setPin(null);
    setDrop(randomDrop());
    setRound((r) => r + 1);
    setStartedAt(Date.now());
    setStep("pin");
  };

  const place = (p: { lat: number; lng: number }) => {
    setPin(p);
    if (step === "pin") setStep("lock");
  };

  const lock = () => {
    setLockedLeft(timeLeft);
    setStep("result");
  };

  const hud = startedAt ? (
    <div className="hud-top">
      <div className="timer timer-sm" style={{ ["--p" as string]: timeLeft / PRACTICE_SECS }}>
        <span className="mono">{Math.ceil(timeLeft)}</span>
      </div>
      <div>
        <div className="mono hud-pot">Practice round</div>
        <div className="hud-sub">Lock in early for a speed bonus</div>
      </div>
    </div>
  ) : null;

  const dPts = points(dist);
  const bonus = speedBonus(dist, lockedLeft, PRACTICE_SECS);

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
          onLock={lock}
          spot={step === "drop" ? "views" : step === "clues" ? "clues" : step === "pin" ? "map" : step === "lock" ? "lock" : null}
          hide={[drop.name, drop.country]}
          driveLeft={drivesOnLeft(drop.country, drop.name)}
          timeLeft={timeLeft}
          totalTime={PRACTICE_SECS}
          hud={hud}
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
                <div className="score-big accent">{(dPts + bonus).toLocaleString()}</div>
                <div className="score-label">
                  {dPts} distance + {bonus} speed
                </div>
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
          {COPY[step].cta && COPY[step].next && (
            <button className="btn btn-primary btn-sm" onClick={() => go(COPY[step].next!)}>
              {COPY[step].cta}
            </button>
          )}
        </div>
        <div className="coach-avatar">🧭</div>
      </div>
    </div>
  );
}
