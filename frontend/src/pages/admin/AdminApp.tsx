import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner } from '../../components/common';
import AdminLogin from './AdminLogin';
import AdminLayout from './AdminLayout';
import Events from './Events';
import EventDetail from './EventDetail';
import EmailDetail from './EmailDetail';
import Import from './Import';
import AdminOrders from './AdminOrders';
import AdminOrderDetail from './AdminOrderDetail';
import Reports from './Reports';
import AdminAccount from './AdminAccount';
import AdminForgotPassword from './AdminForgotPassword';
import AdminResetPassword from './AdminResetPassword';

function AuthGatedAdmin() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [username, setUsername] = useState('');

  const check = async () => {
    // Auth is carried by the httpOnly admin cookie. We simply ask the backend who
    // we are; a 401 (no/invalid cookie) means "not logged in".
    try {
      const me = await api<{ username: string }>('/api/admin/me', { admin: true });
      setUsername(me.username);
      setState('in');
    } catch {
      setState('out');
    }
  };

  useEffect(() => {
    check();
  }, []);

  if (state === 'loading') return <Spinner label="Adminbereich wird geladen …" />;
  if (state === 'out') return <AdminLogin onSuccess={check} />;

  return (
    <AdminLayout username={username} onLogout={() => setState('out')}>
      <Routes>
        <Route index element={<Navigate to="events" replace />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        {/* "Auswertung" is merged into the Auftrag detail view; keep redirects
            so old links land on the Aufträge overview. */}
        <Route path="analytics" element={<Navigate to="/admin/events" replace />} />
        <Route path="emails" element={<Navigate to="/admin/events" replace />} />
        <Route path="emails/:id" element={<EmailDetail />} />
        <Route path="import" element={<Import />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="orders/:id" element={<AdminOrderDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="account" element={<AdminAccount onUsernameChange={setUsername} />} />
        <Route path="*" element={<Navigate to="events" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="passwort-vergessen" element={<AdminForgotPassword />} />
      <Route path="passwort-zuruecksetzen" element={<AdminResetPassword />} />
      <Route path="*" element={<AuthGatedAdmin />} />
    </Routes>
  );
}
