/**
 * Carpool backend  —  Google Apps Script
 * Deploy as: Web app  |  Execute as: Me  |  Who has access: Anyone
 *
 * One deployment per carpool group. Everyone in the group points the app at
 * this one URL, so unlike a private family backend this one is deliberately
 * shared: the whole point is that the parents see the same board.
 *
 * THIS SCRIPT MUST LIVE INSIDE ITS SPREADSHEET — created from the sheet's own
 * Extensions > Apps Script, not as a standalone project. That is not a style
 * preference. A standalone script has to find its spreadsheet by ID, and
 * asking Google for the right to open a file by ID means asking for the right
 * to open *every* spreadsheet in the account. Bound to one sheet, with
 * oauthScopes pinned in the manifest (see appsscript.json in this repo), it
 * can ask for that single file and nothing else.
 *
 * Script Properties (Project Settings > Script properties):
 *   SHARED_SECRET   required — any long random string. Every request carries
 *                   it; without it the deployment answers nothing.
 *   GROUP_NAME      optional — shown in the app header, e.g. "כדורגל כיתה ג׳"
 *
 * The nightly "nobody has claimed tomorrow" reminder is deliberately NOT in
 * this file: it needs permission to send mail as you and to run while you are
 * away. It lives in carpool-reminder.gs, to be added only if you want it —
 * so those two permissions are asked for when you opt in, not before.
 */

const BACKEND_VERSION = 1;

const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Jerusalem';

/* Kept in one place because three different things need to agree on it: the
 * sheet header, the object the app receives, and the reminder mail. */
const EVENT_COLS = [
  'id', 'title', 'date', 'time', 'place', 'backTime', 'note',
  'toDriver', 'backDriver', 'toRiders', 'backRiders',
  'createdBy', 'updatedAt', 'deleted'
];

const PARENT_COLS = ['id', 'name', 'color', 'phone', 'email', 'updatedAt'];

/* An event is only interesting until the day it happens. Rows older than this
 * are still in the sheet — nothing is ever deleted behind anyone's back — they
 * are just not sent to the app, which keeps the payload small on a phone. */
const KEEP_PAST_DAYS = 2;

/* Two legs, and the app and the sheet must agree on their names. */
const LEGS = { to: 'toDriver', back: 'backDriver' };
const RIDERS = { to: 'toRiders', back: 'backRiders' };


// ---------- entry points ----------

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);

    if (!PROPS.getProperty('SHARED_SECRET')) {
      return json({ ok: false, error: 'no-secret-configured' });
    }
    if (req.secret !== PROPS.getProperty('SHARED_SECRET')) {
      return json({ ok: false, error: 'unauthorized' });
    }

    switch (req.action) {
      case 'ping':    return json(ping());
      case 'state':   return json(state());
      case 'me':      return json(saveParent(req.parent));
      case 'save':    return json(saveEvent(req.event));
      case 'remove':  return json(removeEvent(req.id));
      case 'claim':   return json(claim(req.id, req.leg, req.parentId));
      case 'release': return json(release(req.id, req.leg, req.parentId));
      case 'ride':    return json(setRider(req.id, req.leg, req.parentId, req.riding));
      default:        return json({ ok: false, error: 'unknown action: ' + req.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.stack || err) });
  }
}

/* Opening the /exec URL in a browser is how people check they pasted the right
 * address, so it answers with something readable rather than an error.
 *
 * It also reaches the spreadsheet, which is the one thing worth proving from a
 * browser: the narrow scope this script asks for only covers the sheet it is
 * bound to, and whether that binding survives into a web request is exactly
 * what a person setting this up cannot tell by reading. It reports reachable
 * or not, and never the sheet's name — this reply is not behind the secret. */
function doGet() {
  let board = 'unreachable';
  try {
    book().getName();
    board = 'ok';
  } catch (err) {
    board = 'unreachable (' + String(err.message || err) + ')';
  }
  return ContentService
    .createTextOutput('Carpool backend v' + BACKEND_VERSION +
      ' — alive. board: ' + board +
      '\nThe app talks to this address by POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ---------- the spreadsheet ----------

/* The store is a plain Google Sheet, so a parent who wants to see the raw
 * board — or fix something the app will not let them fix — can just open it.
 *
 * getActive(), never openById(). The two look interchangeable and are not:
 * openById needs the "all your spreadsheets" scope, getActive on a bound
 * script needs only the file it is bound to. Keeping to getActive is the
 * whole reason the permission screen asks for one file. */
function book() {
  const ss = SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error(
      'no bound spreadsheet — this script has to be created from inside the ' +
      'sheet (Extensions > Apps Script), not as a standalone project');
  }
  return ss;
}

/* Everything is stored as text. A date left to Sheets' own type comes back
 * from getValues() as a Date in the script's timezone, which is one DST bug
 * away from moving an event to the previous evening. */
function sheet(name, cols) {
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  }
  /* A sheet written by an older version of this file is missing the newer
     columns; add them rather than failing. */
  const width = sh.getLastColumn();
  if (width < cols.length) {
    sh.getRange(1, width + 1, 1, cols.length - width)
      .setValues([cols.slice(width)]).setFontWeight('bold');
    sh.getRange(1, width + 1, sh.getMaxRows(), cols.length - width).setNumberFormat('@');
  }
  return sh;
}

