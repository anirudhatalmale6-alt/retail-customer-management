import { parse } from 'csv-parse/sync';
import { withTransaction } from './db.js';

// Columns a CSV may write into directly. Anything else the admin maps is stored
// in customers.custom_fields.
export const CORE_FIELDS = [
  'customer_code', 'first_name', 'last_name', 'email', 'phone',
  'address_line1', 'address_line2', 'city', 'postcode', 'country',
  'date_of_birth', 'marketing_opt_in', 'loyalty_tier', 'loyalty_points',
];

// Header aliases seen in real exports from POS and spreadsheet tools. Keys are
// normalised (lowercase, non-alphanumerics stripped) before lookup.
const HEADER_ALIASES = {
  customercode: 'customer_code', code: 'customer_code', customerid: 'customer_code',
  id: 'customer_code', accountnumber: 'customer_code', reference: 'customer_code',
  firstname: 'first_name', forename: 'first_name', givenname: 'first_name', fname: 'first_name',
  lastname: 'last_name', surname: 'last_name', familyname: 'last_name', lname: 'last_name',
  name: 'full_name', fullname: 'full_name', customername: 'full_name',
  email: 'email', emailaddress: 'email', mail: 'email',
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', telephone: 'phone',
  tel: 'phone', contactnumber: 'phone', cell: 'phone',
  address: 'address_line1', address1: 'address_line1', addressline1: 'address_line1', street: 'address_line1',
  address2: 'address_line2', addressline2: 'address_line2',
  city: 'city', town: 'city', suburb: 'city',
  postcode: 'postcode', postalcode: 'postcode', zip: 'postcode', zipcode: 'postcode',
  country: 'country',
  dob: 'date_of_birth', dateofbirth: 'date_of_birth', birthday: 'date_of_birth', birthdate: 'date_of_birth',
  marketing: 'marketing_opt_in', marketingoptin: 'marketing_opt_in', optin: 'marketing_opt_in',
  newsletter: 'marketing_opt_in', emailconsent: 'marketing_opt_in',
  tier: 'loyalty_tier', loyaltytier: 'loyalty_tier', membership: 'loyalty_tier', loyaltylevel: 'loyalty_tier',
  points: 'loyalty_points', loyaltypoints: 'loyalty_points', rewardpoints: 'loyalty_points', balance: 'loyalty_points',
};

const normaliseHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best-guess mapping of CSV headers to system fields; the admin can override. */
export function suggestMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const guess = HEADER_ALIASES[normaliseHeader(header)];
    mapping[header] = guess || '';   // '' = ignore this column
  }
  return mapping;
}

/**
 * Parse a date written in any of the formats spreadsheets produce.
 * Ambiguous numeric dates are read as DD/MM/YYYY unless the first part cannot
 * be a day, because the brief is a UK/EU retail shop. Returns null if unusable.
 */
function parseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    let [, a, b, y] = slash;
    let day = Number(a), month = Number(b);
    if (day > 12 && month <= 12) { /* clearly DD/MM */ }
    else if (month > 12 && day <= 12) { [day, month] = [month, day]; }  // clearly MM/DD
    if (day > 31 || month > 12 || day < 1 || month < 1) return null;
    if (y.length === 2) y = Number(y) > 30 ? `19${y}` : `20${y}`;       // 2-digit year window
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const named = Date.parse(raw);                                        // "12 Mar 1988"
  if (!Number.isNaN(named)) return new Date(named).toISOString().slice(0, 10);
  return null;
}

/**
 * Parse a number written the way spreadsheets across regions write them.
 * "1,234" is one thousand two hundred; "1234,50" is a European decimal and must
 * NOT become 123450. Returns null if there is no number in there at all.
 */
function parseNumber(value) {
  const raw = String(value ?? '').trim().replace(/[^0-9.,-]/g, '');   // drop currency symbols
  if (!raw) return null;

  let normalised;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
    normalised = raw.replace(/,/g, '');                 // 1,234,567.89 -> thousands separators
  } else if (/^-?\d+(\.\d{3})+(,\d+)?$/.test(raw)) {
    normalised = raw.replace(/\./g, '').replace(',', '.'); // 1.234.567,89 -> European
  } else if (/,\d{1,2}$/.test(raw) && !raw.includes('.')) {
    normalised = raw.replace(',', '.');                 // 1234,50 -> decimal comma
  } else {
    normalised = raw.replace(/,/g, '');
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 't', 'on', 'opted in', 'subscribed']);
const FALSY = new Set(['0', 'false', 'no', 'n', 'f', 'off', '', 'opted out', 'unsubscribed']);

