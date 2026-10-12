// Clues for a drop, all keyless and computed from the coordinates alone:
//  • live local time + weather (Open-Meteo)
//  • real signs / shop / street names around the spot (OpenStreetMap via Photon)
//    which players discover by exploring the map
//  • which script those signs use, nearby places of worship, driving side
// Anything that would literally name the place is filtered out.

export interface SignClue {
  id: number;
  lat: number;
  lng: number;
  /** what kind of thing the sign belongs to */
  kind: string;
  icon: string;
  /** the text exactly as written locally */
  text: string;
}

export interface Clues {
  localTime?: string;
  daylight?: boolean;
  utcOffset?: string;
  tempC?: number;
  weather?: string;
  signs: SignClue[];
  worship: Record<string, number>;
  drivesOnLeft?: boolean;
}

const WEATHER: Record<number, string> = {
  0: "Clear sky ☀️", 1: "Mostly clear 🌤️", 2: "Partly cloudy ⛅", 3: "Overcast ☁️", 45: "Fog 🌫️", 48: "Freezing fog 🌫️",
  51: "Light drizzle 🌦️", 53: "Drizzle 🌦️", 55: "Heavy drizzle 🌧️", 61: "Light rain 🌧️", 63: "Rain 🌧️", 65: "Heavy rain 🌧️",
  66: "Freezing rain 🧊", 67: "Freezing rain 🧊", 71: "Light snow 🌨️", 73: "Snow 🌨️", 75: "Heavy snow ❄️", 77: "Snow grains ❄️",
  80: "Rain showers 🌦️", 81: "Rain showers 🌧️", 82: "Violent showers ⛈️", 85: "Snow showers 🌨️", 86: "Snow showers ❄️",
  95: "Thunderstorm ⛈️", 96: "Thunderstorm with hail ⛈️", 99: "Thunderstorm with hail ⛈️",
};

// countries in the drop pool that drive on the left
const LEFT_DRIVING = new Set([
  "UK", "Ireland", "Japan", "Australia", "New Zealand", "South Africa", "Kenya", "Tanzania", "Zimbabwe", "Botswana",
  "Namibia", "India", "Nepal", "Thailand", "Indonesia", "Malaysia", "Singapore", "Maldives",
]);

export const drivesOnLeft = (country: string, name: string) => LEFT_DRIVING.has(country) || /hong kong/i.test(name);

const KIND_ICON: [RegExp, string, string][] = [
  [/place_of_worship/, "🛐", "Place of worship"],
  [/restaurant|fast_food|food_court/, "🍽️", "Restaurant"],
  [/cafe/, "☕", "Café"],
  [/bar|pub/, "🍺", "Bar"],
  [/school|college|university|kindergarten/, "🏫", "School"],
  [/hospital|clinic|pharmacy|doctors/, "🏥", "Health"],
  [/bank|atm/, "🏦", "Bank"],
  [/fuel/, "⛽", "Fuel station"],
  [/hotel|hostel|guest_house/, "🏨", "Lodging"],
  [/supermarket|convenience|mall|department_store/, "🛒", "Shop"],
  [/bus_stop|station|halt|tram_stop/, "🚏", "Stop"],
  [/museum|attraction|artwork|viewpoint|monument|memorial|castle/, "🏛️", "Landmark"],
  [/park|garden|pitch|stadium|sports/, "🌳", "Park / sports"],
  [/highway/, "🛣️", "Street sign"],
  [/shop/, "🛍️", "Shop"],
];

const kindOf = (tags: Record<string, string>) => {
  const blob = Object.entries(tags)
    .filter(([k]) => /^(amenity|shop|tourism|leisure|railway|historic|highway|public_transport)$/.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  for (const [re, icon, kind] of KIND_ICON) if (re.test(blob)) return { icon, kind };
  return { icon: "🪧", kind: "Sign" };
};

/** Unicode script a piece of text is mostly written in. */
export const scriptOf = (text: string): string => {
  const tests: [RegExp, string][] = [
    [/[Ͱ-Ͽ]/, "Greek"], [/[Ѐ-ӿ]/, "Cyrillic"], [/[֐-׿]/, "Hebrew"],
    [/[؀-ۿݐ-ݿ]/, "Arabic"], [/[ऀ-ॿ]/, "Devanagari"], [/[ঀ-৿]/, "Bengali"],
    [/[஀-௿]/, "Tamil"], [/[฀-๿]/, "Thai"], [/[Ⴀ-ჿ]/, "Georgian"],
    [/[԰-֏]/, "Armenian"], [/[ሀ-፿]/, "Ethiopic"], [/[ក-៿]/, "Khmer"],
    [/[぀-ヿ]/, "Japanese kana"], [/[가-힯]/, "Hangul (Korean)"], [/[一-鿿]/, "Chinese characters"],
    [/[က-႟]/, "Myanmar"], [/[᠀-᢯]/, "Mongolian"],
  ];
  for (const [re, name] of tests) if (re.test(text)) return name;
  if (/[À-ž]/.test(text)) return "Latin with accents";
  return "Latin";
};

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { osm_key?: string; osm_value?: string; name?: string; type?: string };
}

