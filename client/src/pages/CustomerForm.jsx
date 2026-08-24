import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

const EMPTY = {
  first_name: '', last_name: '', email: '', phone: '', customer_code: '',
  address_line1: '', address_line2: '', city: '', postcode: '', country: '',
  date_of_birth: '', loyalty_tier: '', loyalty_points: 0, marketing_opt_in: false,
};

// Only these keys are sent on save. Sending the whole customer row back would
// include server-managed fields like created_at and archived_at.
const EDITABLE = Object.keys(EMPTY);

export default function CustomerForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) return;
    api.getCustomer(id)
      .then((c) => {
        const next = { ...EMPTY };
        for (const key of EDITABLE) {
          // Nulls from the API become empty strings so the inputs stay
          // controlled and React does not warn.
          next[key] = c[key] ?? (key === 'marketing_opt_in' ? false : key === 'loyalty_points' ? 0 : '');
        }
        // A date input needs YYYY-MM-DD, not the full ISO timestamp.
        if (c.date_of_birth) next.date_of_birth = String(c.date_of_birth).slice(0, 10);
        setForm(next);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, loyalty_points: Number(form.loyalty_points) || 0 };
      const saved = isEdit
        ? await api.updateCustomer(id, payload)
        : await api.createCustomer(payload);
      navigate(`/customers/${saved.id}`);
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="content"><p className="muted">Loading…</p></div>;

  return (
    <>
      <header className="topbar">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <h1>{isEdit ? 'Edit customer' : 'New customer'}</h1>
      </header>

      <div className="content content-narrow">
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Details</h2></div>
            <div className="card-body">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="first_name">First name *</label>
                  <input id="first_name" className="input" value={form.first_name} onChange={set('first_name')} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="last_name">Last name *</label>
                  <input id="last_name" className="input" value={form.last_name} onChange={set('last_name')} required />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" className="input" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="field">
                  <label htmlFor="phone">Phone</label>
                  <input id="phone" className="input" type="tel" value={form.phone} onChange={set('phone')} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="customer_code">Reference / card number</label>
                  <input id="customer_code" className="input" value={form.customer_code} onChange={set('customer_code')} />
                  <span className="hint">Your own customer number, if you use one</span>
                </div>
                <div className="field">
                  <label htmlFor="date_of_birth">Date of birth</label>
                  <input id="date_of_birth" className="input" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Address</h2></div>
            <div className="card-body">
              <div className="field">
                <label htmlFor="address_line1">Address line 1</label>
                <input id="address_line1" className="input" value={form.address_line1} onChange={set('address_line1')} />
              </div>
              <div className="field">
                <label htmlFor="address_line2">Address line 2</label>
                <input id="address_line2" className="input" value={form.address_line2} onChange={set('address_line2')} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="city">Town / city</label>
                  <input id="city" className="input" value={form.city} onChange={set('city')} />
                </div>
                <div className="field">
                  <label htmlFor="postcode">Postcode</label>
                  <input id="postcode" className="input" value={form.postcode} onChange={set('postcode')} />
                </div>
                <div className="field">
                  <label htmlFor="country">Country</label>
                  <input id="country" className="input" value={form.country} onChange={set('country')} />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Loyalty & marketing</h2></div>
            <div className="card-body">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="loyalty_tier">Tier</label>
                  <input id="loyalty_tier" className="input" value={form.loyalty_tier} onChange={set('loyalty_tier')} placeholder="e.g. Gold" />
                </div>
                <div className="field">
                  <label htmlFor="loyalty_points">Points</label>
                  <input id="loyalty_points" className="input" type="number" min="0" value={form.loyalty_points} onChange={set('loyalty_points')} />
                </div>
              </div>
              <div className="checkbox-row">
                <input id="marketing_opt_in" type="checkbox" checked={form.marketing_opt_in} onChange={set('marketing_opt_in')} />
                <label htmlFor="marketing_opt_in">Happy to receive marketing emails</label>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : (isEdit ? 'Save changes' : 'Create customer')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
