'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { db, STORAGE_DIR, hashPassword, verifyPassword, audit, storeDocument } = require('./db');
const { seed } = require('./seed');
const Survey = require('../public/js/survey.js');

seed();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

const PUBLIC_ROLES = ['surveyor', 'planner', 'conveyancer'];
const STAFF_ROLES = ['examiner', 'admin'];
const RECORD_TYPES = ['Survey Record', 'General Plan', 'Diagram', 'Working Plan', 'Compilation', 'Coordinate List'];
const BEACON_KINDS = ['station', 'found', 'placed', 'computed'];
const UPLOAD_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.dwg', '.dxf', '.xlsx', '.xls', '.csv', '.txt', '.doc', '.docx'];
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SESSION_HOURS = 8;

// ---------- security headers ----------
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://*.tile.openstreetmap.fr https://*.tile.opentopomap.org",
      "connect-src 'self' https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://*.tile.openstreetmap.fr https://*.tile.opentopomap.org",
      "frame-src 'self'", "object-src 'self'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.json({ limit: '60mb' }));

// ---------- sessions ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(c => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

app.use((req, res, next) => {
  const token = parseCookies(req).sid;
  if (token) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(tokenHash(token));
    if (row && row.status === 'active') req.user = row;
  }
  next();
});

// Mutating API calls must come from the portal's own scripts (CSRF defence alongside SameSite=Strict).
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Portal') !== '1') return res.status(403).json({ error: 'Forbidden' });
  next();
});

const ip = req => req.ip;
const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in' });
const requireRole = (...roles) => (req, res, next) =>
  !req.user ? res.status(401).json({ error: 'Please sign in' })
    : roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to this' });
