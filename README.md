# Retail Customer Management System

A web app that keeps shopper data in one place — profiles, loyalty, notes and
support tickets — so the shop floor and the back office see the same live view
of every customer. Built to run on desktop POS terminals and on tablets.

**Stage 1 (this release):** staff accounts and role-based access, customer
onboarding, searchable directory, archiving, and legacy CSV import.

---

## Stack

| Layer    | Choice                    | Why |
|----------|---------------------------|-----|
| Frontend | React 19 + Vite           | Mainstream and easy to hire for; Vite builds in under a second |
| Backend  | Node 20+ / Express 5      | Same language as the front end, so one developer can cover both |
| Database | PostgreSQL 16             | The data is relational (customer → purchases → loyalty → tickets); trigram indexes give fast partial-match search |
| Auth     | JWT + bcrypt              | No server-side session store to run or scale |

**Why not NoSQL:** every question this system answers is a join — a customer's
purchases, their open tickets, top buyers last quarter, who hasn't shopped in
90 days. A document store would push those joins into application code and give
up transactional safety on the CSV import, which is the one operation that must
be all-or-nothing.

---

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer

## Setup

```bash
# 1. Create the database
createdb rcms

# 2. Back end
cd server
npm install
cp .env.example .env      # then edit the values (see below)
npm run seed              # creates tables and the three starter accounts
npm start                 # http://localhost:4000

# 3. Front end (a second terminal, for development)
cd client
npm install
npm run dev               # http://localhost:5173
```

`npm run dev` proxies `/api` to the back end, so the browser stays on one origin
and there is no CORS setup to worry about.

### Environment (`server/.env`)

```ini
PORT=4000
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGDATABASE=rcms
JWT_SECRET=          # a long random string - see note below
```

`JWT_SECRET` signs the login tokens. Generate one with
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Changing it signs everybody out, which is exactly what you want if it ever leaks.

### Starter accounts

`npm run seed` creates three accounts, one per role. The password comes from
`SEED_ADMIN_PASSWORD` / `SEED_OFFICE_PASSWORD` / `SEED_SHOP_PASSWORD`, and falls
back to `demo1234` for local testing.

| Email              | Role       | Can do |
|--------------------|------------|--------|
| admin@demo.local   | Admin      | Everything, including staff accounts |
| office@demo.local  | Back office| Customers, archiving, imports, exports, reports |
| shop@demo.local    | Shop floor | Add and update customers, notes, tickets |

**Change these before going live.** Re-running `seed` never touches accounts
that already exist, so it is safe to run after an update.

## Production build

```bash
cd client && npm run build     # writes client/dist
cd ../server && npm start      # serves the API *and* the built front end on one port
```

The server serves `client/dist` when it exists, so production is a single Node
process behind your reverse proxy — no separate web server for the front end.

---

## How it is put together

```
server/
  migrations/         numbered .sql files, applied automatically on startup
  src/
    index.js          express app, route mounting, error handling
    lib/db.js         connection pool and transaction helper
    lib/migrate.js    migration runner
    lib/importer.js   CSV parsing, column mapping, batch upsert
    middleware/auth.js  JWT verification and the capability table
    routes/           auth, customers, users, imports
client/
  src/
    api.js            every call to the server lives here
    auth.jsx          session context; mirrors the server's capability list
    styles.css        design tokens at the top - see "Brand colours"
    pages/            Login, Directory, CustomerForm, CustomerDetail, Import, Users
```

### Permissions

Routes ask for a **capability** (`customers:archive`), not a role. The mapping
from role to capabilities is the table at the top of
`server/src/middleware/auth.js` — changing what a role may do is a one-line edit
there, and the front end reads the same list back from `/api/auth/me` to decide
which menus and buttons to show.

The UI hiding a button is a convenience, not the control: every route enforces
its own capability server-side, so a hidden button cannot be bypassed by calling
the API directly.

### Database migrations

Any `.sql` file in `server/migrations/` runs automatically at startup, in
filename order, each in its own transaction, and is recorded in
`schema_migrations` so it never runs twice. To change the schema, add
`002_something.sql` — do not edit a migration that has already been applied.

### Brand colours

Every colour in the UI comes from the CSS variables at the top of
`client/src/styles.css`. Changing the `--brand-*` values re-skins the whole app;
no other file contains a colour.

---

## CSV import

Three steps: choose the file, confirm how columns map, import.

- **Automatic column matching.** Common headings are recognised on sight —
  `Customer ID`, `Full Name`, `E-mail Address`, `Mobile`, `Post Code`, `DOB`,
  `Reward Points` and many more. Anything it cannot place is left for you to set
  or ignore.
- **`Full Name` is split** into first and last name on the last space.
- **Dates** are read in ISO, `DD/MM/YYYY`, `DD.MM.YYYY` and `12 Mar 1988` form.
  Ambiguous numeric dates are read day-first.
- **Numbers** handle both conventions: `1,234` is one thousand two hundred,
  `1234,50` is a decimal. Currency symbols are stripped.
- **Yes/No columns** accept `Yes`, `Y`, `TRUE`, `1`, `On`, `Subscribed` and
  their negatives.
- **Extra columns** you want to keep but that have no matching field are stored
  against the customer as named extra fields.
- **Existing customers** are matched on reference number or email (your choice)
  and updated. An update only touches fields present in the file — it never
  blanks out data the file does not mention.
- **Bad rows are reported, not fatal.** A row with no name at all is skipped and
  listed; an unreadable date or invalid email is left blank and flagged. Every
  import is recorded in `import_jobs` with its counts and issues.

The whole import runs in one transaction, so it either lands completely or not
at all — you never end up with half a customer list.

---

## Tested against the acceptance criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Create, search, edit and archive in under 20 seconds | Create 0.12s, edit 0.42s, archive 0.05s, search 0.03s — measured through a real browser |
| 2 | 5,000-row CSV imports without errors, records display correctly | 5,016-row file: 5,010 added, 1 updated, 5 unreadable rows reported, **453 ms** |
| 3 | Role permissions enforced | Shop-floor role returns 403 on archive, import and staff admin; menus hidden to match |

The 5,000-row test file was deliberately messy — four different date formats,
invalid emails, blank phone numbers, ragged rows, single-word names and a
duplicate reference — because that is what a real legacy export looks like.

## API

All routes except `/api/health` and `/api/auth/login` need
`Authorization: Bearer <token>`.

| Method | Path | Capability |
|--------|------|-----------|
| POST | `/api/auth/login` | — |
| GET | `/api/auth/me` | any signed-in user |
| POST | `/api/auth/change-password` | any signed-in user |
| GET | `/api/customers` | `customers:read` |
| GET | `/api/customers/:id` | `customers:read` |
| POST | `/api/customers` | `customers:create` |
| PUT | `/api/customers/:id` | `customers:update` |
| POST | `/api/customers/:id/archive` | `customers:archive` |
| POST | `/api/import/preview` | `import:run` |
| POST | `/api/import/run` | `import:run` |
| GET | `/api/import/jobs` | `import:run` |
| GET/POST/PUT | `/api/users` | `users:manage` |

`GET /api/customers` takes `search`, `status` (`active`/`archived`/`all`),
`page`, `limit`, `sort` and `dir`.

---

## Still to come

The database schema already covers these, so they need no migration:

- Purchase-history timeline, notes and follow-up reminders, support tickets
- Analytics: top buyers, dormant customers
- Admin panel for custom fields and segmented export for email campaigns
