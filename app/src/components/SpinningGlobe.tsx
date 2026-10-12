import { useEffect, useRef } from "react";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";
import { LOCATIONS } from "../lib/locations";

const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
const LAND = feature(topo, topo.objects.land);
const GRATICULE = geoGraticule10();

interface Blip {
  lng: number;
  lat: number;
  born: number;
}

/**
 * A real, spinning Earth (orthographic projection of Natural Earth land) while
 * the VRF oracle "scans" the planet: candidate spots blip on and off as a
 * scanner sweeps the surface.
 */
export default function SpinningGlobe({ size = 240 }: { size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = size * dpr;
    el.height = size * dpr;
    const ctx = el.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const r = size * 0.42;
    const c = size / 2;
    const projection = geoOrthographic().scale(r).translate([c, c]).clipAngle(90).precision(0.6);
    const path = geoPath(projection, ctx);
    const blips: Blip[] = [];
    let raf = 0;
    let last = performance.now();
    let rot = Math.random() * 360;
    let nextBlip = 0;

    const draw = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      rot = (rot + dt * 0.035) % 360;
      projection.rotate([rot, -18, 0]);
      const center: [number, number] = [-rot, 18];
      ctx.clearRect(0, 0, size, size);

      // atmosphere glow
      const glow = ctx.createRadialGradient(c, c, r * 0.9, c, c, r * 1.25);
      glow.addColorStop(0, "rgba(120, 200, 255, 0.35)");
      glow.addColorStop(1, "rgba(120, 200, 255, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, r * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // ocean
      const ocean = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
      ocean.addColorStop(0, "#1f5d91");
      ocean.addColorStop(0.6, "#0e3560");
      ocean.addColorStop(1, "#061a33");
      ctx.fillStyle = ocean;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();

      // graticule
      ctx.beginPath();
      path(GRATICULE);
      ctx.strokeStyle = "rgba(160, 210, 255, 0.12)";
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // land
      ctx.beginPath();
      path(LAND);
      const land = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
      land.addColorStop(0, "#9be36a");
      land.addColorStop(0.5, "#4fae5a");
      land.addColorStop(1, "#2c7442");
      ctx.fillStyle = land;
      ctx.fill();
      ctx.strokeStyle = "rgba(220, 255, 180, 0.55)";
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // candidate spots blipping on the visible side
      if (now > nextBlip) {
        const visible = LOCATIONS.filter((l) => geoDistance([l.lng, l.lat], center) < 1.25);
        const pick = visible[Math.floor(Math.random() * visible.length)];
        if (pick) blips.push({ lng: pick.lng, lat: pick.lat, born: now });
        nextBlip = now + 180 + Math.random() * 220;
      }
      for (let i = blips.length - 1; i >= 0; i--) {
        const b = blips[i];
        const age = (now - b.born) / 1100;
        if (age > 1 || geoDistance([b.lng, b.lat], center) > Math.PI / 2 - 0.05) {
          blips.splice(i, 1);
          continue;
        }
        const p = projection([b.lng, b.lat]);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2 + age * 14, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 214, 102, ${1 - age})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 240, 180, ${1 - age * 0.7})`;
        ctx.fill();
      }

      // day/night shading for depth
      const shade = ctx.createRadialGradient(c - r * 0.45, c - r * 0.5, r * 0.2, c, c, r * 1.05);
      shade.addColorStop(0, "rgba(255,255,255,0.10)");
      shade.addColorStop(0.55, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,10,0.55)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();

      // radar sweep: a soft trailing glow clipped to the planet
      const a = (now / 1100) % (Math.PI * 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.clip();
      if ("createConicGradient" in ctx) {
        // the glow fades out *behind* the sweep line (which leads at angle a)
        const trail = 1.5;
        const edge = trail / (Math.PI * 2);
        const cone = ctx.createConicGradient(a - trail, c, c);
        cone.addColorStop(0, "rgba(184,255,79,0)");
        cone.addColorStop(edge * 0.7, "rgba(184,255,79,0.10)");
        cone.addColorStop(edge, "rgba(184,255,79,0.38)");
        cone.addColorStop(Math.min(1, edge + 0.002), "rgba(184,255,79,0)");
        cone.addColorStop(1, "rgba(184,255,79,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = cone;
        ctx.fillRect(c - r, c - r, r * 2, r * 2);
      }
      // leading edge line
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(210,255,140,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      ctx.stroke();
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";

      // orbit ring + a satellite riding it
      const ring = r * 1.14;
      ctx.beginPath();
      ctx.arc(c, c, ring, 0, Math.PI * 2);
      ctx.setLineDash([2, 7]);
      ctx.lineDashOffset = -now / 50;
      ctx.strokeStyle = "rgba(184,255,79,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const sa = -now / 1600;
      const sx = c + Math.cos(sa) * ring;
      const sy = c + Math.sin(sa) * ring;
      const sat = ctx.createRadialGradient(sx, sy, 0, sx, sy, 9);
      sat.addColorStop(0, "rgba(220,255,160,1)");
      sat.addColorStop(1, "rgba(184,255,79,0)");
      ctx.fillStyle = sat;
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvas} className="spin-globe" style={{ width: size, height: size }} aria-hidden />;
}
