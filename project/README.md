# e-Cadastre — Online Cadastral & Survey Records Portal

A web portal for the Department of the Surveyor-General (DSG), Zimbabwe, built from the project proposal
*Development of an Online Cadastral and Survey Data Management Portal*. It replaces the physical search
registers and paper lodgement at Electra House with remote search, online lodgement and electronic examination.

## Run it

Requires Node.js 22.13 or later (it uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:3000. The database is created and seeded on first start in `data/`.
`npm run reset` deletes it so the next start re-seeds.

Demo accounts (password `Demo@2026`):

| Role | Email |
| --- | --- |
| Land surveyor | surveyor@demo.co.zw |
| Examiner (DSG) | examiner@dsg.gov.zw |
| Conveyancer | conveyancer@demo.co.zw |
| Administrator (DSG) | admin@dsg.gov.zw |
| Town planner (awaiting verification) | planner@demo.co.zw |

## What it does

| Proposal objective | In the portal |
| --- | --- |
| Remote cadastral search and download | Search by SR number, property, district, related reference or beacon name. Download coordinate lists (CSV), area reports and scanned plans. |
| Secure database of survey records, diagrams and coordinates | SQLite relational schema: records, beacons, figures (parcels), documents, examination history, users, sessions, audit. |
| Online lodgement of new surveys | Surveyors submit property details, a coordinate list (paste or import), figures and supporting files. Areas, closures and duplicate beacons are checked live. |
| Electronic examination and approval | Examiners see the automatic checks, then start, return (with correction notes) or approve. Approval assigns the next SR number and the record becomes searchable. Returned lodgements can be corrected and resubmitted. |
| Security | scrypt password hashing, HttpOnly SameSite=Strict session cookies, CSRF header check, login throttling, role-based access, practitioner verification by the registry, CSP, and an audit log of every search, view and download. |

Other pages: an **index map** (parcels and trig beacons converted from Lo 29 to latitude/longitude over
OpenStreetMap), a **beacons & trigs** register, and **survey tools** (areas from coordinates, 4-parameter
Helmert transformation, join, Lo 29 → lat/lon).

## Seed data

Seeded from the documents supplied with the proposal:

- **GP 64-5/18**, General Plan of Garryowen and Ardpatrick (1918). Coordinates as printed, in plan units.
- **S.G. 200/76**, Diagram of Garryowen Estate (1976), with the scan.
- **SR 51/2012**, Working Plan of Barkly 1-3 (approved 29 May 2012), with the scanned PDF.
- **L-2026-0001**, Lot 1 of Lot 19 Block C of Blocks ABC of Christmas Gift: under examination. It has the full
  coordinate list, the Helmert-derived 18A, and the Lot 19 / Lot 1 figures with their area reports.
- **L-2026-0002**, Lot 1 of Ardpatrick: lodged. It has the GNSS RTK field book points, the S1A–S1G figure,
  and the field book and DWG files.
- Trig beacons 49/T, 50/T, 190/T, 315/S, 316/S and 592/S.

The survey computations were checked against the supplied sheets. The Helmert parameters match the printed
values exactly, and the computed areas agree with the area report to within 0.02 m². The area report used
unrounded coordinates.

## Structure

```
server/server.js   Express API (auth, records, lodgement, examination, map, admin)
server/db.js       Schema, password hashing, document storage, audit
server/seed.js     Seed data from the proposal documents
public/js/survey.js  Survey maths shared by server and browser
public/js/app.js     Single-page client
public/css/app.css   Styles
data/              SQLite database and uploaded files (created at runtime)
```
