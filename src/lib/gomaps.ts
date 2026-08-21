// Road distance calculation via OSRM (OpenStreetMap Routing Machine)
// Origin: Jl. Kepodang, Rempoa, Ciputat Timur, Tangerang Selatan
// No API key needed — uses free public OSRM server

const ORIGIN = { lat: -6.2928633, lng: 106.7548264 };
const OSRM_BASES = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];
const ROUTE_FACTOR = 1.35;

function getFallbackDistanceKm(destLat: number, destLng: number): number {
  const earthRadiusKm = 6371;
  const toRad = (degree: number) => (degree * Math.PI) / 180;
  const deltaLat = toRad(destLat - ORIGIN.lat);
  const deltaLng = toRad(destLng - ORIGIN.lng);
  const originLat = toRad(ORIGIN.lat);
  const targetLat = toRad(destLat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(targetLat) * Math.sin(deltaLng / 2) ** 2;
  const straightDistanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Math.round(straightDistanceKm * ROUTE_FACTOR * 100) / 100;
}

/**
 * Hitung jarak jalan (km) dari toko ke koordinat tujuan via OSRM.
 */
export async function getDistanceKm(destLat: number, destLng: number): Promise<number> {
  const errors: string[] = [];

  for (const osrmBase of OSRM_BASES) {
    const url = `${osrmBase}/${ORIGIN.lng},${ORIGIN.lat};${destLng},${destLat}?overview=false`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'kembang-api/1.0',
        },
      });

      if (!response.ok) {
        errors.push(`${osrmBase}: HTTP ${response.status}`);
        continue;
      }

      const data = (await response.json()) as {
        code: string;
        routes: Array<{ distance: number }>;
      };
      if (data.code !== 'Ok' || !data.routes?.[0]) {
        errors.push(`${osrmBase}: ${data.code || 'no routes'}`);
        continue;
      }

      const meters = data.routes[0].distance;
      return Math.round((meters / 1000) * 100) / 100;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      errors.push(`${osrmBase}: ${message}`);
    }
  }

  console.warn(`OSRM unavailable, using fallback distance: ${errors.join('; ')}`);
  return getFallbackDistanceKm(destLat, destLng);
}

/**
 * Geocode alamat teks → koordinat via Nominatim (OpenStreetMap).
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'kembang-api/1.0' },
  });
  if (!response.ok) return null;
  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

/**
 * Hitung jarak (km) dari koordinat peta (recipient_geo) atau geocode alamat teks.
 * Return 0 kalau tidak ada koordinat maupun alamat.
 */
export async function computeDistance(body: {
  recipient_address?: string | null;
  recipient_geo?: { lat: number; lng: number } | null;
}): Promise<number> {
  if (body.recipient_geo?.lat !== undefined && body.recipient_geo?.lng !== undefined) {
    return getDistanceKm(body.recipient_geo.lat, body.recipient_geo.lng);
  }
  if (body.recipient_address) {
    const geo = await geocodeAddress(body.recipient_address);
    if (geo) return getDistanceKm(geo.lat, geo.lng);
  }
  return 0;
}
