'use strict';
/*
 * Seeds the portal with the survey material supplied with the project proposal:
 *   - General Plan 64-5/18 (Garryowen & Ardpatrick)            IMG-20260813-WA0016.jpg.jpeg
 *   - Diagram S.G. 200/76 (Garryowen Estate)                    IMG-20260813-WA0015.jpg.jpeg
 *   - Working Plan SR 51/2012 (Barkly 1-3)                      ACE Scanner_2026_05_06.pdf
 *   - Lodgement: Lot 1 of Lot 19 Block C, Christmas Gift        coordinate list, Helmert, area report
 *   - Lodgement: Lot 1 of Ardpatrick (GNSS RTK field book)      field book .xlsx/.txt, .dwg plans
 * Demo accounts all use the password Demo@2026.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, hashPassword, storeDocument } = require('./db');

const SOURCE_DIR = path.join(__dirname, '..');
const DEMO_PASSWORD = 'Demo@2026';

const MIME = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.dwg': 'application/acad', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
};

function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;

  const user = db.prepare(`INSERT INTO users (name, email, password_hash, role, reg_no, organisation, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const pw = hashPassword(DEMO_PASSWORD);
  const admin = Number(user.run('Registry Administrator', 'admin@dsg.gov.zw', pw, 'admin', null, 'Department of the Surveyor-General', 'active').lastInsertRowid);
  const examiner = Number(user.run('Examiner of Diagrams', 'examiner@dsg.gov.zw', pw, 'examiner', null, 'Department of the Surveyor-General, Electra House', 'active').lastInsertRowid);
  const surveyor = Number(user.run('Demo Land Surveyor', 'surveyor@demo.co.zw', pw, 'surveyor', 'LS-DEMO-01', 'Demo Survey Practice', 'active').lastInsertRowid);
  user.run('Demo Town Planner', 'planner@demo.co.zw', pw, 'planner', 'TP-DEMO-07', 'Demo Planning Consultants', 'pending');
  user.run('Demo Conveyancer', 'conveyancer@demo.co.zw', pw, 'conveyancer', 'CV-DEMO-03', 'Demo Legal Practitioners', 'active');

  const rec = db.prepare(`INSERT INTO records (ref_no, lodgement_no, record_type, title, property_name, district, province, office,
      surveyor, survey_date, approved_date, declared_area, coord_system, datum, related_refs, notes, status, lodged_by, lodged_at, examiner_id)
    VALUES (@ref_no, @lodgement_no, @record_type, @title, @property_name, @district, @province, @office,
      @surveyor, @survey_date, @approved_date, @declared_area, @coord_system, @datum, @related_refs, @notes, @status, @lodged_by, @lodged_at, @examiner_id)`);
  const base = {
    ref_no: null, lodgement_no: null, province: 'Midlands', office: null, surveyor: null, survey_date: null, approved_date: null,
    declared_area: null, coord_system: 'LO29', datum: null, related_refs: null, notes: null, lodged_by: null, lodged_at: null, examiner_id: null,
  };
  const addRecord = r => Number(rec.run({ ...base, ...r }).lastInsertRowid);

  const beacon = db.prepare(`INSERT INTO beacons (record_id, name, kind, y, x, z, description, locality, calc_page)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addBeacons = (recordId, kind, rows) => rows.forEach(([name, y, x, description = null, z = null, calc = null, locality = null]) =>
    beacon.run(recordId, name, kind, y, x, z, description, locality, calc));

  const parcel = db.prepare('INSERT INTO parcels (record_id, name, beacon_order, declared_m2) VALUES (?, ?, ?, ?)');
  const exam = db.prepare('INSERT INTO examinations (record_id, user_id, action, comment, created_at) VALUES (?, ?, ?, ?, ?)');

  const attach = (recordId, file, kind, userId = admin) => {
    const src = path.join(SOURCE_DIR, file);
    if (!fs.existsSync(src)) return;
    const ext = path.extname(file).toLowerCase();
    storeDocument({ recordId, filename: file, buffer: fs.readFileSync(src), mime: MIME[ext] || 'application/octet-stream', kind, userId });
  };

  // ---- National control network (trigonometrical beacons) ----
  addBeacons(null, 'trig', [
    ['49/T', -88454.47, 2146857.23, 'Trigonometrical beacon', null, null, 'Christmas Gift'],
    ['50/T', -88963.45, 2151238.71, 'Trigonometrical beacon', null, null, 'Thornhill'],
    ['190/T', -81678.11, 2148514.97, 'Trigonometrical beacon', null, null, 'Brooklands'],
    ['315/S', -86237.33, 2134816.50, 'Trigonometrical beacon', 1422.7, null, 'Travellers Rest'],
    ['316/S', -98841.11, 2137552.63, 'Trigonometrical beacon', 1387.9, null, null],
    ['592/S', -99047.69, 2124732.72, 'Trigonometrical beacon', 1322.1, null, null],
  ]);

  // ---- General Plan 64-5/18 ----
  const gp = addRecord({
    ref_no: 'GP 64-5/18', record_type: 'General Plan', status: 'approved',
    title: 'General Plan of Garryowen and Ardpatrick',
    property_name: 'Garryowen; Ardpatrick', district: 'Gwelo', office: 'Bulawayo',
    surveyor: 'Government Land Surveyor', approved_date: '1918-04',
    declared_area: 'Garryowen 1 567 Morgen 456 sq. roods; Ardpatrick 828 Morgen 563 sq. roods',
    coord_system: 'LEGACY', datum: 'Original plan system, Cape roods (scale 400 Cape roods = 1 inch)',
    notes: 'Numerical data examined and found sufficiently consistent by the Examiner of Diagrams. Adjoining: Sunbury, Barkly, Adair, Wodehouse, Native Reserve (Kwe Kwe River). Coordinates are as printed on the plan and are not placed on the index map.',
  });
  addBeacons(gp, 'found', [
    ['Lands', 20066.07, 10562.76], ['Alt', 21940.95, 10859.62], ['Hae', 21877.26, 10262.95],
    ['B.Small', 20771.54, 10014.46], ['Gami', 21874.73, 9767.27], ['Third', 21494.60, 8452.48],
  ]);
  attach(gp, 'IMG-20260813-WA0016.jpg.jpeg', 'Plan scan');

  // ---- Diagram S.G. 200/76 ----
  const sg = addRecord({
    ref_no: 'S.G. 200/76', record_type: 'Diagram', status: 'approved',
    title: 'Diagram of Garryowen Estate', property_name: 'Garryowen Estate', district: 'Gwelo',
    survey_date: '1976-03', approved_date: '1976', declared_area: '1 343,8769 ha',
    related_refs: 'S.R. 57/76; Compilation 1929 B2; Diagram 64/18; Diagram 1039/46',
    notes: 'Figure A B x middle of Kwe Kwe River y C D A. Comprises (1) AxDA Russophil of Garryowen, 210,7708 ha; (2) xBCyDx Remainder of Garryowen, 1 133,1061 ha. Beacons: A iron peg at base of iron fence post and cairn; B iron fence post and cairn; D pipe in cemented cairn over iron peg. Adjoining: Barkly, Rem. of Adair, Gokomere 8 and 9, Sunbury Estate, Ardpatrick, State Land. Office copy.',
  });
  attach(sg, 'IMG-20260813-WA0015.jpg.jpeg', 'Diagram scan');

  // ---- Working Plan SR 51/2012 ----
  const wp = addRecord({
    ref_no: 'SR 51/2012', record_type: 'Working Plan', status: 'approved',
    title: 'Working Plan of Barkly 1-3', property_name: 'Barkly 1-3', district: 'Gwelo',
    survey_date: '2012-03', approved_date: '2012-05-29', declared_area: null, related_refs: 'BBG 300',
    notes: 'Scale 1:50 000, with trig inset at 1:250 000. Beacons ONE, Lands, OB, ONW, OD and BRI. Control: 593/S Wegdraai, 320/S Lehingh, 315/S Travellers Rest, 424/T Connemara. Adjoining: Turfontein, State Land, Sunbury Estate, Garryowen Estate, Gokomere 9, Adair, Strathfillan Estate, Rem. of Bosch Kloof.',
  });
  attach(wp, 'ACE Scanner_2026_05_06.pdf', 'Plan scan');

  // ---- Lodgement: Lot 1 of Lot 19 Block C, Christmas Gift (under examination) ----
  const cg = addRecord({
    lodgement_no: 'L-2026-0001', record_type: 'Survey Record', status: 'under_examination',
    title: 'Survey of Lot 1 of Lot 19 Block C of Blocks ABC of Christmas Gift',
    property_name: 'Lot 1 of Lot 19 Block C of Blocks ABC of Christmas Gift', district: 'Gwelo',
    surveyor: 'Demo Land Surveyor', survey_date: '2026-05', declared_area: '2 952,027 m²',
    datum: 'Lo 29, constants Y −80 000,00  X +2 140 000,00; fixed by GNSS',
    notes: 'Old survey coordinates for 17A, 19C, 20C, 19A transformed to this survey by 1st-order Helmert (std. dev. 0,0409 m); 18A computed from the transformation (not beaconed) and 18Ax placed.',
    lodged_by: surveyor, lodged_at: '2026-09-08 09:14:00', examiner_id: examiner,
  });
  addBeacons(cg, 'station', [
    ['ST1', -86674.182, 2149466.681, '12mm iron peg', null, '3'], ['ST2', -86655.087, 2149479.712, '12mm iron peg', null, '3'],
    ['ST3', -86842.243, 2149275.313, '12mm iron peg', null, '3'], ['ST4', -86900.331, 2149346.603, '12mm iron peg', null, '3'],
    ['ST6', -86919.153, 2149372.853, '12mm iron peg', null, '3'], ['ST7', -86943.514, 2149349.475, '12mm iron peg', null, '3'],
    ['ST8', -86942.602, 2149315.136, '12mm iron peg', null, '3'],
  ]);
  addBeacons(cg, 'found', [
    ['17A', -87015.750, 2149369.349, '12mm iron peg in concrete', null, '101'],
    ['19A', -86913.832, 2149285.021, '12mm iron peg in concrete', null, '101'],
    ['19C', -86906.270, 2149398.054, '12mm iron peg in concrete', null, '101'],
    ['20C', -86855.305, 2149355.830, '12mm iron peg in concrete', null, '101'],
  ]);
  addBeacons(cg, 'placed', [
    ['S1', -86870.757, 2149368.657, '12mm iron peg in concrete', null, '101'],
    ['S2', -86884.749, 2149353.342, '12mm iron peg in concrete', null, '101'],
    ['S3', -86896.738, 2149357.739, '12mm iron peg in concrete', null, '101'],
    ['S4', -86904.488, 2149356.651, '12mm iron peg in concrete', null, '101'],
    ['S5', -86944.206, 2149310.161, '12mm iron peg in concrete', null, '101'],
    ['18Ax', -86964.483, 2149326.928, '12mm iron peg in concrete', null, '101'],
  ]);
  addBeacons(cg, 'computed', [['18A', -86964.806, 2149327.208, 'Not beaconed (Helmert transformation)', null, '101']]);
  parcel.run(cg, 'Lot 19', JSON.stringify(['19A', '18A', '19C', '20C']), 6080.397);
  parcel.run(cg, 'Lot 1 of Lot 19', JSON.stringify(['S5', '18A', '19C', 'S1', 'S2', 'S3', 'S4']), 2952.027);
  attach(cg, 'LOT 1 AREA.pdf', 'Area report', surveyor);
  attach(cg, 'Areas.docx', 'Area report', surveyor);
  attach(cg, 'Backup of COORDINATE LIST.wbk.doc', 'Coordinate list', surveyor);
  attach(cg, 'Backup of HELMERT.wbk.doc', 'Helmert transformation', surveyor);
  exam.run(cg, surveyor, 'lodged', 'Survey record lodged online.', '2026-09-08 09:14:00');
  exam.run(cg, examiner, 'started', 'Examination started.', '2026-09-10 11:02:00');

  // ---- Lodgement: Lot 1 of Ardpatrick (awaiting examination) ----
  const ar = addRecord({
    lodgement_no: 'L-2026-0002', record_type: 'Survey Record', status: 'lodged',
    title: 'Survey of Lot 1 of Ardpatrick', property_name: 'Lot 1 of Ardpatrick', district: 'Gwelo',
    surveyor: 'Demo Land Surveyor', survey_date: '2026-05-18',
    datum: 'WGS 84, Lo 29; GNSS RTK (Hi-Target V200 base and rover); plane conversion solved on 315/S, 316/S, 592/S',
    related_refs: 'GP 64-5/18; S.G. 200/76',
    notes: 'All points RTK fixed. Boundary beacons S1A to S1G placed (50mm iron pipe and cairn).',
    lodged_by: surveyor, lodged_at: '2026-09-18 15:40:00',
  });
  addBeacons(ar, 'station', [
    ['Z1', -94570.998, 2127075.041, '12mm iron peg', 1300.625, '101'],
    ['Z2', -90048.7245, 2130074.441, '12mm iron peg', 1348.4221, '101'],
    ['Z3', -93099.2528, 2127735.052, '12mm iron peg', 1309.4498, '101'],
    ['Z4', -93045.6987, 2127759.293, '12mm iron peg', 1310.0681, '101'],
  ]);
  addBeacons(ar, 'found', [
    ['B Small', -91247.6162, 2127169.131, 'Pipe in cemented cairn over iron peg', 1316.3267, '101'],
    ['Hae', -94870.4115, 2124887.506, 'Iron fence standard', 1270.1996, '101'],
    ['Lands', -88043.0927, 2126108.61, 'Iron rail fence post', 1308.8376, '101'],
    ['Third', -94530.1314, 2128242.868, '100mm iron fence post', 1300.0313, '101'],
  ]);
  addBeacons(ar, 'placed', [
    ['Third N', -94531.968, 2128256.628, '50mm iron pipe and cairn', 1999.997, '103'],
    ['Gami Nx', -95487.576, 2126656.889, '12mm iron peg and cairn', 1272.2845, '105'],
    ['S1A', -92937.7349, 2127728.748, '50mm iron pipe and cairn', 1309.8977, '105'],
    ['S1B', -93289.8284, 2127112.132, '50mm iron pipe and cairn', 1299.6577, '105'],
    ['S1C', -93439.414, 2127174.842, '50mm iron pipe and cairn', 1301.0043, '105'],
    ['S1D', -93538.219, 2127466.698, '50mm iron pipe and cairn', 1301.5709, '105'],
    ['S1E', -93356.758, 2127663.415, '50mm iron pipe and cairn', 1305.0669, '105'],
    ['S1F', -93035.321, 2127742.927, '50mm iron pipe and cairn', 1309.786, '105'],
    ['S1G', -93029.887, 2127759.266, '50mm iron pipe and cairn', 1309.9996, '105'],
  ]);
  parcel.run(ar, 'Lot 1 of Ardpatrick', JSON.stringify(['S1A', 'S1B', 'S1C', 'S1D', 'S1E', 'S1F', 'S1G']), null);
  attach(ar, 'Adpatrik Field Book.xlsx', 'Field book', surveyor);
  attach(ar, 'ardpatrick field book.txt', 'Field book', surveyor);
  attach(ar, 'Lot 1 Of Ardpatrick.dwg', 'Survey drawing', surveyor);
  attach(ar, 'Working Plan.dwg', 'Working plan drawing', surveyor);
  exam.run(ar, surveyor, 'lodged', 'Survey record lodged online.', '2026-09-18 15:40:00');

  return true;
}

module.exports = { seed, DEMO_PASSWORD };