// only things that carry a local sign — never place / boundary names
const SIGN_KEYS = /^(amenity|shop|tourism|leisure|highway|railway|historic|office|craft|club|public_transport|building)$/;

/** Named OSM features nearest to a point (Photon reverse geocoder, keyless). */
const photonNear = async (lat: number, lng: number): Promise<PhotonFeature[]> => {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=12&radius=1.5&lang=default`);
    const d = await res.json();
    return (d?.features ?? []) as PhotonFeature[];
  } catch {
    return [];
  }
};

const metres = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * 110_540;
  return Math.hypot(dx, dy);
};

const cache = new Map<string, Promise<Clues>>();

/**
 * Gather clues for a spot. `hide` = words that would give the answer away
 * (place / country names); any sign containing one is dropped.
 */
export const cluesFor = (lat: number, lng: number, hide: string[] = []): Promise<Clues> => {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let p = cache.get(key);
  if (p) return p;

  const banned = hide
    .flatMap((h) => h.split(/[\s,()/-]+/))
    .filter((w) => w.length >= 4)
    .map((w) => w.toLowerCase());

  const weather = fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day&timezone=auto`,
  )
    .then((r) => r.json())
    .catch(() => null);

  // sample a ring of points so clues are scattered across the area to explore
  const probes = [[0, 0], ...Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * 2 * Math.PI + Math.random();
    const r = 0.008 + Math.random() * 0.012; // ~1–2 km out
    return [Math.sin(a) * r, (Math.cos(a) * r) / Math.max(0.2, Math.cos((lat * Math.PI) / 180))];
  })];
  const osm = Promise.all(probes.map(([dy, dx]) => photonNear(lat + dy, lng + dx))).then((all) => all.flat());

  p = Promise.all([weather, osm]).then(([w, feats]) => {
    const clues: Clues = { signs: [], worship: {} };
    if (w?.current) {
      const t = String(w.current.time); // local ISO time, e.g. 2026-10-12T21:15
      clues.localTime = t.slice(11, 16);
      clues.daylight = w.current.is_day === 1;
      const off = (w.utc_offset_seconds ?? 0) / 3600;
      clues.utcOffset = `UTC${off >= 0 ? "+" : "−"}${Math.abs(off)}`;
      clues.tempC = Math.round(w.current.temperature_2m);
      clues.weather = WEATHER[w.current.weather_code] ?? "—";
    }

    const seen = new Set<string>();
    const picked: SignClue[] = [];
    // shuffle so the hunt differs between rounds at the same place
    for (const f of feats.sort(() => Math.random() - 0.5)) {
      const pr = f.properties;
      const text = (pr.name ?? "").trim();
      const [pLng, pLat] = f.geometry?.coordinates ?? [];
      if (!text || pLat === undefined || !SIGN_KEYS.test(pr.osm_key ?? "")) continue;
      const tags: Record<string, string> = { [pr.osm_key!]: pr.osm_value ?? "" };
      if (pr.osm_value === "place_of_worship") clues.worship["🛐 Places of worship"] = (clues.worship["🛐 Places of worship"] ?? 0) + 1;
      const low = text.toLowerCase();
      if (seen.has(low) || text.length > 48 || banned.some((b) => low.includes(b))) continue;
      // keep clues spread out so players actually have to roam
      if (picked.some((s) => metres(s.lat, s.lng, pLat, pLng) < 180)) continue;
      seen.add(low);
      const { icon, kind } = kindOf(tags);
      picked.push({ id: picked.length, lat: pLat, lng: pLng, kind, icon, text });
      if (picked.length >= 16) break;
    }
    clues.signs = picked;
    return clues;
  });
  cache.set(key, p);
  return p;
};