const isStaff = u => u && STAFF_ROLES.includes(u.role);
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, reg_no: u.reg_no, organisation: u.organisation, status: u.status });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- auth ----------
const attempts = new Map();
function throttled(key) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const list = (attempts.get(key) || []).filter(t => now - t < win);
  attempts.set(key, list);
  return list.length >= 8;
}

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, reg_no, organisation, phone } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return bad(res, 'Name, email and password are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email address');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return bad(res, 'Password needs at least 8 characters including letters and numbers');
  if (!PUBLIC_ROLES.includes(role)) return bad(res, 'Choose your profession');
  if (!reg_no?.trim()) return bad(res, 'Your professional registration number is required for verification');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim())) return bad(res, 'An account with this email already exists', 409);
  const r = db.prepare(`INSERT INTO users (name, email, password_hash, role, reg_no, organisation, phone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`).run(name.trim(), email.trim(), hashPassword(password), role, reg_no.trim(), organisation?.trim() || null, phone?.trim() || null);
  audit(Number(r.lastInsertRowid), 'register', email.trim(), ip(req));
  res.status(201).json({ ok: true, message: 'Registration received. The Surveyor-General\'s registry will verify your registration number and activate your account.' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = `${ip(req)}|${String(email).toLowerCase()}`;
  if (throttled(key)) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    attempts.get(key).push(Date.now());
    audit(u?.id, 'login_failed', String(email || ''), ip(req));
    return bad(res, 'Incorrect email or password', 401);
  }
  if (u.status === 'pending') return bad(res, 'Your account is awaiting verification by the registry', 403);
  if (u.status === 'suspended') return bad(res, 'This account has been suspended', 403);
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`).run(tokenHash(token), u.id);
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
  audit(u.id, 'login', null, ip(req));
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) || null }));

// ---------- record helpers ----------
function canView(user, r) {
  if (!r) return false;
  if (r.status === 'approved') return true;
  return isStaff(user) || r.lodged_by === user.id;
}

function recordSummary(r) {
  return {
    id: r.id, ref_no: r.ref_no, lodgement_no: r.lodgement_no, record_type: r.record_type, title: r.title,
    property_name: r.property_name, district: r.district, status: r.status, approved_date: r.approved_date,
    survey_date: r.survey_date, declared_area: r.declared_area, lodged_at: r.lodged_at, updated_at: r.updated_at,
    beacon_count: r.beacon_count, doc_count: r.doc_count, lodged_by_name: r.lodged_by_name, match: r.match || null,
  };
}

/** Parcel figures plus the automatic consistency checks an examiner relies on. */
function analyse(record, beacons, parcels) {
  const byName = new Map(beacons.map(b => [b.name, b]));
  const checks = [];
  const dup = beacons.map(b => b.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) checks.push({ level: 'fail', text: `Duplicate beacon names: ${[...new Set(dup)].join(', ')}` });
  else if (beacons.length) checks.push({ level: 'pass', text: `${beacons.length} beacons, all uniquely named` });

  const figures = parcels.map(p => {
    const order = JSON.parse(p.beacon_order);
    const missing = order.filter(n => !byName.has(n));
    if (missing.length) {
      checks.push({ level: 'fail', text: `${p.name}: beacons not in coordinate list: ${missing.join(', ')}` });
      return { id: p.id, name: p.name, order, declared_m2: p.declared_m2, error: 'Missing beacons' };
    }
    const pts = order.map(n => byName.get(n));
    const f = Survey.figure(pts);
    let diff = null;
    if (p.declared_m2 != null) {
      diff = f.area - p.declared_m2;
      // Tolerance: 0.1 m² or 0.01% of the area, whichever is larger (rounding of published coordinates).
      const tol = Math.max(0.1, p.declared_m2 * 1e-4);
      checks.push({
        level: Math.abs(diff) <= tol ? 'pass' : 'warn',
        text: `${p.name}: computed ${fmtArea(f.area)} vs declared ${fmtArea(p.declared_m2)} (Δ ${diff >= 0 ? '+' : ''}${diff.toFixed(3)} m²)`,
      });
    } else {
      checks.push({ level: 'info', text: `${p.name}: computed area ${fmtArea(f.area)} (${f.hectares.toFixed(4)} ha); no declared area to compare` });
    }
    const shortLeg = f.legs.find(l => l.distance < 0.5);
    if (shortLeg) checks.push({ level: 'warn', text: `${p.name}: very short side ${shortLeg.from}–${shortLeg.to} (${shortLeg.distance.toFixed(3)} m)` });
    return { id: p.id, name: p.name, order, declared_m2: p.declared_m2, area: f.area, hectares: f.hectares, perimeter: f.perimeter, legs: f.legs, difference: diff };
  });
  if (record.coord_system === 'LO29' && beacons.length) {
    const odd = beacons.filter(b => Math.abs(b.y) > 400000 || b.x < 1600000 || b.x > 2600000);
    if (odd.length) checks.push({ level: 'warn', text: `Coordinates outside the expected Lo 29 range: ${odd.map(b => b.name).join(', ')}` });
    else checks.push({ level: 'pass', text: 'All coordinates fall within the Lo 29 zone for Zimbabwe' });
  }
  return { figures, checks };
}
const fmtArea = m2 => `${m2.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m²`;

function loadRecord(id) {
  return db.prepare('SELECT * FROM records WHERE id = ?').get(Number(id));
}

// ---------- records ----------
app.get('/api/records', requireUser, (req, res) => {
  const { q = '', type = '', district = '', status = '', scope = '' } = req.query;
  const where = [], params = [];
  if (scope === 'mine') { where.push('r.lodged_by = ?'); params.push(req.user.id); }
  else if (scope === 'queue') {
    if (!isStaff(req.user)) return bad(res, 'Examiners only', 403);
    where.push("r.status IN ('lodged','under_examination','returned')");
  } else if (!isStaff(req.user)) { where.push("(r.status = 'approved' OR r.lodged_by = ?)"); params.push(req.user.id); }
  if (type) { where.push('r.record_type = ?'); params.push(type); }
  if (district) { where.push('r.district = ?'); params.push(district); }
  if (status) { where.push('r.status = ?'); params.push(status); }
  const term = String(q).trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, m => '\\' + m)}%`;
    where.push(`(r.ref_no LIKE ?1 ESCAPE '\\' OR r.lodgement_no LIKE ?1 ESCAPE '\\' OR r.title LIKE ?1 ESCAPE '\\' OR r.property_name LIKE ?1 ESCAPE '\\'
      OR r.related_refs LIKE ?1 ESCAPE '\\' OR r.district LIKE ?1 ESCAPE '\\' OR r.notes LIKE ?1 ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM beacons b WHERE b.record_id = r.id AND b.name LIKE ?1 ESCAPE '\\'))`.replace(/\?1/g, '?'));
    for (let i = 0; i < 8; i++) params.push(like);
  }
  const rows = db.prepare(`SELECT r.*, u.name lodged_by_name,
      (SELECT COUNT(*) FROM beacons b WHERE b.record_id = r.id) beacon_count,
      (SELECT COUNT(*) FROM documents d WHERE d.record_id = r.id) doc_count
    FROM records r LEFT JOIN users u ON u.id = r.lodged_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(r.lodged_at, r.approved_date, r.created_at) DESC LIMIT 200`).all(...params);
  if (term) {
    const t = term.toLowerCase();
    for (const r of rows) {
      if (!(`${r.ref_no} ${r.lodgement_no} ${r.title} ${r.property_name}`.toLowerCase().includes(t))) {
        const b = db.prepare('SELECT name FROM beacons WHERE record_id = ? AND lower(name) LIKE ? LIMIT 1').get(r.id, `%${t}%`);
        r.match = b ? `Beacon ${b.name}` : 'Notes / references';
      }
    }
    audit(req.user.id, 'search', term.slice(0, 120), ip(req));
  }
  res.json({ records: rows.map(recordSummary) });
});

