/**
 * Minimal inline validation — no external deps.
 *
 * Usage:
 *   const errors = validate(body, {
 *     email:    [required(), isEmail()],
 *     password: [required(), minLength(8)],
 *     role:     [oneOf(["admin", "manager", "member"])]
 *   });
 *   if (errors) return res.status(400).json({ ok: false, error: errors[0], errors });
 */

function required() {
  return (value, field) =>
    value === undefined || value === null || String(value).trim() === ""
      ? `${field} est requis.`
      : null;
}

function isEmail() {
  return (value, field) =>
    value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
      ? `${field} n'est pas une adresse email valide.`
      : null;
}

function minLength(min) {
  return (value, field) =>
    value && String(value).length < min
      ? `${field} doit contenir au moins ${min} caracteres.`
      : null;
}

function maxLength(max) {
  return (value, field) =>
    value && String(value).length > max
      ? `${field} ne doit pas depasser ${max} caracteres.`
      : null;
}

function oneOf(allowed) {
  return (value, field) =>
    value !== undefined && !allowed.includes(value)
      ? `${field} doit etre l'une des valeurs suivantes: ${allowed.join(", ")}.`
      : null;
}

/**
 * Run rules against body fields.
 * @param {object} body
 * @param {Record<string, Function[]>} rules
 * @returns {string[]|null} Array of error messages, or null if valid
 */
function validate(body, rules) {
  const errors = [];
  for (const [field, fieldRules] of Object.entries(rules)) {
    for (const rule of fieldRules) {
      const err = rule(body[field], field);
      if (err) errors.push(err);
    }
  }
  return errors.length ? errors : null;
}

module.exports = { validate, required, isEmail, minLength, maxLength, oneOf };
