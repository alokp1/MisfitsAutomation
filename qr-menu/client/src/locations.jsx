import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// Cafe that old, cafe-less URLs (/menu?table=…) belong to. Matches the server migration.
export const DEFAULT_CAFE = 'shoja';

const LocationsContext = createContext(null);

export function LocationsProvider({ children }) {
  const [state, setState] = useState({ locations: [], loading: true, error: '' });

  useEffect(() => {
    api
      .getLocations()
      .then((locations) => setState({ locations, loading: false, error: '' }))
      .catch((e) => setState({ locations: [], loading: false, error: e.message }));
  }, []);

  const value = useMemo(
    () => ({ ...state, byId: Object.fromEntries(state.locations.map((l) => [l.id, l])) }),
    [state],
  );
  return <LocationsContext.Provider value={value}>{children}</LocationsContext.Provider>;
}

export const useLocations = () => useContext(LocationsContext);

// The cafe a customer is ordering from, set by the /:cafe route.
export const CafeContext = createContext(null);
export const useCafe = () => useContext(CafeContext);

// The property an admin is working on, or 'all'. The owner picks it (remembered per
// browser); a property manager is always on their own property (`locked`).
const ADMIN_KEY = 'qrmenu.admin.location';
const AdminLocationContext = createContext(null);

export function AdminLocationProvider({ fixedLocation = '', children }) {
  const { locations } = useLocations();
  const [selected, setSelected] = useState(() => localStorage.getItem(ADMIN_KEY) || '');

  const valid = selected === 'all' || locations.some((l) => l.id === selected);
  const location = fixedLocation || (valid ? selected : locations[0]?.id || '');

  const select = (id) => {
    if (fixedLocation) return;
    localStorage.setItem(ADMIN_KEY, id);
    setSelected(id);
  };

  return (
    <AdminLocationContext.Provider value={{ location, select, locked: !!fixedLocation }}>
      {children}
    </AdminLocationContext.Provider>
  );
}

export const useAdminLocation = () => useContext(AdminLocationContext);
