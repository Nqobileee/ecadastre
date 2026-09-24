/*
 * Survey computations for the Zimbabwe Lo system (Gauss conformal, south-oriented).
 * Y is positive west of the central meridian, X is positive south of the equator.
 * Directions are measured clockwise from south (the "Lo" convention used on SG diagrams).
 * Shared by the server (require) and the browser (window.Survey).
 */
(function (root) {
  'use strict';

  const RAD = Math.PI / 180;

  /** Parse numbers written as "-86 913,832", "+2 149 285.021", "−6 874.18". */
  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim().replace(/[−–]/g, '-').replace(/\s+/g, '');
    if (!s) return NaN;
    // A lone comma is a decimal separator; commas alongside a dot are thousands separators.
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return Number(s);
  }

  function norm360(d) { d %= 360; return d < 0 ? d + 360 : d; }

  /** Direction (degrees, from south, clockwise) and distance from point a to point b. */
  function join(a, b) {
    const dy = b.y - a.y, dx = b.x - a.x;
    return { direction: norm360(Math.atan2(dy, dx) / RAD), distance: Math.hypot(dy, dx), dy, dx };
  }

  /** "309:36:44.1" */
  function dms(deg, decimals = 1) {
    const sign = deg < 0 ? '-' : '';
    let d = Math.abs(deg);
    let D = Math.floor(d), M = Math.floor((d - D) * 60);
    let S = ((d - D) * 60 - M) * 60;
    S = Number(S.toFixed(decimals));
    if (S >= 60) { S -= 60; M += 1; }
    if (M >= 60) { M -= 60; D += 1; }
    return `${sign}${D}:${String(M).padStart(2, '0')}:${S.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`;
  }

  /** Signed shoelace area; absolute value is the parcel area in m². */
  function polygonArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.y * b.x - b.y * a.x;
    }
    return s / 2;
  }

  function perimeter(pts) {
    let p = 0;
    for (let i = 0; i < pts.length; i++) p += join(pts[i], pts[(i + 1) % pts.length]).distance;
    return p;
  }

  /**
   * Areas-from-coordinates report for a closed figure.
   * Returns the legs (direction/distance to each beacon), area and perimeter.
   */
  function figure(pts) {
    const legs = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length];
      return { from: p.name, to: next.name, ...join(p, next), y: next.y, x: next.x };
    });
    const area = Math.abs(polygonArea(pts));
    return { legs, area, perimeter: perimeter(pts), hectares: area / 10000 };
  }

  /**
   * Helmert (1st order, 4-parameter) transformation by least squares.
   *   TY = CY + A·y + B·x
   *   TX = CX + A·x − B·y
   * common: [{name, y, x, Y, X}] where y,x are the old survey and Y,X this survey.
   */
  function helmert(common) {
    const n = common.length;
    if (n < 2) throw new Error('At least two common points are required');
    const my = avg(common.map(p => p.y)), mx = avg(common.map(p => p.x));
    const mY = avg(common.map(p => p.Y)), mX = avg(common.map(p => p.X));
    let num1 = 0, num2 = 0, den = 0;
    for (const p of common) {
      const y = p.y - my, x = p.x - mx, Y = p.Y - mY, X = p.X - mX;
      num1 += y * Y + x * X;
      num2 += x * Y - y * X;
      den += y * y + x * x;
    }
    const A = num1 / den, B = num2 / den;
    const CY = mY - A * my - B * mx;
    const CX = mX - A * mx + B * my;
    const apply = (y, x) => ({ Y: CY + A * y + B * x, X: CX + A * x - B * y });
    let ss = 0;
    const residuals = common.map(p => {
      const t = apply(p.y, p.x);
      const dY = p.Y - t.Y, dX = p.X - t.X;
      ss += dY * dY + dX * dX;
      return { name: p.name, TY: t.Y, TX: t.X, dY, dX };
    });
    const dof = 2 * n - 4;
    return {
      CY, CX, A, B,
      scale: Math.hypot(A, B),
      swing: Math.atan2(B, A) / RAD,
      stdDev: dof > 0 ? Math.sqrt(ss / dof) : 0,
      meanShiftY: avg(common.map(p => p.Y - p.y)),
      meanShiftX: avg(common.map(p => p.X - p.x)),
      residuals,
      apply,
    };
  }

  function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

  /**
   * Lo system (WGS84, k0 = 1) to geographic coordinates, for placing parcels on a web map.
   * Easting = −Y, Northing = −X.
   */
  function loToLatLon(Y, X, lo = 29) {
    const a = 6378137, f = 1 / 298.257223563;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const E = -Y, N = -X;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M = N;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
      + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const s1 = Math.sin(phi1), c1 = Math.cos(phi1), t1 = Math.tan(phi1);
    const N1 = a / Math.sqrt(1 - e2 * s1 * s1);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * s1 * s1, 1.5);
    const C1 = ep2 * c1 * c1, T1 = t1 * t1;
    const D = E / N1;
    const lat = phi1 - (N1 * t1 / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c1;
    return { lat: lat / RAD, lon: lo + lon / RAD };
  }

  /**
   * Parse pasted coordinate lines: "NAME  Y  X  [description]  [F|P]".
   * Accepts tabs, commas (CSV) or runs of spaces. Returns {points, errors}.
   */
  function parseCoordinateText(text) {
    const points = [], errors = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      let parts = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(/\s{2,}|,(?=\s*[-+\d])/);
      if (parts.length < 3) parts = line.split(/\s+/);
      parts = parts.map(s => s.trim()).filter(Boolean);
      const [name, ys, xs, ...rest] = parts;
      const y = parseNum(ys), x = parseNum(xs);
      if (!name || !isFinite(y) || !isFinite(x)) {
        if (i === 0 && /name|beacon/i.test(line)) return; // header row
        errors.push(`Line ${i + 1}: could not read "${line}"`);
        return;
      }
      let fp = '';
      if (rest.length && /^[FP]$/i.test(rest[rest.length - 1])) fp = rest.pop().toUpperCase();
      points.push({ name, y, x, description: rest.join(' '), fp });
    });
    return { points, errors };
  }

  const Survey = { parseNum, join, dms, polygonArea, perimeter, figure, helmert, loToLatLon, parseCoordinateText };
  if (typeof module !== 'undefined' && module.exports) module.exports = Survey;
  else root.Survey = Survey;
})(typeof self !== 'undefined' ? self : this);
