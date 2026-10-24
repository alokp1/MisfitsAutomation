import { createContext, useContext, useEffect, useState, useMemo } from 'react';

const CartContext = createContext(null);

// Where the scanned table id is kept between the menu and checkout, per cafe.
export const tableIdKey = (cafe) => `qrmenu.tableId.${cafe}`;

// One cart per cafe: items from one cafe's menu can't be ordered at another.
// Mount with key={cafe} so switching cafes reloads the right cart.
export function CartProvider({ cafe, children }) {
  const storageKey = `qrmenu.cart.v2.${cafe}`;
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }, [storageKey, items]);

  const add = (menuItem) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.menu_item_id === menuItem.id);
      if (existing) {
        return prev.map((p) =>
          p.menu_item_id === menuItem.id
            ? {
                ...p,
                price_paise: menuItem.price_paise,
                tax_percent: Number(menuItem.tax_percent ?? p.tax_percent ?? 5),
                quantity: p.quantity + 1,
              }
            : p,
        );
      }
      return [
        ...prev,
        {
          menu_item_id: menuItem.id,
          name: menuItem.name,
          price_paise: menuItem.price_paise,
          tax_percent: Number(menuItem.tax_percent ?? 5),
          quantity: 1,
        },
      ];
    });
  };

  const setQty = (menu_item_id, qty) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((p) => p.menu_item_id !== menu_item_id)
        : prev.map((p) => (p.menu_item_id === menu_item_id ? { ...p, quantity: qty } : p)),
    );
  };

  const remove = (menu_item_id) =>
    setItems((prev) => prev.filter((p) => p.menu_item_id !== menu_item_id));

  const clear = () => setItems([]);

  const subtotal = useMemo(
    () => items.reduce((s, p) => s + p.price_paise * p.quantity, 0),
    [items],
  );

  const tax = useMemo(
    () =>
      items.reduce(
        (s, p) => s + Math.round(p.price_paise * p.quantity * (Number(p.tax_percent ?? 5) / 100)),
        0,
      ),
    [items],
  );

  const total = subtotal + tax;

  const totalCount = useMemo(
    () => items.reduce((s, p) => s + p.quantity, 0),
    [items],
  );

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, subtotal, tax, total, totalCount }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
