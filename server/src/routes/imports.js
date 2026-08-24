import express from 'express';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireCap } from '../middleware/auth.js';
import { importCsv, previewCsv, CORE_FIELDS } from '../lib/importer.js';

export const router = express.Router();

// 20 MB comfortably covers a 5,000-row customer export (typically well under
// 2 MB) while refusing anything that would exhaust memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const fileText = (req) => req.file.buffer.toString('utf8');

/** GET /api/import/fields - what a CSV column can be mapped onto. */
router.get('/fields', requireCap('import:run'), (req, res) => {
  res.json({ fields: [...CORE_FIELDS, 'full_name'] });
});

/** POST /api/import/preview - headers, suggested mapping and sample rows. */
router.post('/preview', requireCap('import:run'), upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });
    res.json(previewCsv(fileText(req)));
  } catch (err) {
    res.status(400).json({ error: `Could not read that CSV: ${err.message}` });
  }
});

/** POST /api/import/run - apply the import using a confirmed mapping. */
router.post('/run', requireCap('import:run'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded' });

    let mapping;
    try {
      mapping = JSON.parse(req.body.mapping || '{}');
    } catch {
      return res.status(400).json({ error: 'Column mapping was not valid JSON' });
    }
    if (!Object.values(mapping).some(Boolean)) {
      return res.status(400).json({ error: 'Map at least one column before importing' });
    }

    const matchBy = ['code', 'email', 'none'].includes(req.body.match_by) ? req.body.match_by : 'code';

    const result = await importCsv({
      text: fileText(req), mapping, matchBy, userId: req.user.id,
    });

    const { rows } = await query(
      `INSERT INTO import_jobs
         (filename, total_rows, inserted_rows, updated_rows, failed_rows, errors, duration_ms, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        req.file.originalname, result.total_rows, result.inserted_rows, result.updated_rows,
        result.failed_rows, JSON.stringify(result.errors), result.duration_ms, req.user.id,
      ],
    );

    res.json({ ...result, job_id: rows[0].id });
  } catch (err) { next(err); }
});

/** GET /api/import/jobs - import history. */
router.get('/jobs', requireCap('import:run'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT j.*, u.full_name AS created_by_name
       FROM import_jobs j LEFT JOIN users u ON u.id = j.created_by
       ORDER BY j.created_at DESC LIMIT 50`,
    );
    res.json({ jobs: rows });
  } catch (err) { next(err); }
});
