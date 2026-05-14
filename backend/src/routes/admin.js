const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { queries, getDB, transaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { validate, rules } = require('../middleware/validate');
const logger = require('../utils/logger');

// ── AUTH ──────────────────────────────────────────────────────────

// POST /admin/auth/login
router.post('/auth/login', validate(rules.loginFields), async (req, res) => {
  try {
    const { username, password } = req.body;

    const admin = queries.getAdminByUsername(username);

    // Timing-safe: always run bcrypt even if user not found
    const hash = admin?.password_hash || '$2a$12$invalidhashtopreventtimingattack000000000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!admin || !valid) {
      logger.warn('Failed login attempt', {
        username,
        ip: req.ip,
        ua: req.headers['user-agent']?.substring(0, 100)
      });
      // Same error message regardless of whether user exists (prevents enumeration)
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    queries.updateLastLogin(admin.id);

    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = jwt.sign(
      { sub: admin.id, username: admin.username },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn, issuer: 'desttek' }
    );

    // Parse expiry string (e.g. "8h", "30m") to milliseconds for cookie maxAge
    const expiryMs = (() => {
      const m = expiresIn.match(/^(\d+)(h|m|d)$/);
      if (!m) return 8 * 3600 * 1000;
      return parseInt(m[1]) * { h: 3600, m: 60, d: 86400 }[m[2]] * 1000;
    })();

    res.cookie('dt_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: expiryMs,
    });

    logger.info('Admin login', { username: admin.username, ip: req.ip });
    res.json({ expiresIn, username: admin.username });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /admin/auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie('dt_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.json({ success: true });
});

// POST /admin/auth/verify
router.post('/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, username: req.admin.username });
});

// All routes below require auth
router.use(requireAuth);

// ── CATEGORIES ────────────────────────────────────────────────────

