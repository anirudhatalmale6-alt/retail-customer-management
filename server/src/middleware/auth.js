import jwt from 'jsonwebtoken';
import { query } from '../lib/db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TOKEN_TTL = process.env.JWT_TTL || '12h';

/**
 * Capability-based permissions. Routes ask for a capability ("customers:archive")
 * rather than naming roles, so changing what a role may do is a one-line edit
 * here instead of a hunt through the route files.
 */
const FRONT_OF_HOUSE = [
  'customers:read', 'customers:create', 'customers:update',
  'purchases:read',
  'notes:read', 'notes:write',
  'reminders:read', 'reminders:write',
  'tickets:read', 'tickets:write',
];

const BACK_OFFICE = [
  ...FRONT_OF_HOUSE,
  'customers:archive',
  'purchases:write',
  'analytics:read',
  'import:run', 'export:run',
];

// Listed explicitly rather than using a wildcard: the front end asks the API
// which capabilities it has and hides menus accordingly, so every capability
// an admin holds has to be enumerable, not implied.
const ADMIN = [
  ...BACK_OFFICE,
  'users:manage',
  'fields:manage',
  'settings:manage',
];

const ROLE_CAPABILITIES = {
  admin: ADMIN,
  back_office: BACK_OFFICE,
  front_of_house: FRONT_OF_HOUSE,
};

export function capabilitiesFor(role) {
  return ROLE_CAPABILITIES[role] || [];
}

export function can(role, capability) {
  return (ROLE_CAPABILITIES[role] || []).includes(capability);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

/** Verifies the bearer token and re-checks the account is still active. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }

  // Hit the DB so that deactivating a user takes effect immediately rather than
  // when their token happens to expire.
  const { rows } = await query(
    'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'Account is not active' });

  req.user = user;
  next();
}

/** Route guard: requireCap('customers:archive'). */
export function requireCap(capability) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!can(req.user.role, capability)) {
      return res.status(403).json({ error: 'Your role does not allow this action' });
    }
    next();
  };
}