function parseBool(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return null;                     // unrecognised - treated as a row warning
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Turn one CSV row into a customer object, or return the reason it cannot be. */
function buildRow(record, mapping, rowNumber) {
  const out = { custom_fields: {} };
  const warnings = [];

  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = record[header];
    if (value === undefined) continue;
    const text = String(value).trim();

    if (target === 'full_name') {
      // Split a single name column on the last space: "Mary Jane Watson" ->
      // first "Mary Jane", last "Watson".
      if (!text) continue;
      const idx = text.lastIndexOf(' ');
      if (idx === -1) { out.first_name = text; out.last_name = out.last_name || '-'; }
      else { out.first_name = text.slice(0, idx); out.last_name = text.slice(idx + 1); }
      continue;
    }

    if (target === 'date_of_birth') {
      if (!text) continue;
      const parsed = parseDate(text);
      if (!parsed) warnings.push(`Could not read date of birth "${text}", left blank`);
      out.date_of_birth = parsed;
      continue;
    }

    if (target === 'marketing_opt_in') {
      const parsed = parseBool(text);
      if (parsed === null && text) warnings.push(`Could not read marketing opt-in "${text}", set to No`);
      out.marketing_opt_in = parsed ?? false;
      continue;
    }

    if (target === 'loyalty_points') {
      if (!text) continue;
      const n = parseNumber(text);
      if (n === null) { warnings.push(`Could not read points "${text}", set to 0`); out.loyalty_points = 0; }
      else out.loyalty_points = Math.max(0, Math.round(n));
      continue;
    }

    if (target === 'email') {
      if (!text) continue;
      if (!EMAIL_RE.test(text)) { warnings.push(`"${text}" is not a valid email, left blank`); continue; }
      out.email = text.toLowerCase();
      continue;
    }

    if (CORE_FIELDS.includes(target)) {
      if (text) out[target] = text;
      continue;
    }

    // Unmapped-but-kept column -> custom field.
    if (target.startsWith('custom:')) {
      if (text) out.custom_fields[target.slice(7)] = text;
    }
  }

  if (!out.first_name && !out.last_name) {
    return { error: `Row ${rowNumber}: no name found - skipped` };
  }
  out.first_name = out.first_name || '-';
  out.last_name = out.last_name || '-';

  return { row: out, warnings };
}

const COLUMNS = [
  'customer_code', 'first_name', 'last_name', 'email', 'phone', 'address_line1',
  'address_line2', 'city', 'postcode', 'country', 'date_of_birth',
  'marketing_opt_in', 'loyalty_tier', 'loyalty_points', 'custom_fields', 'created_by',
];

// Columns declared NOT NULL in the schema. A ragged CSV row simply has no cell
// for these, so an explicit default is substituted rather than letting NULL
// reach the database and abort the whole import.
const NOT_NULL_DEFAULTS = {
  marketing_opt_in: false,
  loyalty_points: 0,
};

/**
 * Import CSV text.
 *
 * matchBy: 'code' | 'email' | 'none' - how an incoming row is recognised as an
 * existing customer. 'none' always inserts.
 *
 * The whole import runs in one transaction: the brief requires a 5,000-row file
 * to complete "without errors", and a half-applied import is worse than none.
 * Unreadable rows are reported and skipped, they do not abort the good rows.
 */
