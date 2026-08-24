import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Directory from './pages/Directory';
import CustomerForm from './pages/CustomerForm';
import CustomerDetail from './pages/CustomerDetail';
import Import from './pages/Import';
import Users from './pages/Users';

/** Blocks a route until the session is known, then by capability. */
function Protected({ cap, children }) {
  const { user, loading, can } = useAuth();
  if (loading) return <div className="content"><p className="muted">Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (cap && !can(cap)) {
    return (
      <div className="content">
        <div className="alert alert-error">
          You do not have permission to open this page. Ask an administrator if you need access.
        </div>
      </div>
    );
  }
  return children;
}

function Router() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? null : user ? <Navigate to="/customers" replace /> : <Login />}
      />

      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/customers" element={<Protected cap="customers:read"><Directory /></Protected>} />
        <Route path="/customers/new" element={<Protected cap="customers:create"><CustomerForm /></Protected>} />
        <Route path="/customers/:id" element={<Protected cap="customers:read"><CustomerDetail /></Protected>} />
        <Route path="/customers/:id/edit" element={<Protected cap="customers:update"><CustomerForm /></Protected>} />
        <Route path="/import" element={<Protected cap="import:run"><Import /></Protected>} />
        <Route path="/users" element={<Protected cap="users:manage"><Users /></Protected>} />
      </Route>

      <Route path="*" element={<Navigate to="/customers" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Router />
      </BrowserRouter>
    </AuthProvider>
  );
}
