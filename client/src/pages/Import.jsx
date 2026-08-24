import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const FIELD_LABELS = {
  customer_code: 'Reference / card number',
  full_name: 'Full name (split automatically)',
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  city: 'Town / city',
  postcode: 'Postcode',
  country: 'Country',
  date_of_birth: 'Date of birth',
  marketing_opt_in: 'Marketing opt-in',
  loyalty_tier: 'Loyalty tier',
  loyalty_points: 'Loyalty points',
};

export default function Import() {
  const [step, setStep] = useState(1);           // 1 choose file, 2 map columns, 3 result
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [matchBy, setMatchBy] = useState('code');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [fields, setFields] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { api.importFields().then((d) => setFields(d.fields)).catch(() => {}); }, []);

  const choose = async (picked) => {
    if (!picked) return;
    if (!/\.csv$/i.test(picked.name)) {
      setError('Please choose a .csv file. If your list is in Excel, use File → Save As → CSV.');
      return;
    }
    setError('');
    setBusy(true);
    setFile(picked);
    try {
      const p = await api.importPreview(picked);
      if (!p.headers.length) {
        setError('That file has no column headings in the first row.');
        setFile(null);
        return;
      }
      setPreview(p);
      setMapping(p.mapping);
      setStep(2);
    } catch (err) {
      setError(err.message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.importRun(file, mapping, matchBy));
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(1); setFile(null); setPreview(null); setMapping({});
    setResult(null); setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <>
      <header className="topbar"><h1>Import customers</h1></header>

      <div className="content content-narrow">
        <div className="steps">
          <div className={`step ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}>
            <span className="n">{step > 1 ? '✓' : '1'}</span> Choose file
          </div>
          <div className={`step ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}>
            <span className="n">{step > 2 ? '✓' : '2'}</span> Match columns
          </div>
          <div className={`step ${step === 3 ? 'active' : ''}`}>
            <span className="n">3</span> Done
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* ---------------------------------------------------------- Step 1 */}
        {step === 1 && (
          <div className="card">
            <div className="card-body">
              <div
                className={`dropzone${dragOver ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files[0]); }}
              >
                <div className="big">📄</div>
                <p>Drop your CSV file here, or choose it from your computer.</p>
                <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'Choose CSV file'}
                </button>
                <input
                  ref={inputRef} type="file" accept=".csv,text/csv" hidden
                  onChange={(e) => choose(e.target.files[0])}
                />
              </div>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
                The first row must contain column headings. Common headings are matched to the right
                fields automatically — you can correct anything on the next screen before it is saved.
              </p>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- Step 2 */}
        {step === 2 && preview && (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h2>Match your columns</h2>
                <div className="spacer" />
                <span className="badge badge-tier">{mappedCount} of {preview.headers.length} in use</span>
              </div>
              <div className="card-body">
                <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                  <strong>{file?.name}</strong> — check each column went to the right place.
                  Anything set to “Do not import” is ignored.
                </p>

                {preview.headers.map((header) => (
                  <div className="map-row" key={header}>
                    <div>
                      <div className="csv-col">{header}</div>
                      <div className="csv-sample">
                        e.g. {preview.sample.map((r) => r[header]).filter(Boolean).slice(0, 2).join(', ') || '(empty)'}
                      </div>
                    </div>
                    <div className="arrow">→</div>
                    <select
                      className="select"
                      value={mapping[header] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                    >
                      <option value="">Do not import</option>
                      {fields.map((f) => (
                        <option key={f} value={f}>{FIELD_LABELS[f] || f}</option>
                      ))}
                      <option value={`custom:${header.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`}>
                        Keep as extra field “{header}”
                      </option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h2>If a customer already exists</h2></div>
              <div className="card-body">
                <div className="field" style={{ marginBottom: 0 }}>
                  <select className="select" value={matchBy} onChange={(e) => setMatchBy(e.target.value)}>
                    <option value="code">Match on reference / card number, and update them</option>
                    <option value="email">Match on email address, and update them</option>
                    <option value="none">Do not match — add everyone as a new customer</option>
                  </select>
                  <span className="hint">
                    Updating only changes the fields present in your file. Anything not in the file is left alone.
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={run} disabled={busy || !mappedCount}>
                {busy ? <><span className="spinner" /> Importing…</> : 'Import customers'}
              </button>
              <button className="btn btn-secondary" onClick={restart} disabled={busy}>Choose a different file</button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- Step 3 */}
        {step === 3 && result && (
          <div className="card">
            <div className="card-head"><h2>Import finished</h2></div>
            <div className="card-body">
              <div className="result-grid">
                <div className="result-tile" style={{ background: 'var(--success-100)', color: 'var(--success-600)' }}>
                  <div className="n">{result.inserted_rows.toLocaleString()}</div>
                  <div className="l">Added</div>
                </div>
                <div className="result-tile" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
                  <div className="n">{result.updated_rows.toLocaleString()}</div>
                  <div className="l">Updated</div>
                </div>
                <div className="result-tile" style={{ background: 'var(--accent-100)', color: 'var(--accent-600)' }}>
                  <div className="n">{(result.duplicate_rows || 0).toLocaleString()}</div>
                  <div className="l">Duplicates skipped</div>
                </div>
                <div className="result-tile" style={{ background: result.failed_rows ? 'var(--danger-100)' : 'var(--ink-100)', color: result.failed_rows ? 'var(--danger-600)' : 'var(--ink-500)' }}>
                  <div className="n">{result.failed_rows.toLocaleString()}</div>
                  <div className="l">Could not read</div>
                </div>
              </div>

              <p className="muted" style={{ fontSize: 13.5 }}>
                {result.total_rows.toLocaleString()} rows processed in {(result.duration_ms / 1000).toFixed(1)} seconds.
              </p>

              {result.errors.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>
                    Rows that needed attention ({result.errors.length})
                  </h3>
                  <div className="issue-list">
                    {result.errors.map((issue, i) => (
                      <div key={i} className={`issue ${issue.warning ? 'warn' : 'fail'}`}>{issue.message}</div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <a className="btn btn-primary" href="/customers">View customers</a>
                <button className="btn btn-secondary" onClick={restart}>Import another file</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
