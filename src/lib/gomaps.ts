const ORIGIN =
  'Jl. Kepodang, Rempoa, Kec. Ciputat Tim., Kota Tangerang Selatan, Banten 15412, Indonesia';
const AVOID = 'tolls,highways';
const REGION = 'id';
const BASE_URL = 'https://maps.gomaps.pro/maps/api/distancematrix/json';

interface DistanceMatrixResponse {
  destination_addresses: string[];
  origin_addresses: string[];
  rows: Array<{
    elements: Array<{
      distance: {
        text: string;
        value: number;
      };
      duration: {
        text: string;
        value: number;
      };
      status: string;
    }>;
  }>;
  status: string;
}

export async function getDistanceKm(apiKey: string, destination: string): Promise<number> {
  const params = new URLSearchParams({
    origins: ORIGIN,
    destinations: destination,
    avoid: AVOID,
    region: REGION,
    key: apiKey,
  });

  const response = await fetch(`${BASE_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data: DistanceMatrixResponse = await response.json();

  if (data.status !== 'OK' || !data.rows[0]?.elements[0]) {
    throw new Error('Invalid response from maps API');
  }

  const element = data.rows[0].elements[0];

  if (element.status !== 'OK') {
    throw new Error(`Could not calculate distance: ${element.status}`);
  }

  const distanceValue = parseFloat(element.distance.text);
  if (isNaN(distanceValue)) {
    throw new Error('Could not parse distance value');
  }

  return distanceValue;
}
