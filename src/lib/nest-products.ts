type FlatProduct = {
  id: number;
  qty: number;
  parent_id: number | null;
  is_free?: boolean | null;
  product?: { id: number; name: string; price: number } | null;
};

export type NestedProduct = {
  product_id: number | null;
  name: string;
  price: number;
  qty: number;
  is_free: boolean;
  children: Omit<NestedProduct, 'children'>[];
};

// Re-nests flat transaction_products rows (parent_id self-FK) into parent/children — mirrors admin-transactions.ts pattern.
export function nestProducts(tps: FlatProduct[]): NestedProduct[] {
  const parents = tps.filter((tp) => tp.parent_id == null);
  const childMap = new Map<number, FlatProduct[]>();
  for (const tp of tps) {
    if (tp.parent_id != null) {
      if (!childMap.has(tp.parent_id)) childMap.set(tp.parent_id, []);
      childMap.get(tp.parent_id)!.push(tp);
    }
  }

  const toItem = (tp: FlatProduct) => ({
    product_id: tp.product?.id ?? null,
    name: tp.product?.name || 'Unknown Product',
    price: tp.product?.price || 0,
    qty: tp.qty || 0,
    is_free: tp.is_free ?? false,
  });

  return parents.map((tp) => ({
    ...toItem(tp),
    children: (childMap.get(tp.id) || []).map(toItem),
  }));
}
