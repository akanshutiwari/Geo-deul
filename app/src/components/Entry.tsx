import Flyover from "./Flyover";
import ConnectCard from "./ConnectCard";

/** First screen: the world flying by, and one thing to do — connect. */
export default function Entry({ invited, onHowTo }: { invited: string | null; onHowTo: () => void }) {
  return (
    <div className="entry">
      <Flyover />
      <div className="entry-inner">
        <div className="entry-copy">
          <div className="logo-big">
            GEO<span className="logo-pin">◉</span>DUELS
          </div>
          <h1 className="shout">
            GUESS THE SPOT.
            <br />
            TAKE THE POT.
          </h1>
          <p className="entry-lede">
            Everyone gets dropped at the same random place on Earth. Drop your pin before the clock runs out — the closest
            guess wins everything in the pot.
          </p>
          <button className="btn-howto" onClick={onHowTo}>
            ▶ How to play
          </button>
        </div>
        <ConnectCard
          title={invited ? "You're invited to a duel" : "Connect to play"}
          subtitle={invited ? `Duel ${invited} is waiting for you.` : undefined}
        />
      </div>
    </div>
  );
}