app.get('/api/records/:id', requireUser, (req, res) => {
  const r = loadRecord(req.params.id);
  if (!canView(req.user, r)) return bad(res, 'Record not found', 404);
  const beacons = db.prepare('SELECT * FROM beacons WHERE record_id = ? ORDER BY id').all(r.id);
  const parcels = db.prepare('SELECT * FROM parcels WHERE record_id = ? ORDER BY id').all(r.id);
  const documents = db.prepare('SELECT id, filename, mime, size, kind, sha256, uploaded_at FROM documents WHERE record_id = ? ORDER BY id').all(r.id);
  const history = db.prepare(`SELECT e.action, e.comment, e.created_at, u.name user_name, u.role user_role
    FROM examinations e LEFT JOIN users u ON u.id = e.user_id WHERE e.record_id = ? ORDER BY e.created_at, e.id`).all(r.id);
  const lodger = r.lodged_by ? db.prepare('SELECT name, organisation, reg_no FROM users WHERE id = ?').get(r.lodged_by) : null;
  const examiner = r.examiner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(r.examiner_id) : null;
  const { figures, checks } = analyse(r, beacons, parcels);
  const control = r.coord_system === 'LO29' && beacons.length ? nearbyControl(beacons) : [];
  audit(req.user.id, 'view_record', r.ref_no || r.lodgement_no, ip(req));
  res.json({
    record: r, beacons, figures, checks, documents, history, lodger, examiner: examiner?.name || null, control,
    can: {
      examine: isStaff(req.user) && r.status !== 'approved',
      resubmit: r.lodged_by === req.user.id && r.status === 'returned',
    },
  });
});

