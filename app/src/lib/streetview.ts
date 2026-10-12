// Street-level imagery from Panoramax — the open, federated street-view
// commons (OpenStreetMap community + IGN and others). Keyless, CORS-enabled,
// and every picture links to the previous/next one in its capture sequence,
// which is what lets players walk down the street.

const API = "https://api.panoramax.xyz/api";

export interface StreetPic {
  id: string;
  collection: string;
  /** image URL (HD for 360°, SD for flat to stay snappy) */
  src: string;
  /** horizontal field of view of the camera; 360 = full panorama */
  fov: number;
  /** compass heading the camera faced (degrees), if known */
  heading: number | null;
  lat: number;
  lng: number;
  prev: string | null;
  next: string | null;
}

interface Feature {
  id: string;
  collection: string;
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown> & {
    "pers:interior_orientation"?: { field_of_view?: number };
    "view:azimuth"?: number;
  };
  assets: Record<string, { href: string }>;
  links: { rel: string; id?: string }[];
}

const toPic = (f: Feature): StreetPic => {
  const fov = f.properties["pers:interior_orientation"]?.field_of_view ?? 90;
  const link = (rel: string) => f.links.find((l) => l.rel === rel)?.id ?? null;
  return {
    id: f.id,
    collection: f.collection,
    src: (fov >= 360 ? f.assets.hd?.href : f.assets.sd?.href) ?? f.assets.hd?.href ?? f.assets.thumb.href,
    fov,
    heading: typeof f.properties["view:azimuth"] === "number" ? (f.properties["view:azimuth"] as number) : null,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    prev: link("prev"),
    next: link("next"),
  };
};

const metres = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * 110_540;
  return Math.hypot(dx, dy);
};

const searchCache = new Map<string, Promise<StreetPic[]>>();

/**
 * Pictures around a spot, best first: 360° panoramas before flat photos,
 * then nearest. Widens the search once if nothing is close.
 */
export const streetPicsNear = (lat: number, lng: number): Promise<StreetPic[]> => {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let p = searchCache.get(key);
  if (!p) {
    p = (async () => {
      for (const d of [0.02, 0.06]) {
        try {
          const res = await fetch(`${API}/search?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&limit=100`);
          const data = await res.json();
          const pics = ((data?.features ?? []) as Feature[]).filter((f) => f.assets?.sd || f.assets?.hd).map(toPic);
          if (pics.length) {
            return pics.sort(
              (a, b) =>
                Number(b.fov >= 360) - Number(a.fov >= 360) ||
                metres(lat, lng, a.lat, a.lng) - metres(lat, lng, b.lat, b.lng),
            );
          }
        } catch {
          return [];
        }
      }
      return [];
    })();
    searchCache.set(key, p);
  }
  return p;
};

const picCache = new Map<string, Promise<StreetPic | null>>();

/** One picture (with its prev/next neighbours) — used when walking. */
export const streetPic = (collection: string, id: string): Promise<StreetPic | null> => {
  let p = picCache.get(id);
  if (!p) {
    p = fetch(`${API}/collections/${collection}/items/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => (f ? toPic(f as Feature) : null))
      .catch(() => null);
    picCache.set(id, p);
  }
  return p;
};
