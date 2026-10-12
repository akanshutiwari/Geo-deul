// Keyless clue sources for a drop: Esri imagery availability + nearby photos
// from Wikimedia Commons.

const TILEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap";

const tileOf = (lat: number, lng: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
};

const zoomCache = new Map<string, Promise<number>>();

/**
 * Deepest zoom with real satellite imagery at this spot (Esri serves a grey
 * "Map data not yet available" tile beyond it — e.g. Antarctica stops at 13).
 */
export const imageryMaxZoom = (lat: number, lng: number): Promise<number> => {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  let p = zoomCache.get(key);
  if (!p) {
    p = (async () => {
      for (const z of [18, 17, 16, 15, 14, 13, 12, 11]) {
        try {
          const { x, y } = tileOf(lat, lng, z);
          const res = await fetch(`${TILEMAP}/${z}/${y}/${x}/1/1`);
          const d = await res.json();
          if (d?.data?.[0] === 1) return z;
        } catch {
          return 17; // probe unavailable: assume decent coverage
        }
      }
      return 10;
    })();
    zoomCache.set(key, p);
  }
  return p;
};

export interface PlacePhoto {
  src: string;
  thumb: string;
  author: string;
  license: string;
  page: string;
}

const strip = (html = "") => html.replace(/<[^>]*>/g, "").trim().slice(0, 60);
// skip files that are maps, logos, scans… or whose name would give the place away
const JUNK = /map|logo|flag|coat[_ ]of|diagram|plan\b|chart|scan|document|cover|poster|ticket|stamp|seal|icon|symbol/i;

const photoCache = new Map<string, Promise<PlacePhoto[]>>();

/** Up to `limit` photos taken within ~10 km of the spot (Wikimedia Commons, CC-licensed). */
export const placePhotos = (lat: number, lng: number, limit = 12): Promise<PlacePhoto[]> => {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let p = photoCache.get(key);
  if (!p) {
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
      `&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=10000&ggslimit=50&ggsnamespace=6` +
      "&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1280";
    p = fetch(url)
      .then((r) => r.json())
      .then((d) => {
        const pages = Object.values(d?.query?.pages ?? {}) as {
          title: string;
          index?: number;
          imageinfo?: {
            mime: string;
            width: number;
            height: number;
            thumburl?: string;
            url: string;
            descriptionurl: string;
            extmetadata?: Record<string, { value: string }>;
          }[];
        }[];
        return pages
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .filter((pg) => {
            const ii = pg.imageinfo?.[0];
            return ii && ii.mime === "image/jpeg" && ii.width >= 640 && ii.width >= ii.height * 0.6 && !JUNK.test(pg.title);
          })
          .slice(0, limit)
          .map((pg) => {
            const ii = pg.imageinfo![0];
            const meta = ii.extmetadata ?? {};
            return {
              src: ii.thumburl || ii.url,
              thumb: (ii.thumburl || ii.url).replace(/\/\d+px-/, "/330px-"),
              author: strip(meta.Artist?.value) || "Wikimedia Commons",
              license: strip(meta.LicenseShortName?.value),
              page: ii.descriptionurl,
            };
          });
      })
      .catch(() => []);
    photoCache.set(key, p);
  }
  return p;
};
