import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function Directory() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ customers: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Guards against an older, slower response overwriting a newer one when the
  // user types quickly.
  const requestRef = useRef(0);

  const load = useCallback(async (opts) => {
    const id = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.listCustomers({
        search: opts.search, status: opts.status, page: opts.page, limit: 25,
      });
      if (id === requestRef.current) setData(result);
    } catch (err) {
      if (id === requestRef.current) setError(err.message);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, []);

  // Debounce typing so a search does not fire on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => load({ search, status, page }), 220);
    return () => clearTimeout(timer);
  }, [search, status, page, load]);

  // Any change of filter puts the user back on page 1, otherwise they can land
  // on an empty page 7 of a 2-page result.
  const onSearch = (value) => { setSearch(value); setPage(1); };
  const onStatus = (value) => { setStatus(value); setPage(1); };

  const rows = data.customers;

  return (
    <>
      <header className="topbar">
        <h1>Customers</h1>
        <div className="spacer" />
        {can('customers:create') && (
          <button className="btn btn-primary" onClick={() => navigate('/customers/new')}>
            <span>＋</span><span className="hide-sm">New customer</span>
          </button>
        )}
      </header>

      <div className="content">
        <div className="searchbar">
          <div className="search-wrap">
            <span className="ico">🔍</span>
            <input
              className="input"
              placeholder="Search name, email, phone or reference…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              autoFocus
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => onStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="hide-sm">Phone</th>
                  <th className="hide-sm">Reference</th>
                  <th>Loyalty</th>
                  <th className="hide-sm">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={`clickable${c.archived_at ? ' is-archived' : ''}`}
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    <td>
                      <div className="cust-name">
                        {c.first_name} {c.last_name}
                        {c.archived_at && <span className="badge badge-muted" style={{ marginLeft: 8 }}>Archived</span>}
                      </div>
                      <div className="cust-sub">{c.email || 'No email'}</div>
                    </td>
                    <td className="hide-sm nowrap">{c.phone || '—'}</td>
                    <td className="hide-sm mono">{c.customer_code || '—'}</td>
                    <td className="nowrap">
                      {c.loyalty_tier
                        ? <span className="badge badge-tier">{c.loyalty_tier}</span>
                        : <span className="muted">—</span>}
                      <div className="cust-sub">{c.loyalty_points} pts</div>
                    </td>
                    <td className="hide-sm nowrap muted">{formatDate(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && rows.length === 0 && (
            <div className="empty">
              <div className="big">🔍</div>
              <h3>{search ? 'No customers match that search' : 'No customers yet'}</h3>
              <p>
                {search
                  ? 'Try a different name, phone number or reference.'
                  : 'Add your first customer, or import your existing list from a CSV file.'}
              </p>
            </div>
          )}

          {loading && rows.length === 0 && <div className="empty"><p>Loading…</p></div>}

          <div className="pager">
            <span className="count">
              {data.total.toLocaleString()} customer{data.total === 1 ? '' : 's'}
              {data.pages > 1 && ` · page ${data.page} of ${data.pages}`}
            </span>
            {data.pages > 1 && (
              <span className="controls">
                <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </button>
                <button className="btn btn-secondary btn-sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
