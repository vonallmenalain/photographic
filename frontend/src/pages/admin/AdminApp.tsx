import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api, getAdminToken } from '../../api/client';
import { Spinner } from '../../components/common';
import AdminLogin from './AdminLogin';
import AdminLayout from './AdminLayout';
import Dashboard from './Dashboard';
import Events from './Events';
import EventDetail from './EventDetail';
import Emails from './Emails';
import EmailDetail from './EmailDetail';
import Import from './Import';
import AdminOrders from './AdminOrders';
import AdminOrderDetail from './AdminOrderDetail';
import Reports from './Reports';

export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [username, setUsername] = useState('');

  const check = async () => {
    if (!getAdminToken()) {
      setState('out');
      return;
    }
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
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="emails" element={<Emails />} />
        <Route path="emails/:id" element={<EmailDetail />} />
        <Route path="import" element={<Import />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="orders/:id" element={<AdminOrderDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </AdminLayout>
  );
}
