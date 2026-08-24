import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { signToken, requireAuth, capabilitiesFor } from '../middleware/auth.js';

export const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

/** POST /api/auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Email and password are required' });

    const { rows } = await query(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [parsed.data.email],
    );
    const user = rows[0];

    // Same message and roughly the same work for "no such user" and "wrong
    // password", so the response cannot be used to enumerate staff accounts.
    const hash = user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(parsed.data.password, hash);
    if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password' });
    if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated' });

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    res.json({
      token: signToken(user),
      user: {
        id: user.id, email: user.email, full_name: user.full_name, role: user.role,
        capabilities: capabilitiesFor(user.role),
      },
    });
  } catch (err) { next(err); }
});

/** GET /api/auth/me - used by the front end to restore a session on reload. */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id, email: req.user.email, full_name: req.user.full_name,
      role: req.user.role, capabilities: capabilitiesFor(req.user.role),
    },
  });
});

/** POST /api/auth/change-password - a user changing their own password. */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!await bcrypt.compare(current_password || '', rows[0].password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2',
      [await bcrypt.hash(new_password, 10), req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
