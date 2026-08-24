import { computeDeliveryCost } from './delivery-cost';

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  execute: (params: Record<string, any>, supabase: any, geoapifyApiKey?: string, mapboxAccessToken?: string) => Promise<Record<string, any>>;
}

const API_BASE = 'http://localhost:8787';

async function apiGet(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': 'kembang-internal',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function apiPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': 'kembang-internal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiPatch(path: string, body: any): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': 'kembang-internal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export const aiTools: AiTool[] = [
  {
    name: 'searchCustomers',
    description: 'Cari pelanggan berdasarkan nama atau nomor telepon',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Nama atau nomor telepon pelanggan' },
      },
      required: ['keyword'],
    },
    async execute(params) {
      const { keyword } = params;
      const data = await apiGet('/api/v1/admin/customers', { search: keyword });
      return {
        customers: (data?.data || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          address: c.address,
        })),
      };
    },
  },
  {
    name: 'createCustomer',
    description:
      'Daftarkan pelanggan baru. PENTING: tampilkan ringkasan data ke user untuk konfirmasi SEBELUM memanggil tool ini. Gunakan hanya kalau pelanggan tidak ditemukan saat searchCustomers.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama lengkap pelanggan' },
        phone: { type: 'string', description: 'Nomor telepon (format lokal, contoh 0812xxxx)' },
        address: { type: 'string', description: 'Alamat lengkap pelanggan' },
        place: { type: 'string', description: 'Tempat/patokan lokasi' },
        address_note: { type: 'string', description: 'Catatan tambahan untuk kurir' },
      },
      required: ['name'],
    },
    async execute(params) {
      const { name, phone, address, place, address_note } = params;
      if (!name || !name.trim()) {
        return { error: 'Nama pelanggan wajib diisi' };
      }
      const data = await apiPost('/api/v1/admin/customers', {
        name: name.trim(),
        phone: phone || null,
        address: address || null,
        place: place || null,
        address_note: address_note || null,
      });
      return {
        success: true,
        customer_id: data?.id,
        customer: {
          id: data?.id,
          name: data?.name,
          phone: data?.phone,
          address: data?.address,
        },
        message: `Pelanggan ${data?.name} berhasil didaftarkan (ID: ${data?.id})`,
      };
    },
  },
  {
    name: 'updateCustomer',
    description:
      'Perbarui data pelanggan yang sudah ada berdasarkan ID. Hanya kirim field yang ingin diubah. PENTING: konfirmasi ke user SEBELUM memanggil tool ini.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'number', description: 'ID pelanggan yang akan diubah' },
        name: { type: 'string', description: 'Nama baru (opsional)' },
        phone: { type: 'string', description: 'Nomor telepon baru (opsional)' },
        address: { type: 'string', description: 'Alamat baru (opsional)' },
        place: { type: 'string', description: 'Tempat/patokan baru (opsional)' },
        address_note: { type: 'string', description: 'Catatan kurir baru (opsional)' },
      },
      required: ['customer_id'],
    },
    async execute(params) {
      const { customer_id, ...updates } = params;
      if (!customer_id) {
        return { error: 'customer_id wajib diisi' };
      }
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
      }
      if (Object.keys(clean).length === 0) {
        return { error: 'Tidak ada field yang akan diubah' };
      }
      const data = await apiPatch(`/api/v1/admin/customers/${customer_id}`, clean);
      return {
        success: true,
        customer: {
          id: data?.id,
          name: data?.name,
          phone: data?.phone,
          address: data?.address,
        },
        message: `Data pelanggan ${data?.name} berhasil diperbarui`,
      };
    },
  },
  {
    name: 'listProducts',
    description: 'Daftar semua produk yang tersedia beserta harga',
    input_schema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const data = await apiGet('/api/v1/admin/products');
      return {
        products: (data?.data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          price: p.price,
          price_formatted: formatRupiah(p.price || 0),
          is_active: p.is_active,
        })),
      };
    },
  },
  {
    name: 'createOrder',
    description: 'Buat pesanan baru untuk pelanggan. PENTING: tampilkan detail ke user untuk konfirmasi SEBELUM memanggil tool ini.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Tanggal pesanan format YYYY-MM-DD' },
        customer_id: { type: 'number', description: 'ID pelanggan' },
        note: { type: 'string', description: 'Catatan pesanan' },
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
      required: ['date', 'customer_id', 'products'],
    },
    async execute(params) {
      const { date, customer_id, note, products } = params;
      if (!products || products.length === 0) {
        return { error: 'Pesanan harus memiliki minimal 1 produk' };
      }
      const data = await apiPost('/api/v1/admin/transactions', {
        date,
        customer_id,
        note: note || '',
        products,
      });
      return {
        success: true,
        transaction_id: data?.data?.id,
        message: `Pesanan berhasil dibuat (ID: ${data?.data?.id})`,
      };
    },
  },
  {
    name: 'listOrdersByDate',
    description: 'Daftar pesanan berdasarkan tanggal',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Tanggal format YYYY-MM-DD' },
      },
      required: ['date'],
    },
    async execute(params) {
      const { date } = params;
      const data = await apiGet('/api/v1/admin/transactions', { date });
      return {
        orders: (data?.data || []).map((t: any) => ({
          id: t.id,
          customer_name: t.customer_name,
          date: t.date,
          route: t.route,
          cost_delivery: t.cost_delivery,
          products: t.products || [],
        })),
        total: data?.meta?.total || 0,
      };
    },
  },
  {
    name: 'getDistance',
    description: 'Hitung jarak dari toko ke suatu koordinat dalam kilometer',
    input_schema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Lintang (-90 sampai 90)' },
        longitude: { type: 'number', description: 'Bujur (-180 sampai 180)' },
      },
      required: ['latitude', 'longitude'],
    },
    async execute(params) {
      const { latitude, longitude } = params;
      const data = await apiPost('/api/v1/admin/distance', { latitude, longitude });
      if (data.error) return { error: data.error };
      return { distance_km: data.distance };
    },
  },
  {
    name: 'calcDeliveryCostAndDriverWage',
    description: 'Hitung biaya pengiriman dan upah driver untuk suatu rute. Total = upah driver (Rp 3.000/km, min Rp 10.000).',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Tanggal format YYYY-MM-DD' },
        route: { type: 'number', description: 'Nomor rute (angka)' },
      },
      required: ['date', 'route'],
    },
    async execute(params, supabase, geoapifyApiKey, mapboxAccessToken) {
      const { date, route } = params;
      try {
        if (!geoapifyApiKey) throw new Error('Geoapify API key is not configured');
        if (!mapboxAccessToken) throw new Error('Mapbox access token is not configured');
        const result = await computeDeliveryCost(date, route, supabase, geoapifyApiKey, mapboxAccessToken);
        return {
          distances: result.distances,
          total: formatRupiah(result.total),
          total_raw: result.total,
          driver_wage: formatRupiah(result.total),
          items: result.items.map((i: any) => ({
            transaction_id: i.transaction_id,
            customer_id: i.customer_id,
            distance_km: i.distance_km,
            cost_delivery: formatRupiah(i.cost_delivery),
          })),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Gagal menghitung biaya pengiriman' };
      }
    },
  },
];
