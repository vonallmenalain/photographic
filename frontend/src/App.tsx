import { Routes, Route, Navigate } from 'react-router-dom';
import { ParentAuthProvider, useParentAuth } from './context/ParentAuth';
import { CartProvider } from './context/Cart';
import { Layout } from './components/Layout';
import { Spinner } from './components/common';

import Landing from './pages/parent/Landing';
import Verify from './pages/parent/Verify';
import Gallery from './pages/parent/Gallery';
import Cart from './pages/parent/Cart';
import Orders from './pages/parent/Orders';
import OrderDetail from './pages/parent/OrderDetail';
import Help from './pages/parent/Help';
import Privacy from './pages/parent/Privacy';

import AdminApp from './pages/admin/AdminApp';

function RequireParent({ children }: { children: JSX.Element }) {
  const { loading, verified } = useParentAuth();
  if (loading) return <Spinner label="Einen Moment …" />;
  if (!verified) return <Navigate to="/" replace />;
  return children;
}

function ParentRoutes() {
  return (
    <ParentAuthProvider>
      <CartProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/verifizieren" element={<Verify />} />
            {/* Nach der Code-Bestätigung landet man direkt in der Bestellansicht
                (früher gab es davor noch eine reine Galerie-Vorschau). Die alte
                Unterseite bleibt als Weiterleitung erhalten, damit gespeicherte
                Links/Lesezeichen weiterhin funktionieren. */}
            <Route path="/galerie" element={<RequireParent><Gallery /></RequireParent>} />
            <Route path="/galerie/fotos" element={<Navigate to="/galerie" replace />} />
            <Route path="/warenkorb" element={<RequireParent><Cart /></RequireParent>} />
            <Route path="/bestellungen" element={<RequireParent><Orders /></RequireParent>} />
            <Route path="/bestellung/:id" element={<RequireParent><OrderDetail /></RequireParent>} />
            <Route path="/hilfe" element={<Help />} />
            <Route path="/datenschutz" element={<Privacy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </CartProvider>
    </ParentAuthProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/*" element={<ParentRoutes />} />
    </Routes>
  );
}
