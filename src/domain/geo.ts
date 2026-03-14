// ──────────────────────────────────────────────
// Geo utilities — Haversine distance + scoring
// ──────────────────────────────────────────────

export interface GeoCoord {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6_371;

/** Haversine distance in kilometers between two points. */
export function haversineKm(a: GeoCoord, b: GeoCoord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Convert distance to a 0–1 score.
 * - 0 km → 1.0
 * - `halfLifeKm` → 0.5
 * - Asymptotically approaches 0 at large distances.
 *
 * Formula: 1 / (1 + d / halfLifeKm)
 */
export function distanceToScore(distanceKm: number, halfLifeKm: number = 50): number {
  if (distanceKm <= 0) return 1.0;
  return 1 / (1 + distanceKm / halfLifeKm);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
