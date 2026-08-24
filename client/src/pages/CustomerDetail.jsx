import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const formatDate = (v) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const money = (v) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(Number(v || 0));

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.getCustomer(id).then(setCustomer).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [id]);

  const toggleArchive = async () => {
    const archiving = !customer.archived_at;
    const question = archiving
      ? 'Archive this customer? They will be hidden from the main list but nothing is deleted.'
      : 'Restore this customer to the active list?';
    if (!window.confirm(question)) return;

    setBusy(true);
    try {
      setCustomer(await api.setArchived(id, archiving));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="content"><div className="alert alert-error">{error}</div></div>;
  if (!customer) return <div className="content"><p className="muted">Loading…</p></div>;

  const initials = `${customer.first_name?.[0] || ''}${customer.last_name?.[0] || ''}`.toUpperCase();
  const customFields = Object.entries(customer.custom_fields || {});

  return (
    <>
      <header className="topbar">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/customers')}>← Customers</button>
        <div className="spacer" />
        {can('customers:update') && (
          <button className="btn btn-secondary" onClick={() => navigate(`/customers/${id}/edit`)}>Edit</button>
        )}
        {can('customers:archive') && (
          <button className="btn btn-danger" onClick={toggleArchive} disabled={busy}>
            {customer.archived_at ? 'Restore' : 'Archive'}
          </button>
        )}
      </header>

      <div className="content">
        {customer.archived_at && (
          <div className="alert alert-info">
            This customer was archived on {formatDate(customer.archived_at)}. Their history is kept in full.
          </div>
        )}

        <div className="detail-head">
          <div className="avatar">{initials || '?'}</div>
          <div>
            <h2 className="who-name">{customer.first_name} {customer.last_name}</h2>
            <div className="who-meta">
              {customer.email || 'No email'}
              {customer.phone && <> · {customer.phone}</>}
              {customer.customer_code && <> · <span className="mono">{customer.customer_code}</span></>}
            </div>
          </div>
        </div>

        <div className="stat-row">
          <div className="stat">
            <div className="label">Lifetime spend</div>
            <div className="value">{money(customer.lifetime_value)}</div>
          </div>
          <div className="stat">
            <div className="label">Purchases</div>
            <div className="value">{customer.purchase_count}</div>
          </div>
          <div className="stat">
            <div className="label">Last purchase</div>
            <div className="value" style={{ fontSize: 16 }}>{formatDate(customer.last_purchase_at)}</div>
          </div>
          <div className="stat">
            <div className="label">Loyalty points</div>
            <div className="value">{customer.loyalty_points.toLocaleString()}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h2>Customer details</h2></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Loyalty tier</dt>
              <dd>{customer.loyalty_tier ? <span className="badge badge-tier">{customer.loyalty_tier}</span> : '—'}</dd>

              <dt>Marketing</dt>
              <dd>
                {customer.marketing_opt_in
                  ? <span className="badge badge-ok">Opted in</span>
                  : <span className="badge badge-muted">Not opted in</span>}
              </dd>

              <dt>Date of birth</dt>
              <dd>{formatDate(customer.date_of_birth)}</dd>

              <dt>Address</dt>
              <dd>
                {[customer.address_line1, customer.address_line2, customer.city, customer.postcode, customer.country]
                  .filter(Boolean).join(', ') || '—'}
              </dd>

              <dt>Added</dt>
              <dd>{formatDate(customer.created_at)}</dd>

              {customFields.map(([key, value]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Purchase timeline, notes, reminders and tickets are the next stage of
            work; the counts above already read from those tables. */}
        <div className="card">
          <div className="card-head"><h2>Purchase history</h2></div>
          <div className="card-body">
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {customer.purchase_count > 0
                ? `${customer.purchase_count} purchases recorded.`
                : 'No purchases recorded for this customer yet.'}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