function readAll(sh, cols) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return rows
    .map((row, i) => {
      const obj = { _row: i + 2 };
      cols.forEach((c, n) => { obj[c] = row[n] === null ? '' : String(row[n]); });
      return obj;
    })
    .filter(o => o.id);
}

function writeRow(sh, cols, obj) {
  const values = cols.map(c => obj[c] === undefined || obj[c] === null ? '' : String(obj[c]));
  const row = obj._row || sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, cols.length).setValues([values]);
  return row;
}

/* Two parents tapping "I'll drive" on the same leg in the same second is the
 * one race this app really has, and it is not hypothetical — a reminder goes
 * out and everybody opens the app at once. Every write takes the lock, and
 * claim() re-reads inside it.
 *
 * Reentrant, so that a helper taking the lock inside another one that already
 * holds it waits for nothing instead of deadlocking against itself for twenty
 * seconds. The depth counter is safe because an Apps Script execution is
 * single-threaded: concurrency is between executions, and separate executions
 * do not share this variable. */
let lockDepth = 0;

function withLock(fn) {
  if (lockDepth > 0) return fn();          // this execution already holds it

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('busy — try again');
  lockDepth++;
  try {
    return fn();
  } finally {
    lockDepth--;
    lock.releaseLock();
  }
}

function uid() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function today() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function shiftDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y, m - 1, d + n, 12);
  return Utilities.formatDate(at, TZ, 'yyyy-MM-dd');
}


// ---------- actions ----------

function ping() {
  const ss = book();
  return {
    ok: true,
    version: BACKEND_VERSION,
    group: PROPS.getProperty('GROUP_NAME') || '',
    sheet: ss.getName(),
    sheetUrl: ss.getUrl()
  };
}

/* One round trip gets the app everything it draws. The board is small — a
 * class's worth of events for the next few weeks — so there is no paging and
 * no since-timestamp: simplicity beats cleverness at this size, and a full
 * state means a phone that has been offline for a week cannot end up with a
 * half-updated board. */
function state() {
  const from = shiftDays(today(), -KEEP_PAST_DAYS);

  const events = readAll(sheet('Events', EVENT_COLS), EVENT_COLS)
    .filter(e => e.deleted !== '1' && e.date >= from)
    .map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      place: e.place,
      backTime: e.backTime,
      note: e.note,
      toDriver: e.toDriver,
      backDriver: e.backDriver,
      toRiders: parseList(e.toRiders),
      backRiders: parseList(e.backRiders),
      createdBy: e.createdBy,
      updatedAt: e.updatedAt
    }))
    .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));

  const parents = readAll(sheet('Parents', PARENT_COLS), PARENT_COLS)
    .map(p => ({ id: p.id, name: p.name, color: p.color, phone: p.phone }));

  return {
    ok: true,
    version: BACKEND_VERSION,
    group: PROPS.getProperty('GROUP_NAME') || '',
    parents: parents,
    events: events,
    now: new Date().toISOString()
  };
}

function parseList(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(String) : [];
  } catch (err) {
    return [];
  }
}

/* Registering is the whole of signing in. A parent types their name once; the
 * id that comes back is what their phone stores and sends from then on. Names
 * are not unique and are not treated as such — two Michals in one class is
 * normal, and the colour is there to tell them apart. */
function saveParent(parent) {
  if (!parent || !String(parent.name || '').trim()) {
    return { ok: false, error: 'name required' };
  }
  return withLock(function () {
    const sh = sheet('Parents', PARENT_COLS);
    const all = readAll(sh, PARENT_COLS);
    const existing = parent.id && all.filter(p => p.id === parent.id)[0];

    const row = {
      _row: existing ? existing._row : 0,
      id: existing ? existing.id : uid(),
      name: String(parent.name).trim(),
      color: String(parent.color || ''),
      phone: String(parent.phone || ''),
      email: String(parent.email || (existing ? existing.email : '')),
      updatedAt: new Date().toISOString()
    };
    writeRow(sh, PARENT_COLS, row);
    return { ok: true, parent: { id: row.id, name: row.name, color: row.color, phone: row.phone } };
  });
}

/* Create or edit. The app sends the whole event either way — there is not
 * enough of one for a patch to be worth the ambiguity. Drivers and riders are
 * NOT taken from this payload: those move through claim/release/ride, so that
 * someone editing the time on a slow train cannot silently undo a claim made
 * while their screen was stale. */
