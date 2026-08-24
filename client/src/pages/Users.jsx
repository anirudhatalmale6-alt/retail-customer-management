import { useEffect, useState } from 'react';
import { api } from '../api';
import { ROLE_LABELS, useAuth } from '../auth';

const ROLE_HELP = {
  admin: 'Everything, including staff accounts and imports',
  back_office: 'Customers, archiving, imports, exports and reports',
  front_of_house: 'Add and update customers, notes and tickets',
};

const BLANK = { email: '', full_name: '', role: 'front_of_house', password: '' };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.listUsers().then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.createUser(form);
      setNotice(`${form.full_name} can now sign in.`);
      setForm(BLANK);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u) => {
    setError(''); setNotice('');
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeRole = async (u, role) => {
    setError(''); setNotice('');
    try {
      await api.updateUser(u.id, { role });
      load();
    } catch (err) {
      setError(err.message);
      load();   // put the dropdown back to the value the server actually has
    }
  };

  return (
    <>
      <header className="topbar">
        <h1>Staff accounts</h1>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : <><span>＋</span><span className="hide-sm">Add staff member</span></>}
        </button>
      </header>

      <div className="content content-narrow">
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}

        {showForm && (
          <form className="card" style={{ marginBottom: 16 }} onSubmit={create}>
            <div className="card-head"><h2>New staff member</h2></div>
            <div className="card-body">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="full_name">Name</label>
                  <input id="full_name" className="input" value={form.full_name} onChange={set('full_name')} required />
                </div>
                <div className="field">
                  <label htmlFor="u_email">Email</label>
                  <input id="u_email" className="input" type="email" value={form.email} onChange={set('email')} required />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="u_role">Role</label>
                  <select id="u_role" className="select" value={form.role} onChange={set('role')}>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <span className="hint">{ROLE_HELP[form.role]}</span>
                </div>
                <div className="field">
                  <label htmlFor="u_pw">Temporary password</label>
                  <input id="u_pw" className="input" type="text" value={form.password} onChange={set('password')} required minLength={8} />
                  <span className="hint">At least 8 characters. They can change it after signing in.</span>
                </div>
              </div>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? <span className="spinner" /> : 'Create account'}
              </button>
            </div>
          </form>
        )}

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="hide-sm">Last signed in</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cust-name">
                        {u.full_name}
                        {u.id === me?.id && <span className="badge badge-tier" style={{ marginLeft: 8 }}>You</span>}
                      </div>
                      <div className="cust-sub">{u.email}</div>
                    </td>
                    <td>
                      <select
                        className="select" style={{ minHeight: 36, fontSize: 13.5, width: 'auto' }}
                        value={u.role} onChange={(e) => changeRole(u, e.target.value)}
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="hide-sm muted nowrap">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                    </td>
                    <td className="right nowrap">
                      <button
                        className={`btn btn-sm ${u.is_active ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => toggleActive(u)}
                        disabled={u.id === me?.id}
                        title={u.id === me?.id ? 'You cannot deactivate your own account' : ''}
                      >
                        {u.is_active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