router.get('/categories', (req, res) => {
  try {
    res.json({ data: queries.getAllCategories() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.post('/categories',
  validate([rules.categoryName]),
  audit('CREATE_CATEGORY', (req, body) => body.data?.id),
  (req, res) => {
    try {
      const id = uuidv4();
      const cats = queries.getAllCategories();
      const position = cats.length;
      queries.insertCategory(id, req.body.name.trim(), position);
      res.status(201).json({ data: { id, name: req.body.name.trim(), position } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create category' });
    }
  }
);

router.put('/categories/:id',
  validate([rules.categoryName]),
  audit('UPDATE_CATEGORY', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      const cat = queries.getCategoryById(id);
      if (!cat) return res.status(404).json({ error: 'Category not found' });
      const position = req.body.position ?? cat.position;
      queries.updateCategory(req.body.name.trim(), position, id);
      res.json({ data: { id, name: req.body.name.trim(), position } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update category' });
    }
  }
);

router.delete('/categories/:id',
  audit('DELETE_CATEGORY', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      const cat = queries.getCategoryById(id);
      if (!cat) return res.status(404).json({ error: 'Category not found' });
      queries.deleteCategory(id); // cascades to records and fields
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete category' });
    }
  }
);

// ── RECORDS ───────────────────────────────────────────────────────

router.get('/categories/:id/records', (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
    res.json({ data: queries.getRecordsByCategory(id) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

router.get('/records/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
    const record = queries.getRecordById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const fields = queries.getFieldsByRecord(id);
    res.json({ data: { ...record, fields } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch record' });
  }
});

const DEFAULT_FIELDS = [
  { label: 'KULLANIM AMACI', type: 'textarea', isFixed: 1 },
  { label: 'KAYIT BAŞLIĞI',  type: 'input',    isFixed: 1 },
  { label: 'KAYIT İÇERİĞİ', type: 'textarea', isFixed: 1 },
  { label: 'UYARI / NOT',   type: 'textarea', isFixed: 1 },
];

router.post('/categories/:catId/records',
  validate([rules.recordName]),
  audit('CREATE_RECORD', (req, body) => body.data?.id),
  (req, res) => {
    try {
      const { catId } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(catId)) return res.status(400).json({ error: 'Invalid id' });

      const recs = queries.getRecordsByCategory(catId);
      const id = uuidv4();
      const position = recs.length;

      const insertWithFields = transaction(() => {
        queries.insertRecord(id, catId, req.body.name.trim(), position);
        DEFAULT_FIELDS.forEach((f, i) => {
          queries.insertField(uuidv4(), id, f.label, f.type, '', i, f.isFixed);
        });
      });
      insertWithFields();

      res.status(201).json({
        data: {
          id,
          name: req.body.name.trim(),
          category_id: catId,
          position,
          fields: DEFAULT_FIELDS.map((f, i) => ({ label: f.label, type: f.type, value: '', position: i, is_fixed: 1 }))
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create record' });
    }
  }
);

router.put('/records/:id',
  validate([rules.recordName]),
  audit('UPDATE_RECORD', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      const rec = queries.getRecordById(id);
      if (!rec) return res.status(404).json({ error: 'Record not found' });
      const position = req.body.position ?? rec.position ?? 0;
      queries.updateRecord(req.body.name.trim(), position, id);
      res.json({ data: { id, name: req.body.name.trim(), position } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update record' });
    }
  }
);

router.delete('/records/:id',
  audit('DELETE_RECORD', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      const rec = queries.getRecordById(id);
      if (!rec) return res.status(404).json({ error: 'Record not found' });
      queries.deleteRecord(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete record' });
    }
  }
);

// ── FIELDS ────────────────────────────────────────────────────────

router.post('/records/:recId/fields',
  validate([rules.fieldLabel, rules.fieldType, rules.fieldValue]),
  audit('CREATE_FIELD', (req) => req.params.recId),
  (req, res) => {
    try {
      const { recId } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(recId)) return res.status(400).json({ error: 'Invalid id' });
      const existing = queries.getFieldsByRecord(recId);
      const id = uuidv4();
      const position = existing.length;
      queries.insertField(id, recId, req.body.label.trim().toUpperCase(), req.body.type, req.body.value || '', position, 0);
      res.status(201).json({ data: { id, label: req.body.label.trim().toUpperCase(), type: req.body.type, value: req.body.value || '', position, is_fixed: 0 } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create field' });
    }
  }
);

router.put('/fields/:id',
  validate([rules.fieldLabel, rules.fieldValue]),
  audit('UPDATE_FIELD', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      queries.updateField(
        req.body.label?.trim().toUpperCase() || '',
        req.body.value || '',
        req.body.position ?? 0,
        id
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update field' });
    }
  }
);

router.delete('/fields/:id',
  audit('DELETE_FIELD', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });
      queries.deleteField(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete field' });
    }
  }
);

// ── BULK SAVE (full record patch) ────────────────────────────────

router.put('/records/:id/full',
  audit('FULL_UPDATE_RECORD', (req) => req.params.id),
  (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });

      const rec = queries.getRecordById(id);
      if (!rec) return res.status(404).json({ error: 'Record not found' });

      const { name, fields } = req.body;
      if (!name || typeof name !== 'string') return res.status(422).json({ error: 'name required' });
      if (!Array.isArray(fields)) return res.status(422).json({ error: 'fields must be array' });

      const saveAll = transaction(() => {
        queries.updateRecord(name.trim().substring(0, 200), rec.position, id);
        fields.forEach((f) => {
          if (!f.id || !/^[0-9a-f-]{36}$/i.test(f.id)) return;
          queries.updateField(
            (f.label || '').trim().toUpperCase().substring(0, 100),
            (f.value || '').substring(0, 10000),
            f.position ?? 0,
            f.id
          );
        });
      });
      saveAll();

      res.json({ success: true });
    } catch (err) {
      logger.error('Full update error', { error: err.message });
      res.status(500).json({ error: 'Failed to save record' });
    }
  }
);

// ── IMPORT (JSON) ─────────────────────────────────────────────────

router.post('/import',
  audit('IMPORT_DATA', () => 'bulk-import'),
  (req, res) => {
    try {
      const { categories } = req.body;
      if (!Array.isArray(categories)) return res.status(422).json({ error: 'Expected { categories: [] }' });
      if (categories.length > 200) return res.status(422).json({ error: 'Max 200 categories per import' });

      let totalRecords = 0;
      for (const cat of categories) {
        if (Array.isArray(cat.records)) totalRecords += cat.records.length;
      }
      if (totalRecords > 2000) return res.status(422).json({ error: 'Max 2000 records per import' });

      let catCount = 0, recCount = 0;

      const doImport = transaction(() => {
        categories.forEach((cat, ci) => {
          if (!cat.name || typeof cat.name !== 'string') return;
          const catId = uuidv4();
          queries.insertCategory(catId, cat.name.trim().substring(0, 100), ci);
          catCount++;

          (cat.records || []).forEach((rec, ri) => {
            if (!rec.name || typeof rec.name !== 'string') return;
            const recId = uuidv4();
            queries.insertRecord(recId, catId, rec.name.trim().substring(0, 200), ri);
            recCount++;

            const fieldsToInsert = (rec.fields && rec.fields.length > 0)
              ? rec.fields
              : DEFAULT_FIELDS;

            fieldsToInsert.forEach((f, fi) => {
              queries.insertField(
                uuidv4(), recId,
                (f.label || '').trim().toUpperCase().substring(0, 100),
                ['textarea', 'input'].includes(f.type) ? f.type : 'textarea',
                (f.value || '').substring(0, 10000),
                fi,
                f.is_fixed ?? f.isFixed ?? 0
              );
            });
          });
        });
      });
      doImport();

      logger.info('Import completed', { categories: catCount, records: recCount, admin: req.admin.username });
      res.json({ success: true, imported: { categories: catCount, records: recCount } });
    } catch (err) {
      logger.error('Import error', { error: err.message });
      res.status(500).json({ error: 'Import failed' });
    }
  }
);

// ── EXPORT (full JSON) ────────────────────────────────────────────

router.get('/export', (req, res) => {
  try {
    const categories = queries.getAllCategories();
    const data = categories.map(cat => {
      const records = queries.getRecordsByCategory(cat.id);
      return {
        ...cat,
        records: records.map(rec => ({
          ...rec,
          fields: queries.getFieldsByRecord(rec.id)
        }))
      };
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="desttek-export-${Date.now()}.json"`);
    res.json({ exported_at: new Date().toISOString(), version: '1', categories: data });
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── BACKUP (SQLite file download) ────────────────────────────────

router.get('/backup', (req, res) => {
  try {
    const dbPath = path.resolve(process.env.DB_PATH || './data/desttek.db');
    if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database file not found' });

    const db = getDB();
    // Checkpoint WAL before backup
    db.pragma('wal_checkpoint(TRUNCATE)');

    const filename = `desttek-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fs.statSync(dbPath).size);

    logger.info('DB backup downloaded', { admin: req.admin.username, ip: req.ip });
    fs.createReadStream(dbPath).pipe(res);
  } catch (err) {
    logger.error('Backup error', { error: err.message });
    res.status(500).json({ error: 'Backup failed' });
  }
});

// ── AUDIT LOG ────────────────────────────────────────────────────

router.get('/audit', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ data: queries.getAuditLog(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

module.exports = router;