function saveEvent(ev) {
  if (!ev || !String(ev.title || '').trim()) return { ok: false, error: 'title required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) return { ok: false, error: 'bad date' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const all = readAll(sh, EVENT_COLS);
    const existing = ev.id && all.filter(e => e.id === ev.id)[0];

    const row = {
      _row: existing ? existing._row : 0,
      id: existing ? existing.id : uid(),
      title: String(ev.title).trim(),
      date: ev.date,
      time: clean(ev.time),
      place: String(ev.place || '').trim(),
      backTime: clean(ev.backTime),
      note: String(ev.note || '').trim(),
      toDriver: existing ? existing.toDriver : '',
      backDriver: existing ? existing.backDriver : '',
      toRiders: existing ? existing.toRiders : '[]',
      backRiders: existing ? existing.backRiders : '[]',
      createdBy: existing ? existing.createdBy : String(ev.createdBy || ''),
      updatedAt: new Date().toISOString(),
      deleted: ''
    };
    writeRow(sh, EVENT_COLS, row);
    return { ok: true, id: row.id };
  });
}

function clean(t) {
  const s = String(t || '').trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? (s.length === 4 ? '0' + s : s) : '';
}

/* Marked, not erased. Someone deleting the wrong event on a phone should be
 * recoverable by whoever can open the sheet. */
function removeEvent(id) {
  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = readAll(sh, EVENT_COLS).filter(e => e.id === id)[0];
    if (!found) return { ok: false, error: 'not found' };
    found.deleted = '1';
    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

/* The one action the app exists for. Refusing rather than overwriting matters:
 * the loser of the race gets told who actually got it, and the app shows that
 * instead of pretending the tap worked. */
function claim(id, leg, parentId) {
  const col = LEGS[leg];
  if (!col) return { ok: false, error: 'bad leg' };
  if (!parentId) return { ok: false, error: 'no parent' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = readAll(sh, EVENT_COLS).filter(e => e.id === id && e.deleted !== '1')[0];
    if (!found) return { ok: false, error: 'not found' };

    if (found[col] && found[col] !== parentId) {
      return { ok: false, error: 'taken', driver: found[col] };
    }
    found[col] = parentId;

    /* A driver is in the car by definition, so they come off the passenger
       list — otherwise they show up twice in the row of who is riding. */
    const riders = parseList(found[RIDERS[leg]]).filter(p => p !== parentId);
    found[RIDERS[leg]] = JSON.stringify(riders);

    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

/* Only the driver can stand down, and only from their own leg — a parent
 * cannot un-assign somebody else. */
function release(id, leg, parentId) {
  const col = LEGS[leg];
  if (!col) return { ok: false, error: 'bad leg' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = readAll(sh, EVENT_COLS).filter(e => e.id === id && e.deleted !== '1')[0];
    if (!found) return { ok: false, error: 'not found' };
    if (found[col] !== parentId) return { ok: false, error: 'not yours', driver: found[col] };

    found[col] = '';
    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

/* "My child is riding on this leg." Separate from claiming, because the
 * common case is a parent who needs the lift rather than one offering it. */
function setRider(id, leg, parentId, riding) {
  const col = RIDERS[leg];
  if (!col) return { ok: false, error: 'bad leg' };
  if (!parentId) return { ok: false, error: 'no parent' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = readAll(sh, EVENT_COLS).filter(e => e.id === id && e.deleted !== '1')[0];
    if (!found) return { ok: false, error: 'not found' };

    const riders = parseList(found[col]).filter(p => p !== parentId);
    if (riding) riders.push(parentId);
    found[col] = JSON.stringify(riders);
    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

// ---------- run this from the editor before deploying ----------

/* Prints what is configured and proves the sheet can be reached, so the things
 * that actually go wrong at setup time fail here rather than on a parent's
 * phone. Touches nothing but the bound spreadsheet and the script's own
 * properties, which is why running it asks for one permission. */
function testSetup() {
  const out = [];
  const secret = PROPS.getProperty('SHARED_SECRET');
  out.push('SHARED_SECRET  ' + (secret
    ? (secret.length < 12 ? 'set, but short — make it longer' : 'set (' + secret.length + ' chars)')
    : 'MISSING — required, the app cannot connect without it'));
  out.push('GROUP_NAME     ' + (PROPS.getProperty('GROUP_NAME') || '(not set — optional)'));

  try {
    const ss = book();
    out.push('Spreadsheet    ' + ss.getName() + '  (bound — good)');
    out.push('               ' + ss.getUrl());
    const st = state();
    out.push('Parents        ' + st.parents.length);
    out.push('Events ahead   ' + st.events.length);
  } catch (err) {
    out.push('Spreadsheet    FAILED — ' + err);
    out.push('               If this says "no bound spreadsheet", the script was');
    out.push('               made standalone. Start again from the sheet itself:');
    out.push('               Extensions > Apps Script.');
  }

  out.push('Backend        v' + BACKEND_VERSION);

  const text = out.join('\n');
  Logger.log(text);
  return text;
}
