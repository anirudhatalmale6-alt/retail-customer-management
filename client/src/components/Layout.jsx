import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, ROLE_LABELS } from '../auth';

/** Nav entries are filtered by capability, so each role sees only its own menu. */
const NAV = [
  { to: '/customers', label: 'Customers', icon: '👥', cap: 'customers:read' },
  { to: '/import',    label: 'Import',    icon: '📥', cap: 'import:run' },
  { to: '/users',     label: 'Staff',     icon: '🔑', cap: 'users:manage' },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-mark">◆</span>
          <span className="logo-text">Customer Manager</span>
        </div>

        {NAV.filter((item) => can(item.cap)).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="ico">{item.icon}</span>
            <span className="label">{item.label}</span>
          </NavLink>
        ))}

        <div className="sidebar-footer">
          <div className="who">
            <strong>{user?.full_name}</strong>
            <span className="who-email">{user?.email}</span>
            <span className="role-chip">{ROLE_LABELS[user?.role] || user?.role}</span>
          </div>
          <button className="nav-link" onClick={signOut} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span className="ico">↩</span>
            <span className="label">Sign out</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
