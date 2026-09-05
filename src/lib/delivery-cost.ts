import { geocodeAddress, getMapboxMatrix } from './gomaps';

// Origin: toko (Jl. Kepodang, Rempoa, Tangerang Selatan)
const ORIGIN = { lat: -6.292556760455276, lng: 106.75487235394468 };

const roundToOneDecimal = (value: number) => Math.round(value * 10) / 10;

export interface DeliveryCostItem {
  transaction_id: number;
  customer_id: number;
  distance_km: number;
  cost_delivery: number;
}

export interface DeliveryCostResult {
  distances: number;
  total: number;
  items: DeliveryCostItem[];
}

/**
 * Hitung biaya pengiriman + upah driver untuk satu route.
 *
 * Formula (sama dengan logika lama frontend):
 * - Per transaksi: halfCost = max(10000, ceil(distanceKm * 3000 / 2)),
 *   cost_delivery = max(10000, ceil(halfCost / 1000) * 1000)
 * - Total route (upah driver) = max(10000, ceil(totalDistanceKm * 3000 / 1000) * 1000)
 *
 * Efek samping:
 * - Update `cost_delivery` di tabel transactions
 * - Upsert `transaction_deliveries` (UNIQUE (date, parent))
 */
export async function computeDeliveryCost(
  date: string,
  route: number,
  supabase: any,
  geoapifyApiKey: string,
  mapboxAccessToken: string,
): Promise<DeliveryCostResult> {
  // 1. Get ALL transactions for this date whose route is in this group
  //    (route 1 matches 1.1, 1.2, ... — floor() comparison)
  const { data: transactions, error: txError } = await (supabase
    .from('transactions')
    .select('id, customer_id, route, cost_delivery')
    .eq('date', date)) as {
    data: Array<{ id: number; customer_id: number | null; route: number | null; cost_delivery: number | null }>;
    error: any;
  };

  if (txError) throw new Error(txError.message);

  const routeTx = (transactions || [])
    .filter((t) => t.route != null && Math.floor(t.route) === Math.floor(route))
    .sort((a, b) => (a.route ?? 0) - (b.route ?? 0));

  if (routeTx.length === 0) {
    throw new Error(`Tidak ada transaksi di Route ${route} tanggal ${date}`);
  }

  const customerIds = routeTx
    .map((t) => t.customer_id)
    .filter((id): id is number => !!id);

  // 2. Get addresses from customer_addresses (geo ada di sini, bukan customers)
  const { data: addresses, error: addrError } = await (supabase
    .from('customer_addresses')
    .select(
      'customer_id, recipient_geo, recipient_address, recipient_distances, is_default',
    )
    .in('customer_id', customerIds)) as {
    data: Array<{
      customer_id: number;
      recipient_geo: string | { lat: number; lng: number } | null;
      recipient_address: string | null;
      recipient_distances: number | null;
      is_default: boolean | null;
    }>;
    error: any;
  };

  if (addrError) throw new Error(addrError.message);

  // Pick default address per customer (is_default=true else first)
  const defaultByCustomer = new Map<number, (typeof addresses)[0]>();
  for (const addr of addresses || []) {
    if (!defaultByCustomer.has(addr.customer_id)) {
      defaultByCustomer.set(addr.customer_id, addr);
    } else {
      const current = defaultByCustomer.get(addr.customer_id)!;
      if (addr.is_default && !current.is_default) {
        defaultByCustomer.set(addr.customer_id, addr);
      }
    }
  }

  // 3. Geocode/parse koordinat per unique customer (urutan sesuai route ascending),
  //    lalu hitung SEMUA jarak (radial toko→customer + sequential toko→stop1→stop2→...)
  //    dalam SATU call Mapbox Directions Matrix (hindari N subrequest terpisah).
  const geoByCustomer = new Map<number, { lat: number; lng: number }>();

  const orderedCustomerIds = [
    ...new Set(routeTx.map((t) => t.customer_id).filter((id): id is number => !!id)),
  ];

  for (const customerId of orderedCustomerIds) {
    const addr = defaultByCustomer.get(customerId);
    if (!addr) continue;

    let geo: { lat: number; lng: number } | null = null;
    if (typeof addr.recipient_geo === 'string') {
      try {
        const parsed = JSON.parse(addr.recipient_geo) as { lat: number; lng: number };
        if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') geo = parsed;
      } catch {}
    } else if (addr.recipient_geo && typeof addr.recipient_geo.lat === 'number') {
      geo = addr.recipient_geo;
    }

    if (!geo && addr.recipient_address) {
      try {
        geo = await geocodeAddress(geoapifyApiKey, addr.recipient_address);
      } catch (e) {
        console.error(`Error geocoding address for customer ${customerId}:`, e);
      }
    }

    if (geo) geoByCustomer.set(customerId, geo);
  }

  const geocodedCustomerIds = orderedCustomerIds.filter((id) => geoByCustomer.has(id));

  const distanceKmByCustomer = new Map<number, number>();
  let totalRouteDistanceKm = 0;

  if (geocodedCustomerIds.length > 0) {
    const points = geocodedCustomerIds.map((id) => geoByCustomer.get(id)!);
    const { radialKm, sequentialTotalKm } = await getMapboxMatrix(mapboxAccessToken, points);
    geocodedCustomerIds.forEach((id, i) => distanceKmByCustomer.set(id, radialKm[i] ?? 0));
    totalRouteDistanceKm = sequentialTotalKm;
  }

  const items: DeliveryCostItem[] = [];

  for (const tx of routeTx) {
    if (!tx.customer_id) continue;
    if (!defaultByCustomer.has(tx.customer_id)) continue;
    const distanceKm = distanceKmByCustomer.get(tx.customer_id) ?? 0;

    // 4. Sharing ongkir per transaksi
    const halfCost = Math.max(10000, Math.ceil((distanceKm * 3000) / 2));
    const costDelivery = Math.max(10000, Math.ceil(halfCost / 1000) * 1000);

    items.push({
      transaction_id: tx.id,
      customer_id: tx.customer_id,
      distance_km: parseFloat(distanceKm.toFixed(2)),
      cost_delivery: costDelivery,
    });
  }

  if (items.length === 0) {
    throw new Error('Customer has no address');
  }

  // 5. Update cost_delivery on all transactions in a single batched request
  //    (per-row updates blow past the Workers subrequest limit on large routes)
  const { error: updErr } = await (supabase
    .from('transactions')
    .upsert(items.map((i) => ({ id: i.transaction_id, cost_delivery: i.cost_delivery })))) as {
    error: any;
  };
  if (updErr) {
    console.error('Error batch-updating cost_delivery:', updErr);
  }

  // 6. Totals for the route: total cost = total distance (jarak berurutan toko→stop1→stop2→...) × 3000
  const totalDistanceKm = totalRouteDistanceKm;
  const totalCost = Math.max(10000, Math.ceil((totalDistanceKm * 3000) / 1000) * 1000);

  // 7. Upsert transaction_deliveries record (UNIQUE on (date, parent))
  const routeName = `ROUTE ${route}`;
  const upsertData = {
    name: routeName,
    driver_name: routeName,
    time: '',
    date,
    parent: route,
    distances: Math.max(1, roundToOneDecimal(totalDistanceKm)),
    total: totalCost,
  };

  const { data: existing } = await (supabase
    .from('transaction_deliveries')
    .select('id')
    .eq('date', date)
    .eq('parent', route)) as { data: Array<{ id: number }> };

  if (existing && existing.length > 0) {
    const { error: updErr } = await (supabase
      .from('transaction_deliveries')
      .update(upsertData)
      .eq('date', date)
      .eq('parent', route)) as { error: any };
    if (updErr) throw new Error(updErr.message);
  } else {
    const { error: insErr } = await (supabase
      .from('transaction_deliveries')
      .insert(upsertData)) as { error: any };
    if (insErr) throw new Error(insErr.message);
  }

  return {
    distances: parseFloat(totalDistanceKm.toFixed(2)),
    total: totalCost,
    items,
  };
}

export { ORIGIN };