export async function importCsv({ text, mapping, matchBy = 'code', userId }) {
  const started = Date.now();

  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,     // ragged rows are common in legacy exports
    bom: true,
  });

  const prepared = [];
  const errors = [];
  const MAX_REPORTED = 200;       // cap what we store so one bad file cannot bloat the row

  records.forEach((record, i) => {
    const rowNumber = i + 2;      // +1 for 0-index, +1 for the header line
    const { row, error, warnings } = buildRow(record, mapping, rowNumber);
    if (error) {
      if (errors.length < MAX_REPORTED) errors.push({ row: rowNumber, message: error });
      return;
    }
    for (const w of warnings || []) {
      if (errors.length < MAX_REPORTED) errors.push({ row: rowNumber, message: `Row ${rowNumber}: ${w}`, warning: true });
    }
    prepared.push(row);
  });

  let inserted = 0;
  let updated = 0;
  let duplicates = 0;

  // Sentinel stored in the match map for a key we have already queued for
  // insert in this run but that has no database id yet.
  const SEEN_IN_FILE = -1;

  await withTransaction(async (client) => {
    const CHUNK = 500;
    for (let start = 0; start < prepared.length; start += CHUNK) {
      const chunk = prepared.slice(start, start + CHUNK);

      // Find which rows in this chunk already exist, so we update instead of
      // creating duplicates.
      let existing = new Map();
      if (matchBy !== 'none') {
        const keyCol = matchBy === 'email' ? 'email' : 'customer_code';
        const keys = [...new Set(chunk.map((r) => r[keyCol]).filter(Boolean).map((k) => String(k).toLowerCase()))];
        if (keys.length) {
          const { rows } = await client.query(
            `SELECT id, lower(${keyCol}) AS k FROM customers WHERE lower(${keyCol}) = ANY($1)`,
            [keys],
          );
          existing = new Map(rows.map((r) => [r.k, r.id]));
        }
      }

      const toInsert = [];
      for (const row of chunk) {
        const keyCol = matchBy === 'email' ? 'email' : 'customer_code';
        const key = row[keyCol] ? String(row[keyCol]).toLowerCase() : null;
        const id = key ? existing.get(key) : undefined;

        if (id === SEEN_IN_FILE) {
          // Same key twice in the one file. Report it rather than counting a
          // no-op update, so the totals the admin sees always add up.
          duplicates++;
          if (errors.length < MAX_REPORTED) {
            errors.push({ message: `Duplicate ${keyCol} "${row[keyCol]}" appears more than once in the file - later copy skipped`, warning: true });
          }
          continue;
        }

        if (id) {
          // Update only the fields the CSV actually supplied - an import must
          // not blank out data the file does not mention.
          const sets = [];
          const params = [];
          for (const col of COLUMNS) {
            if (col === 'created_by') continue;
            if (col === 'custom_fields') {
              if (Object.keys(row.custom_fields).length) {
                params.push(JSON.stringify(row.custom_fields));
                sets.push(`custom_fields = customers.custom_fields || $${params.length}::jsonb`);
              }
              continue;
            }
            if (row[col] !== undefined) {
              params.push(row[col]);
              sets.push(`${col} = $${params.length}`);
            }
          }
          if (sets.length) {
            params.push(id);
            await client.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
          }
          updated++;
        } else {
          toInsert.push(row);
          // Guard against the same key appearing twice inside one file.
          if (key) existing.set(key, SEEN_IN_FILE);
        }
      }

      if (toInsert.length) {
        // Multi-row INSERT: one round trip per 500 rows instead of per row.
        const params = [];
        const tuples = toInsert.map((row) => {
          const placeholders = COLUMNS.map((col) => {
            const value = col === 'custom_fields' ? JSON.stringify(row.custom_fields)
              : col === 'created_by' ? userId
                : row[col] ?? NOT_NULL_DEFAULTS[col] ?? null;
            params.push(value);
            return `$${params.length}${col === 'custom_fields' ? '::jsonb' : ''}`;
          });
          return `(${placeholders.join(',')})`;
        });
        const { rowCount } = await client.query(
          `INSERT INTO customers (${COLUMNS.join(',')}) VALUES ${tuples.join(',')}
           ON CONFLICT DO NOTHING`,
          params,
        );
        inserted += rowCount;
      }
    }
  });

  return {
    total_rows: records.length,
    inserted_rows: inserted,
    updated_rows: updated,
    duplicate_rows: duplicates,
    failed_rows: errors.filter((e) => !e.warning).length,
    errors,
    duration_ms: Date.now() - started,
  };
}

/** Parse just the headers and a few sample rows so the admin can confirm mapping. */
export function previewCsv(text, sampleSize = 5) {
  const records = parse(text, {
    columns: true, skip_empty_lines: true, trim: true,
    relax_column_count: true, bom: true, to: sampleSize + 1,
  });
  const headers = records.length ? Object.keys(records[0]) : [];
  return { headers, mapping: suggestMapping(headers), sample: records.slice(0, sampleSize) };
}
