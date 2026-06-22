import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminRoute } from "./components/AdminRoute";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminSetupPage } from "./pages/AdminSetupPage";
import { AdminUploadPage } from "./pages/AdminUploadPage";
import { AdminPhotosPage } from "./pages/AdminPhotosPage";
import { GalleryPage } from "./pages/GalleryPage";
import { CartPage } from "./pages/CartPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/cart" element={<CartPage />} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/setup" element={<AdminSetupPage />} />
          <Route path="/admin/upload" element={<AdminUploadPage />} />
          <Route path="/admin/photos" element={<AdminPhotosPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
