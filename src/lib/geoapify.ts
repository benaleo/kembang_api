// Geocoding via Geoapify API (key stored as worker secret GEOAPIFY_API_KEY)

export type GeoapifyPlace = {
  lat: number;
  lng: number;
  formatted: string;
};

type GeoapifyFeature = {
  properties: {
    lat: number;
    lon: number;
    formatted?: string;
  };
};

/**
 * Forward geocode: alamat teks → koordinat.
 */
export async function geoapifySearch(
  apiKey: string,
  text: string,
): Promise<GeoapifyPlace | null> {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&apiKey=${apiKey}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geoapify search failed: HTTP ${res.status}`);
  const data = (await res.json()) as { features?: GeoapifyFeature[] };
  const props = data.features?.[0]?.properties;
  if (!props) return null;
  return {
    lat: props.lat,
    lng: props.lon,
    formatted: props.formatted || text,
  };
}

/**
 * Reverse geocode: koordinat → alamat teks.
 */
export async function geoapifyReverse(
  apiKey: string,
  lat: number,
  lon: number,
): Promise<GeoapifyPlace | null> {
  const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${apiKey}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geoapify reverse failed: HTTP ${res.status}`);
  const data = (await res.json()) as { features?: GeoapifyFeature[] };
  const props = data.features?.[0]?.properties;
  if (!props) return null;
  return {
    lat: props.lat,
    lng: props.lon,
    formatted: props.formatted || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
  };
}
