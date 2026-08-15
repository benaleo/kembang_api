import { getDistanceKm } from './gomaps';
import { computeDeliveryCost } from './delivery-cost';

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  execute: (params: Record<string, any>, supabase: any) => Promise<Record<string, any>>;
}

// ---------------------------------------------------------------------------
// generateInvoice — duplicated from admin-transactions for tool isolation
// ---------------------------------------------------------------------------

function generateInvoice(sequence: number, date: string, prefix = 'KEMBANGSELADANG'): string {
  const dateObj = new Date(date);
  const day = dateObj.getDate();
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();
  return `${sequence}-${day}/${month}/${year}/${prefix}`;
}

function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const aiTools: AiTool[] = [
  {
    name: 'searchCustomers',
    description: 'Cari pelanggan berdasarkan nama atau nomor telepon',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: 'Nama atau telepon yang dicari' },
      },
      required: ['keyword'],
    },
    async execute(params, supabase) {
      const { keyword } = params;
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone')
        .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`)
        .limit(10);
      if (error) return { error: error.message };
      if (!data || data.length === 0) return { results: [], message: 'Tidak ditemukan pelanggan dengan kata kunci tersebut' };
      return { results: data };
    },
  },
  {
    name: 'listProducts',
    description: 'Daftar semua produk aktif',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    async execute(_params, supabase) {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, code, price, is_active')
        .eq('is_active', true)
        .order('name');
      if (error) return { error: error.message };
      if (!data || data.length === 0) return { results: [], message: 'Tidak ada produk aktif' };
      return {
        results: data.map((p: any) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          price: formatRupiah(p.price),
        })),
      };
    },
  },
  {
    name: 'createOrder',
    description:
      'Buat pesanan baru. Konfirmasi detail ke user terlebih dahulu SEBELUM memanggil tool ini.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Tanggal pesanan (YYYY-MM-DD)' },
        customer_id: { type: 'number', description: 'ID pelanggan' },
        customer_name: { type: 'string', description: 'Nama pelanggan (opsional)' },
        customer_phone: { type: 'string', description: 'Nomor telepon pelanggan (opsional)' },
        name_alter: { type: 'string', description: 'Nama alternatif / nama penerima' },
        note: { type: 'string', description: 'Catatan pesanan' },
        note_route: { type: 'string', description: 'Catatan rute' },
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'number' },
              qty: { type: 'number' },
              price: { type: 'number' },
            },
            required: ['product_id', 'qty', 'price'],
          },
          description: 'Daftar produk dalam pesanan',
        },
      },
      required: ['date', 'customer_id', 'name_alter', 'products'],
    },
    async execute(params, supabase) {
      const { date, customer_id, customer_name = '', customer_phone = '', name_alter, note = '', note_route = '', products } = params;

      if (!products || products.length === 0) {
        return { error: 'Pesanan harus memiliki minimal 1 produk' };
      }

      // 1. Generate invoice
      const { data: sequenceData, error: seqError } = await supabase
        .from('transaction_sequence_view')
        .select('max_sequence')
        .maybeSingle();
      if (seqError) return { error: seqError.message };
      const maxSeq = (sequenceData as any)?.max_sequence;
      const sequence = maxSeq ? maxSeq + 1 : 1;
      const invoice = generateInvoice(sequence, date, 'KEMBANGSELADANG');

      // 2. Insert transaction
      const { data: createdTransaction, error: txError } = await supabase
        .from('transactions')
        .insert([
          {
            date,
            customer_id: customer_id || null,
            customer_name,
            customer_phone,
            name_alter,
            note,
            note_route,
            invoice,
          },
        ])
        .select()
        .single();
      if (txError) return { error: txError.message };
      if (!createdTransaction?.id) return { error: 'Gagal membuat transaksi' };

      // 3. Insert products (level-1 only, no children)
      const { data: parentRows, error: parentInsertError } = await supabase
        .from('transaction_products')
        .insert(
          products.map((p: any) => ({
            transaction_id: createdTransaction.id,
            product_id: p.product_id,
            qty: p.qty,
            is_free: false,
            parent_id: null,
          })),
        )
        .select('id, product_id');
      if (parentInsertError) return { error: parentInsertError.message };

      // 4. cost_order = sum of (price * qty)
      const cost_order = products.reduce(
        (total: number, p: any) => total + p.price * p.qty,
        0,
      );

      if (cost_order !== 0) {
        await supabase
          .from('transactions')
          .update({ cost_order })
          .eq('id', createdTransaction.id);
      }

      return {
        message: `Pesanan berhasil dibuat`,
        invoice,
        transaction_id: createdTransaction.id,
        total: formatRupiah(cost_order),
        products_count: products.length,
      };
    },
  },
  {
    name: 'listOrdersByDate',
    description: 'Daftar pesanan berdasarkan tanggal',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Tanggal pesanan (YYYY-MM-DD)' },
      },
      required: ['date'],
    },
    async execute(params, supabase) {
      const { date } = params;
      const { data, error } = await supabase
        .from('transactions')
        .select('id, invoice, customer_name, name_alter, cost_order, cost_delivery, note, route, created_at')
        .eq('date', date)
        .order('id', { ascending: true });
      if (error) return { error: error.message };
      if (!data || data.length === 0) return { results: [], message: `Tidak ada pesanan tanggal ${date}` };

      // Fetch products for each transaction
      const txIds = data.map((t: any) => t.id);
      const { data: tpData } = await supabase
        .from('transaction_products')
        .select('transaction_id, product_id, qty')
        .in('transaction_id', txIds);

      const { data: productNames } = await supabase
        .from('products')
        .select('id, name')
        .in('id', [...new Set((tpData || []).map((tp: any) => tp.product_id))]);
      const productMap = new Map((productNames || []).map((p: any) => [p.id, p.name]));

      const orders = data.map((t: any) => {
        const items = (tpData || [])
          .filter((tp: any) => tp.transaction_id === t.id)
          .map((tp: any) => ({
            product: productMap.get(tp.product_id) || `#${tp.product_id}`,
            qty: tp.qty,
          }));
        return {
          id: t.id,
          invoice: t.invoice,
          customer: t.customer_name || t.name_alter || '-',
          total: t.cost_order ? formatRupiah(t.cost_order) : '-',
          route: t.route,
          items,
        };
      });

      return { date, count: orders.length, orders };
    },
  },
  {
    name: 'getDistance',
    description: 'Hitung jarak dari toko ke suatu titik koordinat',
    input_schema: {
      type: 'object' as const,
      properties: {
        latitude: { type: 'number', description: 'Latitude tujuan' },
        longitude: { type: 'number', description: 'Longitude tujuan' },
      },
      required: ['latitude', 'longitude'],
    },
    async execute(params) {
      const { latitude, longitude } = params;
      try {
        const distanceKm = await getDistanceKm(latitude, longitude);
        return {
          distance_km: distanceKm,
          distance_formatted: `${distanceKm} km dari toko`,
        };
      } catch (e) {
        return { error: 'Gagal menghitung jarak. Pastikan koordinat valid.' };
      }
    },
  },
  {
    name: 'calcDeliveryCostAndDriverWage',
    description:
      'Hitung biaya pengiriman per transaksi DAN upah driver untuk suatu route. ' +
      'upah driver = Rp3000/km × total jarak, minimum Rp10.000.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Tanggal (YYYY-MM-DD)' },
        route: { type: 'number', description: 'Nomor route (misal 1.0, 2.0, dll)' },
      },
      required: ['date', 'route'],
    },
    async execute(params, supabase) {
      const { date, route } = params;
      try {
        const result = await computeDeliveryCost(date, route, supabase);
        return {
          distances: result.distances,
          total: formatRupiah(result.total),
          total_raw: result.total,
          items: result.items.map((i) => ({
            transaction_id: i.transaction_id,
            customer_id: i.customer_id,
            distance_km: i.distance_km,
            cost_delivery: formatRupiah(i.cost_delivery),
          })),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Gagal menghitung biaya pengiriman';
        return { error: message };
      }
    },
  },
];
