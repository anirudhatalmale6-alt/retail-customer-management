import express from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { requireCap } from '../middleware/auth.js';

export const router = express.Router();

const customerSchema = z.object({
  customer_code: z.string().trim().max(64).optional().nullable(),
  first_name: z.string().trim().min(1, 'First name is required').max(120),
  last_name: z.string().trim().min(1, 'Last name is required').max(120),
  email: z.string().trim().email('Enter a valid email').max(200).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  address_line1: z.string().trim().max(200).optional().nullable(),
  address_line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  postcode: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable().or(z.literal('')),
  marketing_opt_in: z.boolean().optional(),
  loyalty_tier: z.string().trim().max(40).optional().nullable(),
  loyalty_points: z.number().int().min(0).optional(),
  custom_fields: z.record(z.string(), z.any()).optional(),
});

// Empty strings from HTML inputs must become NULL, otherwise a blank email
// would occupy the unique index and block the next blank one.
const blankToNull = (v) => (v === '' || v === undefined ? null : v);

const SORTABLE = {
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  last_name: 'c.last_name',
  loyalty_points: 'c.loyalty_points',
};

/** GET /api/customers - searchable, paged directory. */
router.get('/', requireCap('customers:read'), async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const status = req.query.status === 'archived' ? 'archived'
      : req.query.status === 'all' ? 'all' : 'active';
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const sortCol = SORTABLE[req.query.sort] || 'c.updated_at';
    const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const params = [];

    if (status === 'active') where.push('c.archived_at IS NULL');
    else if (status === 'archived') where.push('c.archived_at IS NOT NULL');

    if (search) {
      params.push(`%${search}%`);
      const like = `$${params.length}`;
      // ILIKE against the trigram-indexed expressions. Postgres uses the GIN
      // indexes for these, so it stays fast well past the 5k-row target.
      where.push(`(
        (coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ILIKE ${like}
        OR coalesce(c.email,'') ILIKE ${like}
        OR coalesce(c.phone,'') ILIKE ${like}
        OR coalesce(c.customer_code,'') ILIKE ${like}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    const sql = `
      SELECT c.*,
             count(*) OVER() AS total_count
      FROM customers c
      ${whereSql}
      ORDER BY ${sortCol} ${sortDir}, c.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await query(sql, params);
    const total = rows.length ? Number(rows[0].total_count) : 0;

    res.json({
      customers: rows.map(({ total_count, ...c }) => c),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) { next(err); }
});

/** GET /api/customers/:id - one customer with counts for the detail header. */
router.get('/:id', requireCap('customers:read'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT count(*) FROM purchases p WHERE p.customer_id = c.id) AS purchase_count,
              (SELECT coalesce(sum(p.total_amount),0) FROM purchases p WHERE p.customer_id = c.id) AS lifetime_value,
              (SELECT max(p.occurred_at) FROM purchases p WHERE p.customer_id = c.id) AS last_purchase_at,
              (SELECT count(*) FROM notes n WHERE n.customer_id = c.id) AS note_count,
              (SELECT count(*) FROM tickets t WHERE t.customer_id = c.id AND t.status IN ('open','pending')) AS open_ticket_count
       FROM customers c WHERE c.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** POST /api/customers */
router.post('/', requireCap('customers:create'), async (req, res, next) => {
  try {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message, issues: parsed.error.issues });
    }
    const d = parsed.data;
    const { rows } = await query(
      `INSERT INTO customers
         (customer_code, first_name, last_name, email, phone, address_line1, address_line2,
          city, postcode, country, date_of_birth, marketing_opt_in, loyalty_tier,
          loyalty_points, custom_fields, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        blankToNull(d.customer_code), d.first_name, d.last_name, blankToNull(d.email),
        blankToNull(d.phone), blankToNull(d.address_line1), blankToNull(d.address_line2),
        blankToNull(d.city), blankToNull(d.postcode), blankToNull(d.country),
        blankToNull(d.date_of_birth), d.marketing_opt_in ?? false,
        blankToNull(d.loyalty_tier), d.loyalty_points ?? 0,
        JSON.stringify(d.custom_fields ?? {}), req.user.id,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A customer with that reference code already exists' });
    }
    next(err);
  }
});

/** PUT /api/customers/:id - partial update; only supplied keys change. */
router.put('/:id', requireCap('customers:update'), async (req, res, next) => {
  try {
    const parsed = customerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message, issues: parsed.error.issues });
    }
    const d = parsed.data;

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(d)) {
      params.push(key === 'custom_fields' ? JSON.stringify(value) : blankToNull(value));
      sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A customer with that reference code already exists' });
    }
    next(err);
  }
});

/**
 * POST /api/customers/:id/archive  { archived: true|false }
 * Archiving is reversible and never deletes: purchase history and tickets stay
 * intact for reporting, the record just leaves the default directory view.
 */
router.post('/:id/archive', requireCap('customers:archive'), async (req, res, next) => {
  try {
    const archived = req.body?.archived !== false;
    const { rows } = await query(
      `UPDATE customers SET archived_at = ${archived ? 'now()' : 'NULL'} WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});
