import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { getDistanceKm, geocodeAddress } from '../lib/gomaps';

const adminCountDeliveryCost = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// Origin: toko (Jl. Kepodang, Rempoa, Tangerang Selatan)
const ORIGIN = { lat: -6.2928633, lng: 106.7548264 };

adminCountDeliveryCost.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Count Delivery Cost'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              date: z.string(),
              route: z.number(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Delivery cost calculated',
        content: {
          'application/json': {
            schema: z.object({
              distances: z.number(),
              total: z.number(),
              items: z
                .array(
                  z.object({
                    transaction_id: z.number(),
                    customer_id: z.number(),
                    distance_km: z.number(),
                    cost_delivery: z.number(),
                  }),
                )
                .optional(),
            }),
          },
        },
      },
      404: {
        description: 'No transactions / addresses found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase') as any;
    const { date, route } = c.req.valid('json');

    try {
      // 1. Get ALL transactions for this date whose route is in this group
      //    (route 1 matches 1.1, 1.2, ... — floor() comparison)
      const { data: transactions, error: txError } = await (supabase
        .from('transactions')
        .select('id, customer_id, route, cost_delivery')) as {
        data: Array<{ id: number; customer_id: number | null; route: number | null; cost_delivery: number | null }>;
        error: any;
      };

      if (txError) return c.json({ error: txError.message }, 500);

      const routeTx = (transactions || []).filter(
        (t) => t.route != null && Math.floor(t.route) === Math.floor(route),
      );

      if (routeTx.length === 0) {
        return c.json({ error: `Tidak ada transaksi di Route ${route} tanggal ${date}` }, 404);
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

      if (addrError) return c.json({ error: addrError.message }, 500);

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

      // 3. Compute distance store → customer for each route point
      const items: Array<{
        transaction_id: number;
        customer_id: number;
        distance_km: number;
        cost_delivery: number;
      }> = [];

      for (const tx of routeTx) {
        if (!tx.customer_id) continue;
        const addr = defaultByCustomer.get(tx.customer_id);
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

        let distanceMeters = 0;
        try {
          if (geo) {
            distanceMeters = await getDistanceKm(geo.lat, geo.lng) * 1000;
          } else if (addr.recipient_address) {
            const geocoded = await geocodeAddress(addr.recipient_address);
            if (geocoded) distanceMeters = (await getDistanceKm(geocoded.lat, geocoded.lng)) * 1000;
          }
        } catch (e) {
          console.error(`Error computing distance for customer ${tx.customer_id}:`, e);
        }

        const distanceKm = distanceMeters / 1000;

        // 4. Sharing ongkir per transaksi (same as old frontend logic):
        //    halfCost = max(10000, ceil(distance * 3000 / 2))
        //    cost_delivery = max(10000, ceil(halfCost / 1000) * 1000)
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
        return c.json({ error: 'Customer has no address' }, 404);
      }

      // 5. Update cost_delivery on each transaction
      for (const item of items) {
        const { error: updErr } = await (supabase
          .from('transactions')
          .update({ cost_delivery: item.cost_delivery })
          .eq('id', item.transaction_id)) as { error: any };
        if (updErr) {
          console.error(`Error updating cost_delivery for transaction ${item.transaction_id}:`, updErr);
        }
      }

      // 6. Totals for the route: total cost = total distance × 3000
      const totalDistanceKm = items.reduce((sum, i) => sum + i.distance_km, 0);
      const totalCost = Math.max(10000, Math.ceil((totalDistanceKm * 3000) / 1000) * 1000);

      // 7. Upsert transaction_deliveries record (UNIQUE on (date, parent))
      const upsertData = {
        name: `Route ${route}`,
        driver_name: '',
        time: '',
        date,
        parent: route,
        distances: totalDistanceKm < 1 ? 1 : totalDistanceKm,
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
        if (updErr) return c.json({ error: updErr.message }, 500);
      } else {
        const { error: insErr } = await (supabase
          .from('transaction_deliveries')
          .insert(upsertData)) as { error: any };
        if (insErr) return c.json({ error: insErr.message }, 500);
      }

      return c.json({
        distances: parseFloat(totalDistanceKm.toFixed(2)),
        total: totalCost,
        items,
      });
    } catch (err) {
      console.error('count-delivery-cost error:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminCountDeliveryCost;
