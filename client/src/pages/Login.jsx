import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/customers');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="mark">◆</div>
          <h1>Customer Manager</h1>
          <p className="sub">Sign in to continue</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email" className="input" type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} required autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password" className="input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>

        {/* Demo credentials are for the evaluation build only. A production
            build (npm run build) strips this block entirely. */}
        {import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true' && (
          <div className="demo-hint">
            <strong>Demo accounts</strong> (password <span className="mono">demo1234</span>)<br />
            admin@demo.local — full access<br />
            office@demo.local — back office<br />
            shop@demo.local — shop floor
          </div>
        )}
      </form>
    </div>
  );
}
