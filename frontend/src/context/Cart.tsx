import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { useParentAuth } from './ParentAuth';

interface CartState {
  /** Total number of products (sum of all quantities) in the cart. */
  count: number;
  refresh: () => Promise<void>;
}

const Ctx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { verified } = useParentAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!verified) {
      setCount(0);
      return;
    }
    try {
      const res = await api<{ cart: { items: { qty: number }[] } }>('/api/parent/cart');
      const items = res.cart?.items ?? [];
      setCount(items.reduce((n, i) => n + (i.qty || 0), 0));
    } catch {
      setCount(0);
    }
  }, [verified]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ count, refresh }}>{children}</Ctx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
