import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { requireCap } from '../middleware/auth.js';

export const router = express.Router();

const ROLES = ['admin', 'back_office', 'front_of_house'];

const userSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  full_name: z.string().trim().min(1, 'Name is required').max(160),
  role: z.enum(ROLES),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

router.get('/', requireCap('users:manage'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, full_name, role, is_active, last_login_at, created_at
       FROM users ORDER BY full_name`,
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
});

router.post('/', requireCap('users:manage'), async (req, res, next) => {
  try {
    const parsed = userSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const d = parsed.data;
    const { rows } = await query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [d.email, d.full_name, d.role, await bcrypt.hash(d.password, 10)],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email is already in use' });
    next(err);
  }
});

router.put('/:id', requireCap('users:manage'), async (req, res, next) => {
  try {
    const parsed = userSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const d = parsed.data;

    const targetId = Number(req.params.id);

    // Never let the last active admin lose admin, or nobody can administer the
    // system again.
    if (d.role && d.role !== 'admin') {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
        [targetId],
      );
      if (rows[0].n === 0) return res.status(400).json({ error: 'There must be at least one active admin' });
    }

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(d)) {
      if (key === 'password') {
        params.push(await bcrypt.hash(value, 10));
        sets.push(`password_hash = $${params.length}`);
      } else {
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (typeof req.body.is_active === 'boolean') {
      if (!req.body.is_active && targetId === req.user.id) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      params.push(req.body.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(targetId);
    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, email, full_name, role, is_active, last_login_at, created_at`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email is already in use' });
    next(err);
  }
});
