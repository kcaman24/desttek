const { validationResult, body, param } = require('express-validator');

function validate(rules) {
  return async (req, res, next) => {
    await Promise.all(rules.map(rule => rule.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        error: 'Validation failed',
        details: errors.array().map(e => ({ field: e.path, message: e.msg }))
      });
    }
    next();
  };
}

const rules = {
  categoryName: body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category name must be 1-100 characters')
    .escape(),

  recordName: body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Record name must be 1-200 characters')
    .escape(),

  fieldLabel: body('label')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Field label must be 1-100 characters')
    .escape(),

  fieldType: body('type')
    .isIn(['textarea', 'input'])
    .withMessage('Field type must be textarea or input'),

  fieldValue: body('value')
    .optional()
    .isLength({ max: 10000 })
    .withMessage('Field value too long (max 10000 chars)'),

  uuidParam: (name) => param(name)
    .trim()
    .isUUID()
    .withMessage(`${name} must be a valid UUID`),

  searchQuery: (req, res, next) => {
    const q = req.query.q;
    if (q && (typeof q !== 'string' || q.length > 200)) {
      return res.status(422).json({ error: 'Search query must be a string under 200 chars' });
    }
    next();
  },

  loginFields: [
    body('username').trim().isLength({ min: 1, max: 50 }).escape(),
    body('password').isLength({ min: 1, max: 200 }),
  ],
};

module.exports = { validate, rules };
