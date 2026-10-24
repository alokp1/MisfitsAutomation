// Tiny fetch wrapper. All paths are proxied to the backend by Vite (see vite.config.js).
const BASE = '/api';

async function handle(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// `?location=<id>`, or nothing when location is empty (admin "all cafes").
const loc = (location) => (location ? `?location=${encodeURIComponent(location)}` : '');

export const api = {
  // Public
  getConfig: () => fetch(`${BASE}/config`).then(handle),
  getLocations: () => fetch(`${BASE}/locations`).then(handle),
  getMenu: (location) => fetch(`${BASE}/menu${loc(location)}`).then(handle),
  getCategories: (location) => fetch(`${BASE}/categories${loc(location)}`).then(handle),
  placeOrder: (body) =>
    fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle),
  getOrder: (id) => fetch(`${BASE}/orders/${id}`).then(handle),
  getCheckin: (token) => fetch(`${BASE}/checkin/${encodeURIComponent(token)}`).then(handle),
  submitCheckin: (token, body) =>
    fetch(`${BASE}/checkin/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle),
  getQrData: (location, table) =>
    fetch(`${BASE}/qr/data${loc(location)}&table=${encodeURIComponent(table)}`).then(handle),

  // Payment
  createRzpOrder: (order_id) =>
    fetch(`${BASE}/payment/create-razorpay-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id }),
    }).then(handle),
  verifyPayment: (body) =>
    fetch(`${BASE}/payment/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle),
};

// ---- Admin: the owner's password, or a property manager's session ----
const OWNER_KEY = 'adminPassword';
const SESSION_KEY = 'qrmenu.session';

export const auth = {
  // { role: 'owner' } | { role: 'manager', token, staff: { id, name, location_id } } | null
  current() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (session?.token) return { role: 'manager', ...session };
    } catch {
      /* fall through */
    }
    return localStorage.getItem(OWNER_KEY) ? { role: 'owner' } : null;
  },
  setOwner(password) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(OWNER_KEY, password);
  },
  setManager(token, staff) {
    localStorage.removeItem(OWNER_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, staff }));
  },
  clear() {
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(SESSION_KEY);
  },
};

function adminHeaders(extra = {}) {
  const a = auth.current();
  if (a?.role === 'manager') return { Authorization: `Bearer ${a.token}`, ...extra };
  return { 'x-admin-password': localStorage.getItem(OWNER_KEY) || '', ...extra };
}

// Admin request. A 401 means the password changed or the session ended: back to sign-in.
async function adminFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: adminHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    auth.clear();
    window.location.assign(`${import.meta.env.BASE_URL}admin`);
    throw new Error('Signed out');
  }
  return handle(res);
}

const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return q ? `?${q}` : '';
};

export const adminApi = {
  listMenu: (location) => adminFetch(`/admin/menu${loc(location)}`),
  createMenuItem: (b) => adminFetch('/admin/menu', { method: 'POST', body: b }),
  updateMenuItem: (id, b) => adminFetch(`/admin/menu/${id}`, { method: 'PUT', body: b }),
  deleteMenuItem: (id) => adminFetch(`/admin/menu/${id}`, { method: 'DELETE' }),
  copyMenu: (from, to) => adminFetch('/admin/menu/copy', { method: 'POST', body: { from, to } }),

  listCategories: (location) => fetch(`${BASE}/categories${loc(location)}`).then(handle),
  createCategory: (b) => adminFetch('/admin/categories', { method: 'POST', body: b }),
  deleteCategory: (id) => adminFetch(`/admin/categories/${id}`, { method: 'DELETE' }),

  listOrders: (location) => adminFetch(`/admin/orders${loc(location)}`),
  getAnalytics: (location) => adminFetch(`/admin/orders/analytics${loc(location)}`),
  setOrderStatus: (id, status) => adminFetch(`/admin/orders/${id}/status`, { method: 'PUT', body: { status } }),

  // Hostel operations
  listRooms: (location) => adminFetch(`/admin/bookings/rooms${query({ location })}`),
  getOccupancy: (location, check_in, check_out, exclude) =>
    adminFetch(`/admin/bookings/occupancy${query({ location, check_in, check_out, exclude })}`),
  getDay: (location, date) => adminFetch(`/admin/bookings/day${query({ location, date })}`),
  searchBookings: (location, q) => adminFetch(`/admin/bookings${query({ location, q })}`),
  getBooking: (id) => adminFetch(`/admin/bookings/${id}`),
  createBooking: (b) => adminFetch('/admin/bookings', { method: 'POST', body: b }),
  updateBooking: (id, b) => adminFetch(`/admin/bookings/${id}`, { method: 'PUT', body: b }),
  cancelBooking: (id) => adminFetch(`/admin/bookings/${id}/cancel`, { method: 'POST' }),
  checkinLink: (id) => adminFetch(`/admin/bookings/${id}/checkin-link`, { method: 'POST' }),
  listCheckins: (id) => adminFetch(`/admin/bookings/${id}/checkins`),
  deleteCheckin: (cid) => adminFetch(`/admin/bookings/checkins/${cid}`, { method: 'DELETE' }),
  // ID photos need the auth header, so fetch them as a blob for an <img>.
  checkinPhotoUrl: async (cid, side) => {
    const res = await fetch(`${BASE}/admin/bookings/checkins/${cid}/id/${side}`, { headers: adminHeaders() });
    if (!res.ok) throw new Error('Could not load the ID photo');
    return URL.createObjectURL(await res.blob());
  },

  expenseOptions: () => adminFetch('/admin/expenses/options'),
  listExpenses: (location, month) => adminFetch(`/admin/expenses${query({ location, month })}`),
  createExpense: (b) => adminFetch('/admin/expenses', { method: 'POST', body: b }),
  // Rejects with err.errors = [{ row, error }] when rows need fixing.
  createExpenses: async (b) => {
    const res = await fetch(`${BASE}/admin/expenses/bulk`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(b),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      auth.clear();
      window.location.assign(`${import.meta.env.BASE_URL}admin`);
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { errors: data.errors || [] });
    return data;
  },
  updateExpense: (id, b) => adminFetch(`/admin/expenses/${id}`, { method: 'PUT', body: b }),
  deleteExpense: (id) => adminFetch(`/admin/expenses/${id}`, { method: 'DELETE' }),
  // Bill photos need the auth header, so fetch them as a blob for an <img>.
  receiptUrl: async (id) => {
    const res = await fetch(`${BASE}/admin/expenses/${id}/receipt`, { headers: adminHeaders() });
    if (!res.ok) throw new Error('Could not load the bill photo');
    return URL.createObjectURL(await res.blob());
  },

  getRates: (location) => adminFetch(`/admin/rates${query({ location })}`),
  saveRates: (b) => adminFetch('/admin/rates', { method: 'PUT', body: b }),


  getStock: (location, date) => adminFetch(`/admin/stock${query({ location, date })}`),
  saveStockCounts: (b) => adminFetch('/admin/stock/counts', { method: 'PUT', body: b }),
  createStockItem: (b) => adminFetch('/admin/stock/items', { method: 'POST', body: b }),
  updateStockItem: (id, b) => adminFetch(`/admin/stock/items/${id}`, { method: 'PUT', body: b }),

  counterSale: (b) => adminFetch('/admin/orders/counter', { method: 'POST', body: b }),

  getDashboard: (location, from, to) =>
    adminFetch(`/admin/dashboard${query({ location: location === 'all' ? '' : location, from, to })}`),

  notificationStatus: () => adminFetch('/admin/notifications'),
  notificationPreview: (date) => adminFetch(`/admin/notifications/preview${query({ date })}`),
  notificationTest: (to) => adminFetch('/admin/notifications/test', { method: 'POST', body: { to } }),

  listStaff: () => adminFetch('/admin/staff'),
  createStaff: (b) => adminFetch('/admin/staff', { method: 'POST', body: b }),
  updateStaff: (id, b) => adminFetch(`/admin/staff/${id}`, { method: 'PUT', body: b }),

  // Sign-in helpers: these must not bounce to the sign-in page on failure.
  ping: () => fetch(`${BASE}/admin/ping`, { headers: adminHeaders() }).then(handle),
  staffNames: () => fetch(`${BASE}/auth/staff`).then(handle),
  login: (staff_id, pin) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id, pin }),
    }).then(handle),
  logout: () => fetch(`${BASE}/auth/logout`, { method: 'POST', headers: adminHeaders() }).catch(() => {}),
};

// ₹1,498 · ₹9,52,978 · ₹40.50 — Indian digit grouping, paise only when there are any.
export const formatRupees = (paise) => {
  const rupees = Number(paise || 0) / 100;
  return '₹' + rupees.toLocaleString('en-IN', Number.isInteger(rupees) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
