import pg from 'pg';

// Money columns come back from pg as strings by default (NUMERIC has no safe JS
// equivalent). We keep that behaviour and format at the edges rather than
// silently converting to float, which would round totals.

export const pool = new pg.Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'rcms',
  password: process.env.PGPASSWORD || undefined,
  database: process.env.PGDATABASE || 'rcms',
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // A pooled client can die while idle (server restart, network blip). Log it
  // rather than letting the unhandled 'error' event take the process down.
  console.error('[db] idle client error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/** Run fn inside a transaction, rolling back on any throw. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
