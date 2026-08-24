/**
 * Creates the three demo staff accounts. Safe to re-run: existing accounts are
 * left untouched. Passwords come from the environment in production.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query } from './lib/db.js';
import { runMigrations } from './lib/migrate.js';

const ACCOUNTS = [
  { email: 'admin@demo.local',  full_name: 'Store Owner',   role: 'admin',          env: 'SEED_ADMIN_PASSWORD' },
  { email: 'office@demo.local', full_name: 'Back Office',   role: 'back_office',    env: 'SEED_OFFICE_PASSWORD' },
  { email: 'shop@demo.local',   full_name: 'Shop Floor',    role: 'front_of_house', env: 'SEED_SHOP_PASSWORD' },
];

async function main() {
  await runMigrations();

  for (const account of ACCOUNTS) {
    const password = process.env[account.env] || 'demo1234';
    const { rows } = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [account.email]);
    if (rows[0]) {
      console.log(`[seed] ${account.email} already exists, skipped`);
      continue;
    }
    await query(
      'INSERT INTO users (email, full_name, role, password_hash) VALUES ($1,$2,$3,$4)',
      [account.email, account.full_name, account.role, await bcrypt.hash(password, 10)],
    );
    console.log(`[seed] created ${account.email} (${account.role})`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});
