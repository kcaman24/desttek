const router = require('express').Router();
const { queries } = require('../db');
const { rules } = require('../middleware/validate');

// GET /api/categories — list all categories
router.get('/categories', (req, res) => {
  try {
    const categories = queries.getAllCategories();
    res.json({ data: categories });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/categories/:id/records — records for a category
router.get('/categories/:id/records', (req, res) => {
  try {
    const { id } = req.params;
    // Validate UUID format manually (no express-validator here to keep route light)
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });

    const category = queries.getCategoryById(id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const records = queries.getRecordsByCategory(id);
    res.json({ data: records, category });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

// GET /api/records/:id — single record with fields
router.get('/records/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid id' });

    const record = queries.getRecordById(id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const fields = queries.getFieldsByRecord(id);

    // Strip empty-value fields for public view if desired
    res.json({ data: { ...record, fields } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch record' });
  }
});

// GET /api/search?q=...
router.get('/search', rules.searchQuery, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ data: [] });

    const results = queries.searchRecords(q);
    res.json({ data: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
