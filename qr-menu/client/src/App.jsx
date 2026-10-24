import { Routes, Route, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import Menu from './pages/Menu.jsx';
import Checkout from './pages/Checkout.jsx';
import Pay from './pages/Pay.jsx';
import OrderSuccess from './pages/OrderSuccess.jsx';
import CafePicker from './pages/CafePicker.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminMenu from './pages/AdminMenu.jsx';
import AdminOrders from './pages/AdminOrders.jsx';
import AdminQR from './pages/AdminQR.jsx';
import AdminAnalytics from './pages/AdminAnalytics.jsx';
import AdminBookings from './pages/AdminBookings.jsx';
import BookingForm from './pages/BookingForm.jsx';
import AdminExpenses from './pages/AdminExpenses.jsx';
import AdminStaff from './pages/AdminStaff.jsx';
import AdminStock from './pages/AdminStock.jsx';
import AdminRates from './pages/AdminRates.jsx';
import CounterSale from './pages/CounterSale.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AdminNotifications from './pages/AdminNotifications.jsx';
import SelfCheckin from './pages/SelfCheckin.jsx';
import { adminApi, auth } from './api.js';
import BrandLogo from './components/BrandLogo.jsx';
import { CartProvider } from './store.jsx';
import {
  AdminLocationProvider,
  CafeContext,
  DEFAULT_CAFE,
  LocationsProvider,
  useAdminLocation,
  useLocations,
} from './locations.jsx';

function AdminNav() {
  const navigate = useNavigate();
  const { locations, byId } = useLocations();
  const { location, select, locked } = useAdminLocation();
  const who = auth.current();
  return (
    <nav className="admin-nav">
      <BrandLogo subtitle={who?.role === 'manager' ? who.staff.name : 'Owner'} compact admin />
      {locked ? (
        <div className="admin-property">{byId[location]?.name || location}</div>
      ) : (
        <select
          className="select admin-cafe-select"
          aria-label="Property"
          value={location}
          onChange={(e) => select(e.target.value)}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
          <option value="all">All properties</option>
        </select>
      )}
      {who?.role === 'owner' && <NavLink to="/admin/dashboard">Dashboard</NavLink>}
      <span className="admin-nav-heading">Hostel</span>
      <NavLink to="/admin/bookings">Bookings</NavLink>
      <NavLink to="/admin/expenses">Expenses</NavLink>
      <NavLink to="/admin/stock">Stock</NavLink>
      <NavLink to="/admin/rates">Room rates</NavLink>
      <span className="admin-nav-heading">Cafe</span>
      <NavLink to="/admin/orders">Orders</NavLink>
      <NavLink to="/admin/counter">Counter sale</NavLink>
      <NavLink to="/admin/menu">Menu</NavLink>
      <NavLink to="/admin/qr">QR codes</NavLink>
      <NavLink to="/admin/analytics">Analytics</NavLink>
      {who?.role === 'owner' && (
        <>
          <span className="admin-nav-heading">Owner</span>
          <NavLink to="/admin/staff">Managers</NavLink>
          <NavLink to="/admin/notifications">Notifications</NavLink>
        </>
      )}
      <button
        className="link-btn"
        onClick={async () => {
          await adminApi.logout();
          auth.clear();
          navigate('/admin');
        }}
      >
        Sign out
      </button>
    </nav>
  );
}

function RequireAdmin() {
  const who = auth.current();
  if (!who) return <Navigate to="/admin" replace />;
  return (
    <AdminLocationProvider fixedLocation={who.role === 'manager' ? who.staff.location_id : ''}>
      <div className="admin-shell">
        <AdminNav />
        <div className="admin-body">
          <Outlet />
        </div>
      </div>
    </AdminLocationProvider>
  );
}

// Everything under /:cafe/ — resolves the cafe and gives it its own cart.
function CafeRoutes() {
  const { cafe } = useParams();
  const { byId, loading, error } = useLocations();
  if (loading) return <main className="page"><p>Loading…</p></main>;
  if (error) return <main className="page"><p style={{ color: '#c92a2a' }}>Couldn’t load cafes: {error}</p></main>;
  const location = byId[cafe];
  if (!location) return <Navigate to="/" replace />;
  return (
    <CafeContext.Provider value={location}>
      <CartProvider cafe={location.id} key={location.id}>
        <Outlet />
      </CartProvider>
    </CafeContext.Provider>
  );
}

// Cafe-less URLs from before menus were split (printed QR codes): keep the query string.
function LegacyMenuRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${DEFAULT_CAFE}/menu${search}`} replace />;
}

export default function App() {
  return (
    <LocationsProvider>
      <Routes>
        <Route path="/" element={<CafePicker />} />
        <Route path="/menu" element={<LegacyMenuRedirect />} />
        <Route path="/checkin/:token" element={<SelfCheckin />} />

        <Route path="/:cafe" element={<CafeRoutes />}>
          <Route index element={<Navigate to="menu" replace />} />
          <Route path="menu" element={<Menu />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="pay/:orderId" element={<Pay />} />
          <Route path="order/:orderId" element={<OrderSuccess />} />
        </Route>

        <Route path="/admin" element={<AdminLogin />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/bookings" element={<AdminBookings />} />
          <Route path="/admin/bookings/new" element={<BookingForm />} />
          <Route path="/admin/bookings/:id" element={<BookingForm />} />
          <Route path="/admin/expenses" element={<AdminExpenses />} />
          <Route path="/admin/staff" element={<AdminStaff />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/stock" element={<AdminStock />} />
          <Route path="/admin/rates" element={<AdminRates />} />
          <Route path="/admin/counter" element={<CounterSale />} />
          <Route path="/admin/notifications" element={<AdminNotifications />} />
          <Route path="/admin/analytics" element={<AdminAnalytics />} />
          <Route path="/admin/menu" element={<AdminMenu />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/qr" element={<AdminQR />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LocationsProvider>
  );
}