function nearbyControl(beacons) {
  const cy = beacons.reduce((s, b) => s + b.y, 0) / beacons.length, cx = beacons.reduce((s, b) => s + b.x, 0) / beacons.length;
  return db.prepare('SELECT * FROM beacons WHERE record_id IS NULL').all()
    .map(t => ({ ...t, distance: Math.hypot(t.y - cy, t.x - cx) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 4);
}

app.get('/api/records/:id/coordinates.csv', requireUser, (req, res) => {
  const r = loadRecord(req.params.id);
  if (!canView(req.user, r)) return bad(res, 'Record not found', 404);
  const rows = db.prepare('SELECT * FROM beacons WHERE record_id = ? ORDER BY id').all(r.id);
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [
    `# ${r.ref_no || r.lodgement_no} — ${r.title}`,
    `# District: ${r.district}; System: ${r.coord_system === 'LO29' ? 'Lo 29' : 'Legacy (as printed on plan)'}${r.datum ? '; ' + r.datum : ''}`,
    'Name,Type,Y,X,Z,Description,Calcs Page',
    ...rows.map(b => [b.name, b.kind, b.y.toFixed(3), b.x.toFixed(3), b.z ?? '', b.description, b.calc_page].map(esc).join(',')),
  ];
  audit(req.user.id, 'download_coordinates', r.ref_no || r.lodgement_no, ip(req));
  res.set('Content-Disposition', `attachment; filename="${safeName(r.ref_no || r.lodgement_no)}-coordinates.csv"`);
  res.type('text/csv').send('﻿' + lines.join('\r\n'));
});

app.get('/api/records/:id/area-report.txt', requireUser, (req, res) => {
  const r = loadRecord(req.params.id);
  if (!canView(req.user, r)) return bad(res, 'Record not found', 404);
  const beacons = db.prepare('SELECT * FROM beacons WHERE record_id = ?').all(r.id);
  const parcels = db.prepare('SELECT * FROM parcels WHERE record_id = ?').all(r.id);
  const { figures } = analyse(r, beacons, parcels);
  const byName = new Map(beacons.map(b => [b.name, b]));
  const n = (v, w, d = 3) => v.toFixed(d).padStart(w);
  const out = [
    `Areas from Co-ordinates — ${r.ref_no || r.lodgement_no}`,
    r.title, `District of ${r.district}`, '',
    '   Direction    Distance   Name             Y              X',
    '  ' + '-'.repeat(70),
  ];
  for (const f of figures.filter(f => !f.error)) {
    out.push('', `  Stand/Erf Number = ${f.name.toUpperCase()}`);
    const first = byName.get(f.order[0]);
    out.push(`                           ${f.order[0].padEnd(10)}${n(first.y, 14)}${n(first.x, 15)}`);
    for (const l of f.legs) out.push(`  ${Survey.dms(l.direction).padStart(12)}${n(l.distance, 11)}   ${l.to.padEnd(10)}${n(l.y, 14)}${n(l.x, 15)}`);
    out.push(`                                   Area (m²)  = ${n(f.area, 12)}`);
    if (f.declared_m2 != null) out.push(`                                   Declared   = ${n(f.declared_m2, 12)}`);
    out.push(`                                   Perimeter  = ${n(f.perimeter, 12)}`);
  }
  out.push('', `Generated by the Online Cadastral & Survey Records Portal on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  audit(req.user.id, 'download_area_report', r.ref_no || r.lodgement_no, ip(req));
  res.set('Content-Disposition', `attachment; filename="${safeName(r.ref_no || r.lodgement_no)}-areas.txt"`);
  res.type('text/plain; charset=utf-8').send(out.join('\r\n'));
});

const safeName = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

// ---------- documents ----------
function sendDocument(req, res, inline) {
  const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  const r = d && loadRecord(d.record_id);
  if (!d || !canView(req.user, r)) return bad(res, 'Document not found', 404);
  const file = path.join(STORAGE_DIR, path.basename(d.stored_name));
  if (!fs.existsSync(file)) return bad(res, 'File is missing from storage', 410);
  const viewable = /^(image\/(png|jpeg)|application\/pdf|text\/plain)$/.test(d.mime);
  audit(req.user.id, inline ? 'view_document' : 'download_document', `${r.ref_no || r.lodgement_no}: ${d.filename}`, ip(req));
  res.set('Content-Type', d.mime);
  res.set('Content-Disposition', `${inline && viewable ? 'inline' : 'attachment'}; filename="${safeName(d.filename)}"`);
  res.set('Cache-Control', 'private, no-store');
  fs.createReadStream(file).pipe(res);
}
app.get('/api/documents/:id/download', requireUser, (req, res) => sendDocument(req, res, false));
app.get('/api/documents/:id/view', requireUser, (req, res) => sendDocument(req, res, true));

// ---------- lodgement ----------
function validateLodgement(body) {
  const errors = [];
  const title = String(body.title || '').trim(), property = String(body.property_name || '').trim(), district = String(body.district || '').trim();
  if (!property) errors.push('Property description is required');
  if (!district) errors.push('District is required');
  const type = RECORD_TYPES.includes(body.record_type) ? body.record_type : 'Survey Record';
  const beacons = Array.isArray(body.beacons) ? body.beacons : [];
  const clean = [];
  beacons.forEach((b, i) => {
    const name = String(b.name || '').trim(), y = Survey.parseNum(b.y), x = Survey.parseNum(b.x);
    if (!name || !isFinite(y) || !isFinite(x)) return errors.push(`Coordinate row ${i + 1} is incomplete`);
    clean.push({ name: name.slice(0, 30), y, x, z: isFinite(Survey.parseNum(b.z)) ? Survey.parseNum(b.z) : null,
      kind: BEACON_KINDS.includes(b.kind) ? b.kind : 'placed', description: String(b.description || '').slice(0, 120) || null });
  });
  if (!clean.length) errors.push('Add at least one coordinate');
  const names = new Set(clean.map(b => b.name));
  const parcels = (Array.isArray(body.parcels) ? body.parcels : []).map((p, i) => {
    const order = (Array.isArray(p.order) ? p.order : String(p.order || '').split(/[\s,]+/)).map(s => String(s).trim()).filter(Boolean);
    const declared = p.declared_m2 === '' || p.declared_m2 == null ? null : Survey.parseNum(p.declared_m2);
    if (!String(p.name || '').trim()) errors.push(`Figure ${i + 1} needs a name`);
    if (order.length < 3) errors.push(`Figure ${i + 1} needs at least three beacons`);
    const missing = order.filter(n => !names.has(n));
    if (missing.length) errors.push(`Figure ${i + 1} uses beacons not in the coordinate list: ${missing.join(', ')}`);
    if (declared != null && !isFinite(declared)) errors.push(`Figure ${i + 1} declared area is not a number`);
    return { name: String(p.name || '').trim(), order, declared_m2: declared };
  });
  const files = (Array.isArray(body.files) ? body.files : []).map(f => {
    const ext = path.extname(String(f.name || '')).toLowerCase();
    if (!UPLOAD_EXT.includes(ext)) { errors.push(`${f.name}: file type not accepted`); return null; }
    const buffer = Buffer.from(String(f.data || ''), 'base64');
    if (!buffer.length) { errors.push(`${f.name}: file is empty`); return null; }
    if (buffer.length > MAX_FILE_BYTES) { errors.push(`${f.name}: larger than 15 MB`); return null; }
    return { name: path.basename(String(f.name)).slice(0, 150), buffer, mime: mimeFor(ext), kind: String(f.kind || '').slice(0, 40) || null };
  }).filter(Boolean);
  return {
    errors,
    record: {
      record_type: type, title: title || `Survey of ${property}`, property_name: property, district,
      province: String(body.province || '').trim() || null, survey_date: String(body.survey_date || '').trim() || null,
      declared_area: String(body.declared_area || '').trim() || null, datum: String(body.datum || '').trim() || null,
      related_refs: String(body.related_refs || '').trim() || null, notes: String(body.notes || '').trim() || null,
    },
    beacons: clean, parcels, files,
  };
}
function mimeFor(ext) {
  return ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.txt': 'text/plain', '.csv': 'text/csv', '.dwg': 'application/acad', '.dxf': 'application/dxf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })[ext] || 'application/octet-stream';
}

function writeLodgementParts(recordId, v, userId) {
  db.prepare("DELETE FROM beacons WHERE record_id = ?").run(recordId);
  db.prepare('DELETE FROM parcels WHERE record_id = ?').run(recordId);
  const ib = db.prepare('INSERT INTO beacons (record_id, name, kind, y, x, z, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const b of v.beacons) ib.run(recordId, b.name, b.kind, b.y, b.x, b.z, b.description);
  const ip_ = db.prepare('INSERT INTO parcels (record_id, name, beacon_order, declared_m2) VALUES (?, ?, ?, ?)');
  for (const p of v.parcels) ip_.run(recordId, p.name, JSON.stringify(p.order), p.declared_m2);
  for (const f of v.files) storeDocument({ recordId, filename: f.name, buffer: f.buffer, mime: f.mime, kind: f.kind, userId });
}

app.post('/api/lodgements', requireRole('surveyor'), (req, res) => {
  const v = validateLodgement(req.body || {});
  if (v.errors.length) return res.status(422).json({ error: 'Please fix the highlighted problems', details: v.errors });
  const year = new Date().getFullYear();
  db.exec('BEGIN');
  try {
    const seq = db.prepare("SELECT COUNT(*) n FROM records WHERE lodgement_no LIKE ?").get(`L-${year}-%`).n + 1;
    const lodgementNo = `L-${year}-${String(seq).padStart(4, '0')}`;
    const r = db.prepare(`INSERT INTO records (lodgement_no, record_type, title, property_name, district, province, surveyor, survey_date,
        declared_area, datum, related_refs, notes, status, lodged_by, lodged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lodged', ?, datetime('now'))`).run(
      lodgementNo, v.record.record_type, v.record.title, v.record.property_name, v.record.district, v.record.province, req.user.name,
      v.record.survey_date, v.record.declared_area, v.record.datum, v.record.related_refs, v.record.notes, req.user.id);
    const id = Number(r.lastInsertRowid);
    writeLodgementParts(id, v, req.user.id);
    db.prepare(`INSERT INTO examinations (record_id, user_id, action, comment) VALUES (?, ?, 'lodged', 'Survey record lodged online.')`).run(id, req.user.id);
    db.exec('COMMIT');
    audit(req.user.id, 'lodge', lodgementNo, ip(req));
    res.status(201).json({ id, lodgement_no: lodgementNo });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

app.put('/api/lodgements/:id', requireRole('surveyor'), (req, res) => {
  const r = loadRecord(req.params.id);
  if (!r || r.lodged_by !== req.user.id) return bad(res, 'Lodgement not found', 404);
  if (r.status !== 'returned') return bad(res, 'Only lodgements returned for correction can be resubmitted', 409);
  const v = validateLodgement(req.body || {});
  if (v.errors.length) return res.status(422).json({ error: 'Please fix the highlighted problems', details: v.errors });
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE records SET record_type=?, title=?, property_name=?, district=?, province=?, survey_date=?, declared_area=?, datum=?,
        related_refs=?, notes=?, status='lodged', updated_at=datetime('now') WHERE id=?`).run(
      v.record.record_type, v.record.title, v.record.property_name, v.record.district, v.record.province, v.record.survey_date,
      v.record.declared_area, v.record.datum, v.record.related_refs, v.record.notes, r.id);
    writeLodgementParts(r.id, v, req.user.id);
    db.prepare(`INSERT INTO examinations (record_id, user_id, action, comment) VALUES (?, ?, 'resubmitted', ?)`).run(r.id, req.user.id, String(req.body.comment || '').trim() || 'Corrections made and resubmitted.');
    db.exec('COMMIT');
    audit(req.user.id, 'resubmit', r.lodgement_no, ip(req));
    res.json({ id: r.id });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

// ---------- examination ----------
app.post('/api/records/:id/examine', requireRole(...STAFF_ROLES), (req, res) => {
  const r = loadRecord(req.params.id);
  if (!r) return bad(res, 'Record not found', 404);
  const { action } = req.body || {};
  const comment = String(req.body?.comment || '').trim().slice(0, 2000);
  if (r.status === 'approved') return bad(res, 'This record is already approved', 409);
  const log = (a, c) => db.prepare('INSERT INTO examinations (record_id, user_id, action, comment) VALUES (?, ?, ?, ?)').run(r.id, req.user.id, a, c || null);

  if (action === 'start') {
    db.prepare(`UPDATE records SET status='under_examination', examiner_id=?, updated_at=datetime('now') WHERE id=?`).run(req.user.id, r.id);
    log('started', comment || 'Examination started.');
  } else if (action === 'return') {
    if (!comment) return bad(res, 'Explain what the surveyor must correct');
    db.prepare(`UPDATE records SET status='returned', examiner_id=?, updated_at=datetime('now') WHERE id=?`).run(req.user.id, r.id);
    log('returned', comment);
  } else if (action === 'approve') {
    const year = new Date().getFullYear();
    let refNo = String(req.body.ref_no || '').trim();
    if (!refNo) {
      const nums = db.prepare("SELECT ref_no FROM records WHERE ref_no LIKE ?").all(`SR %/${year}`).map(x => parseInt(x.ref_no.slice(3), 10) || 0);
      refNo = `SR ${Math.max(0, ...nums) + 1}/${year}`;
    }
    if (db.prepare('SELECT 1 FROM records WHERE ref_no = ? AND id <> ?').get(refNo, r.id)) return bad(res, `${refNo} is already in use`, 409);
    db.prepare(`UPDATE records SET status='approved', ref_no=?, approved_date=date('now'), examiner_id=?, updated_at=datetime('now') WHERE id=?`).run(refNo, req.user.id, r.id);
    log('approved', comment || `Approved and registered as ${refNo}.`);
  } else if (action === 'comment') {
    if (!comment) return bad(res, 'Write a comment');
    log('comment', comment);
  } else return bad(res, 'Unknown action');
  audit(req.user.id, `examine_${action}`, r.lodgement_no || r.ref_no, ip(req));
  res.json({ ok: true });
});

// ---------- beacons & control ----------
app.get('/api/beacons', requireUser, (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let filter = '';
  if (q) { filter = "AND b.name LIKE ? ESCAPE '\\'"; params.push(`%${q.replace(/[%_]/g, m => '\\' + m)}%`); }
  const visible = isStaff(req.user) ? '1' : "(b.record_id IS NULL OR r.status = 'approved' OR r.lodged_by = ?)";
  if (!isStaff(req.user)) params.unshift(req.user.id);
  const rows = db.prepare(`SELECT b.*, r.ref_no, r.lodgement_no, r.title, r.coord_system, r.status
    FROM beacons b LEFT JOIN records r ON r.id = b.record_id
    WHERE ${visible} ${filter} ORDER BY (b.record_id IS NOT NULL), b.name LIMIT 300`).all(...params);
  res.json({ beacons: rows });
});

// ---------- tile proxy ----------
app.get('/api/tiles/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).send('Invalid tile parameters');
  }
  const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'eCadastrePortal/1.0 (Department of the Surveyor-General Zimbabwe; contact@ecadastre.gov.zw)'
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send('Tile load error');
    const arrayBuffer = await upstream.arrayBuffer();
    res.set({
      'Content-Type': upstream.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    res.status(500).send('Tile proxy request failed');
  }
});

// ---------- index map ----------
app.get('/api/map', requireUser, (req, res) => {
  const visible = isStaff(req.user) ? "r.coord_system='LO29'" : "r.coord_system='LO29' AND (r.status='approved' OR r.lodged_by = ?)";
  const recs = db.prepare(`SELECT r.* FROM records r WHERE ${visible}`).all(...(isStaff(req.user) ? [] : [req.user.id]));
  const toLL = b => { const p = Survey.loToLatLon(b.y, b.x); return [p.lat, p.lon]; };
  const features = recs.map(r => {
    const beacons = db.prepare('SELECT * FROM beacons WHERE record_id = ?').all(r.id);
    const byName = new Map(beacons.map(b => [b.name, b]));
    const parcels = db.prepare('SELECT * FROM parcels WHERE record_id = ?').all(r.id).map(p => {
      const order = JSON.parse(p.beacon_order);
      if (order.some(n => !byName.has(n))) return null;
      return { name: p.name, area: Math.abs(Survey.polygonArea(order.map(n => byName.get(n)))), ring: order.map(n => toLL(byName.get(n))) };
    }).filter(Boolean);
    return { id: r.id, ref: r.ref_no || r.lodgement_no, title: r.title, status: r.status, parcels,
      beacons: beacons.map(b => ({ name: b.name, kind: b.kind, ll: toLL(b) })) };
  }).filter(f => f.beacons.length);
  const trigs = db.prepare('SELECT * FROM beacons WHERE record_id IS NULL').all().map(t => ({ name: t.name, locality: t.locality, y: t.y, x: t.x, ll: toLL(t) }));
  res.json({ features, trigs });
});

// ---------- dashboard ----------
app.get('/api/stats', requireUser, (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  const stats = {
    approved: one("SELECT COUNT(*) n FROM records WHERE status='approved'"),
    beacons: one("SELECT COUNT(*) n FROM beacons b LEFT JOIN records r ON r.id=b.record_id WHERE b.record_id IS NULL OR r.status='approved'"),
    trigs: one('SELECT COUNT(*) n FROM beacons WHERE record_id IS NULL'),
    documents: one("SELECT COUNT(*) n FROM documents d JOIN records r ON r.id=d.record_id WHERE r.status='approved'"),
    queue: one("SELECT COUNT(*) n FROM records WHERE status IN ('lodged','under_examination')"),
    mine: one('SELECT COUNT(*) n FROM records WHERE lodged_by = ?', req.user.id),
    mineOpen: one("SELECT COUNT(*) n FROM records WHERE lodged_by = ? AND status <> 'approved'", req.user.id),
    returned: one("SELECT COUNT(*) n FROM records WHERE lodged_by = ? AND status='returned'", req.user.id),
    downloads30: one("SELECT COUNT(*) n FROM audit WHERE action LIKE 'download%' AND created_at > datetime('now','-30 days')"),
    pendingUsers: isStaff(req.user) ? one("SELECT COUNT(*) n FROM users WHERE status='pending'") : 0,
    byType: db.prepare("SELECT record_type, COUNT(*) n FROM records WHERE status='approved' GROUP BY record_type ORDER BY n DESC").all(),
  };
  const activity = db.prepare(`SELECT e.action, e.comment, e.created_at, u.name user_name, r.id record_id, COALESCE(r.ref_no, r.lodgement_no) ref, r.property_name
    FROM examinations e JOIN records r ON r.id=e.record_id LEFT JOIN users u ON u.id=e.user_id
    ${isStaff(req.user) ? '' : 'WHERE r.lodged_by = ?'} ORDER BY e.created_at DESC, e.id DESC LIMIT 8`).all(...(isStaff(req.user) ? [] : [req.user.id]));
  res.json({ stats, activity });
});

// ---------- administration ----------
app.get('/api/users', requireRole('admin'), (req, res) => {
  res.json({ users: db.prepare('SELECT id, name, email, role, reg_no, organisation, phone, status, created_at FROM users ORDER BY status = \'pending\' DESC, created_at DESC').all() });
});
app.patch('/api/users/:id', requireRole('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return bad(res, 'User not found', 404);
  if (u.id === req.user.id) return bad(res, 'You cannot change your own account here');
  const { status, role } = req.body || {};
  if (status && !['active', 'suspended', 'pending'].includes(status)) return bad(res, 'Invalid status');
  if (role && ![...PUBLIC_ROLES, ...STAFF_ROLES].includes(role)) return bad(res, 'Invalid role');
  db.prepare('UPDATE users SET status = COALESCE(?, status), role = COALESCE(?, role) WHERE id = ?').run(status || null, role || null, u.id);
  if (status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req.user.id, `user_${status || 'role_' + role}`, u.email, ip(req));
  res.json({ ok: true });
});
app.get('/api/audit', requireRole('admin'), (req, res) => {
  res.json({ entries: db.prepare(`SELECT a.*, u.name user_name, u.role user_role FROM audit a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 300`).all() });
});

app.get('/api/meta', (req, res) => {
  res.json({
    recordTypes: RECORD_TYPES,
    districts: db.prepare('SELECT DISTINCT district FROM records ORDER BY district').all().map(r => r.district),
    uploadTypes: UPLOAD_EXT,
  });
});

// ---------- static front end ----------
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'Upload is too large (60 MB total)', 413);
  console.error(err);
  bad(res, 'Something went wrong on the server', 500);
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Cadastral portal running at http://localhost:${PORT}`));
}
module.exports = app;
