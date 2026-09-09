/**
 * Carpool backend  —  Google Apps Script
 * Deploy as: Web app  |  Execute as: Me  |  Who has access: Anyone
 *
 * One deployment, one or many carpool groups. Everyone in a group points the
 * app at this one URL and joins with a code and that group's secret, so unlike
 * a private family backend this one is deliberately shared: the whole point is
 * that the parents see the same board. Groups cannot see each other.
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
 *   SHARED_SECRET   the first group's secret. Required to set up; after that
 *                   each group carries its own in the Groups tab.
 *   GROUP_NAME      the first group's name.
 *   HOST_SECRET     optional — needed only to create further groups from the
 *                   app. Yours alone: it is what stops a stranger with this
 *                   URL filling your Drive with groups. Parents never see it.
 *
 * The nightly "nobody has claimed tomorrow" reminder is deliberately NOT in
 * this file: it needs permission to send mail as you and to run while you are
 * away. It lives in carpool-reminder.gs, to be added only if you want it —
 * so those two permissions are asked for when you opt in, not before.
 */

const BACKEND_VERSION = 17;

const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Jerusalem';

/* Kept in one place because three different things need to agree on it: the
 * sheet header, the object the app receives, and the reminder mail. */
const EVENT_COLS = [
  'id', 'title', 'date', 'time', 'place', 'backTime', 'note',
  'toDriver', 'backDriver', 'toRiders', 'backRiders',
  'createdBy', 'updatedAt', 'deleted', 'group'
];

/* `admin` and `removed` are appended rather than slotted in where they read
 * best. readAll maps by position, so this array has to match the physical
 * order of a sheet that already exists — insert a column in the middle and
 * every board written before today reads one field to the left. New columns
 * go on the end, always. */
const PARENT_COLS = ['id', 'name', 'color', 'phone', 'email', 'updatedAt',
                     'admin', 'removed', 'group', 'push'];

/* How long a finished event stays on the board. It is still shown for a week
 * after the fact — greyed out, and mostly so it can be copied into next week's
 * — and then it stops being sent.
 *
 * Stops being *sent*, not deleted: the row stays in the sheet. Who drove whom
 * is the one piece of history this thing accumulates, and throwing it away on
 * a timer to save a few kilobytes would be a poor trade. Clearing old rows, if
 * anyone ever wants to, is a job for whoever owns the spreadsheet. */
const KEEP_PAST_DAYS = 7;

/* Two legs, and the app and the sheet must agree on their names. */
const LEGS = { to: 'toDriver', back: 'backDriver' };
const RIDERS = { to: 'toRiders', back: 'backRiders' };

/* One deployment, several groups. Each has a code, which is public enough to
 * paste into a WhatsApp message, and a secret, which is not. Both the Events
 * and the Parents tab carry the code — appended at the end, like every column
 * added after the fact. */
const GROUP_COLS = ['id', 'name', 'secret', 'driversWanted', 'createdAt', 'removed',
                    'places', 'remindAt', 'remindedOn'];

/* The group this request is for, resolved once in doPost and read by
 * everything downstream rather than threaded through twenty signatures. Safe
 * for the same reason the lock counter is: an Apps Script execution is
 * single-threaded, and separate executions share nothing. */
let CURRENT = null;

/* Actions that change the board, and so are closed to a removed parent. */
const WRITES = ['me', 'save', 'remove', 'claim', 'release', 'ride', 'kick',
                'drivers', 'rename', 'places', 'push', 'remindat', 'joined'];

/* Ambiguous characters left out: a code gets read off one phone and typed into
 * another, and l/1 and O/0 are where that goes wrong. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function groupCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return s;
}

function allGroups() {
  return readAll(sheet('Groups', GROUP_COLS), GROUP_COLS).filter(g => g.removed !== '1');
}

/* The group that existed before groups did.
 *
 * A deployment that has been running has a board, parents and an admin, and
 * none of those rows know which group they belong to because there was only
 * ever one. The first time this version runs it makes that group real — taking
 * the name and secret it already had from Script Properties — and stamps every
 * existing row with its code.
 *
 * It gets an ordinary generated code, like any other group. Carving out a
 * special one would mean a special case in the request path forever, and a
 * name every deployment shares is a poor thing to have to keep unique. Run
 * testSetup afterwards to read the code off, and give it to the parents. */
function migrate() {
  const sh = sheet('Groups', GROUP_COLS);
  if (readAll(sh, GROUP_COLS).length) return;

  const secret = PROPS.getProperty('SHARED_SECRET');
  if (!secret) return;                       // nothing has been set up yet

  const id = groupCode();
  writeRow(sh, GROUP_COLS, {
    _row: 0,
    id: id,
    name: PROPS.getProperty('GROUP_NAME') || '',
    secret: secret,
    driversWanted: PROPS.getProperty('DRIVERS_WANTED') || '',
    createdAt: new Date().toISOString(),
    removed: '',
    places: ''
  });

  stampRows('', id);
}

/* Move every event and parent from one code to another. Used by migrate to
 * claim the rows that carry no code at all, and by recodeGroup below. */
function stampRows(from, to) {
  [['Events', EVENT_COLS], ['Parents', PARENT_COLS]].forEach(function (pair) {
    const tab = sheet(pair[0], pair[1]);
    readAll(tab, pair[1]).forEach(function (row) {
      if ((row.group || '') === from) {
        row.group = to;
        writeRow(tab, pair[1], row);
      }
    });
  });
}

/* Everything a maintenance function has to say, said in the one place anybody
 * looks. A function run from the editor that returns quietly down one of its
 * paths reads as a function that did nothing at all. */
function say_(msg) {
  Logger.log(msg);
  return msg;
}

/** Every group and its code. Run it from the editor whenever you need one. */
function listGroups() {
  migrate();
  const rows = allGroups();
  if (!rows.length) return say_('no groups yet');
  return say_('groups:\n' + rows.map(function (g) {
    return '  ' + g.id + '   ' + (g.name || '(unnamed)');
  }).join('\n'));
}

/* Give an existing group a fresh code — run from the editor, not from the app.
 *
 * There is one deployment in the world that has a group called "main", from
 * the version of this file that carved out that name before deciding not to.
 * This is how it stops being special. Everyone in the group re-enters the new
 * code once; nothing else about them changes.
 *
 * With one group, select it in the editor and press Run — the Run button
 * passes no argument, and one group needs none. With several, call it from
 * another function or the console: recodeGroup('oldcode')
 */
function recodeGroup(oldId) {
  return withLock(function () {
    const sh = sheet('Groups', GROUP_COLS);
    const rows = readAll(sh, GROUP_COLS);
    if (!rows.length) return say_('there are no groups to recode');

    /* The editor's Run button cannot pass an argument, and the editor is
       where this gets run. With a single group there is nothing to be
       ambiguous about, so no argument means that one. */
    const row = oldId
      ? rows.filter(g => g.id === oldId)[0]
      : (rows.length === 1 ? rows[0] : null);

    if (!row) {
      return say_(oldId
        ? 'no group has the code "' + oldId + '"'
        : ('this deployment has ' + rows.length + ' groups, so say which:\n' +
           rows.map(g => "    recodeGroup('" + g.id + "')   " + (g.name || '')).join('\n')));
    }

    const was = row.id;
    const taken = rows.map(g => g.id);
    let id = groupCode();
    while (taken.indexOf(id) >= 0) id = groupCode();

    row.id = id;
    writeRow(sh, GROUP_COLS, row);
    stampRows(was, id);

    return say_((row.name || was) + ':  ' + was + '  ->  ' + id +
      '\ngive that code to its parents. Their secret has not changed.');
  });
}

/* Making a group is the one thing a stranger with the URL must not be able to
 * do — this deployment runs on somebody's own Google account, and an open
 * endpoint for creating groups is an invitation to fill their Drive. So it
 * takes a second, separate secret that only the person hosting has. Parents
 * never see it: they are given a code and a group secret, which is all joining
 * needs. */
function newGroup(req) {
  const host = PROPS.getProperty('HOST_SECRET');
  if (!host) return { ok: false, error: 'no-host-secret' };
  if (req.hostSecret !== host) return { ok: false, error: 'unauthorized' };

  const name = String(req.name || '').trim();
  const secret = String(req.secret || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  if (secret.length < 8) return { ok: false, error: 'secret-too-short' };

  return withLock(function () {
    const sh = sheet('Groups', GROUP_COLS);
    const taken = readAll(sh, GROUP_COLS).map(g => g.id);
    let id = groupCode();
    while (taken.indexOf(id) >= 0) id = groupCode();

    writeRow(sh, GROUP_COLS, {
      _row: 0, id: id, name: name, secret: secret,
      driversWanted: '', createdAt: new Date().toISOString(), removed: '',
      places: ''
    });
    return { ok: true, group: id, name: name };
  });
}

/* How many drivers a leg wants before the app calls it sorted. A group sets
 * its own — a squad that needs three cars and a pair of siblings sharing one
 * lift are not the same problem — and this is the fallback for a group that
 * never has. Kept in a Script Property rather than a sheet: it is one number
 * for the whole group, and it belongs with the group's other settings. */
const DEFAULT_DRIVERS_WANTED = 2;
const MAX_DRIVERS_WANTED = 6;

function driversWanted() {
  const n = Math.round(Number(CURRENT && CURRENT.driversWanted));
  return (n >= 1 && n <= MAX_DRIVERS_WANTED) ? n : DEFAULT_DRIVERS_WANTED;
}

/* Renaming a group. The admin's to do, like everything else that changes what
 * the whole group sees — the host owns the deployment but is not necessarily
 * in this group at all, and would have no screen to do it from.
 *
 * Only the name moves. The code and the secret are what everybody has typed
 * into their phone, and quietly changing either would sign the group out. */
function setGroupName(name, byId) {
  return withLock(function () {
    const by = parents().filter(p => p.id === byId)[0];
    if (!by || by.admin !== '1' || by.removed === '1') return { ok: false, error: 'not-admin' };

    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return { ok: false, error: 'name required' };
    if (clean.length > 60) return { ok: false, error: 'name-too-long' };

    const sh = sheet('Groups', GROUP_COLS);
    const row = readAll(sh, GROUP_COLS).filter(g => g.id === CURRENT.id)[0];
    if (!row) return { ok: false, error: 'not found' };

    row.name = clean;
    writeRow(sh, GROUP_COLS, row);
    CURRENT = row;
    return { ok: true, group: clean };
  });
}

/* Where this group meets. A carpool goes to the same four or five places all
 * season, and typing "מגרש הדשא, כניסה מזרחית" correctly every week is how a
 * board ends up with three spellings of one venue and a parent at the wrong
 * gate. The admin writes them once; everybody else taps.
 *
 * It is a list on the group's own row rather than a sheet of its own: it is
 * five short strings that are always read together and always written whole,
 * and a tab per setting is a tab to keep in step forever. */
const MAX_PLACES = 30;
const MAX_PLACE_LEN = 60;

function groupPlaces() {
  return parseList(CURRENT && CURRENT.places);
}

function setPlaces(list, byId) {
  return withLock(function () {
    const by = parents().filter(p => p.id === byId)[0];
    if (!by || by.admin !== '1' || by.removed === '1') return { ok: false, error: 'not-admin' };

    /* Written whole every time, so the cleaning happens here rather than at
       each edge the app might add one from. */
    const clean = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      const name = String(raw === null || raw === undefined ? '' : raw)
        .trim().replace(/\s+/g, ' ').slice(0, MAX_PLACE_LEN);
      if (!name) return;
      /* Two spellings of one venue is the thing this feature exists to stop,
         so the list will not hold the same name twice. */
      if (clean.some(p => p.toLowerCase() === name.toLowerCase())) return;
      if (clean.length < MAX_PLACES) clean.push(name);
    });

    const sh = sheet('Groups', GROUP_COLS);
    const row = readAll(sh, GROUP_COLS).filter(g => g.id === CURRENT.id)[0];
    if (!row) return { ok: false, error: 'not found' };

    row.places = JSON.stringify(clean);
    writeRow(sh, GROUP_COLS, row);
    CURRENT = row;
    return { ok: true, places: clean };
  });
}

/* ---------- push ----------
 *
 * A web push needs a VAPID token signed with ECDSA P-256 and a payload
 * encrypted through an ECDH key agreement. Apps Script has neither — HMAC and
 * RSA are the whole of its crypto — so it cannot talk to a push service at
 * all. What it can do is decide who should be told and what, and hand that to
 * something that can: push-worker.js in this repo, a Cloudflare Worker whose
 * URL goes in the PUSH_RELAY script property.
 *
 * Subscriptions live in the Parents sheet beside the parent they belong to.
 * They are per device, not per person: a parent with a phone and a laptop has
 * whichever of the two pressed the button, and the last one wins. That is the
 * honest simple thing — one row, one place to send.
 */
const REMIND_HOUR_DEFAULT = 19;

function relay() {
  return {
    url: PROPS.getProperty('PUSH_RELAY') || '',
    secret: PROPS.getProperty('RELAY_SECRET') || ''
  };
}

/* This device's subscription, or null to stop being told. Not admin-gated:
 * being notified about your own rides is nobody else's decision. */
function setPush(meId, sub) {
  return withLock(function () {
    const sh = sheet('Parents', PARENT_COLS);
    const row = parents().filter(p => p.id === meId)[0];
    if (!row) return { ok: false, error: 'not found' };
    row.push = sub ? JSON.stringify(sub) : '';
    writeRow(sh, PARENT_COLS, row);
    return { ok: true, push: !!sub };
  });
}

/* When the evening reminder goes out. The admin's to set, like the rest of
 * what the whole group sees. */
function setRemindAt(at, byId) {
  return withLock(function () {
    const by = parents().filter(p => p.id === byId)[0];
    if (!by || by.admin !== '1' || by.removed === '1') return { ok: false, error: 'not-admin' };

    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(at || '').trim());
    if (!m && String(at || '').trim()) return { ok: false, error: 'bad-time' };

    const sh = sheet('Groups', GROUP_COLS);
    const row = readAll(sh, GROUP_COLS).filter(g => g.id === CURRENT.id)[0];
    if (!row) return { ok: false, error: 'not found' };
    row.remindAt = m ? (m[1].padStart(2, '0') + ':' + m[2]) : '';
    writeRow(sh, GROUP_COLS, row);
    CURRENT = row;
    return { ok: true, remindAt: remindAt() };
  });
}

function remindAt() {
  const raw = String((CURRENT && CURRENT.remindAt) || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)
    ? raw
    : (String(REMIND_HOUR_DEFAULT).padStart(2, '0') + ':00');
}

/* Hands a batch to the relay and clears out whatever it reports as gone.
 *
 * A subscription dies when a phone is reset or the app removed, and the push
 * service answers 404 or 410 for it forever after. Left in the sheet those
 * rows are sent to every evening for nothing. Anything else — a 500, a
 * timeout — is left alone: it may well work tomorrow. */
function pushSend(items) {
  const cfg = relay();
  if (!cfg.url || !cfg.secret || !items.length) return 0;

  let res;
  try {
    res = UrlFetchApp.fetch(cfg.url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        auth: cfg.secret,
        messages: items.map(i => ({
          subscription: i.sub, title: i.title, body: i.body, tag: i.tag, url: i.url
        }))
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('push relay unreachable: ' + err);
    return 0;
  }

  let out;
  try { out = JSON.parse(res.getContentText()); }
  catch (err) { Logger.log('push relay said: ' + res.getContentText()); return 0; }
  if (!out || !out.ok) { Logger.log('push relay refused: ' + res.getContentText()); return 0; }

  const results = out.results || [];
  let sent = 0;
  const dead = [];
  results.forEach(function (r, i) {
    if (r && r.status >= 200 && r.status < 300) sent++;
    else if (r && r.gone && items[i]) dead.push(items[i].parentId);
  });
  if (dead.length) forgetPush(dead);
  return sent;
}

function forgetPush(ids) {
  withLock(function () {
    const sh = sheet('Parents', PARENT_COLS);
    parents().filter(p => ids.indexOf(p.id) >= 0).forEach(function (p) {
      p.push = '';
      writeRow(sh, PARENT_COLS, p);
    });
    return true;
  });
}

/* Everyone in this group who can be reached, as {parentId, sub}. */
function pushTargets(ids) {
  const out = [];
  parents().forEach(function (p) {
    if (p.removed === '1' || !p.push) return;
    if (ids && ids.indexOf(p.id) < 0) return;
    try {
      const sub = JSON.parse(p.push);
      if (sub && sub.endpoint) out.push({ parentId: p.id, sub: sub });
    } catch (err) { /* a mangled cell is not worth failing a send over */ }
  });
  return out;
}

/* Somebody new has registered, and the admins are told.
 *
 * A SEPARATE REQUEST, not part of registering. Reaching the relay is a network
 * call inside a request somebody is waiting on, and if the relay is slow or
 * unreachable it holds registration open until the phone gives up — the parent
 * sees "the request took too long" for a registration that in fact succeeded.
 * Notifying is not allowed to gate joining. So the app registers, gets its
 * answer, and only then mentions it; if that second call never lands, nobody
 * is stopped from anything, and the admin is told by the board's own banner
 * the next time they look.
 *
 * Only for a row written in the last few minutes, so this cannot be replayed
 * later to make the admins' phones buzz. */
function announceJoin(meId) {
  const me = parents().filter(p => p.id === meId)[0];
  if (!me || me.removed === '1') return { ok: true, announced: false };

  const age = Date.now() - new Date(me.updatedAt || 0).getTime();
  if (!(age >= 0 && age < 10 * 60 * 1000)) return { ok: true, announced: false };

  notifyNewMember(me.name, me.id);
  return { ok: true, announced: true };
}

function notifyNewMember(name, newId) {
  const admins = parents()
    .filter(p => p.admin === '1' && p.removed !== '1' && p.id !== newId)
    .map(p => p.id);
  if (!admins.length) return;

  const items = pushTargets(admins).map(t => ({
    parentId: t.parentId, sub: t.sub,
    title: CURRENT.name || 'הסעות',
    body: name + ' נרשמ/ה לקבוצה.',
    tag: 'joined',
    url: './'
  }));
  pushSend(items);
}

/* ---------- the evening reminder ----------
 *
 * Runs hourly and sends a group's reminders once the group's own hour has
 * come round. Hourly rather than at a fixed time because each group sets its
 * own; `remindedOn` is what stops a second send when the trigger fires twice
 * inside one hour, which it is entitled to do.
 *
 * Apps Script fires a time trigger somewhere inside the hour, so this is an
 * evening's notice rather than an appointment. That is all it needs to be:
 * the point is that a parent finds out tonight rather than at breakfast. */
function pushReminders() {
  migrate();
  allGroups().forEach(function (g) {
    CURRENT = g;
    try {
      remindOneGroup(g);
    } catch (err) {
      Logger.log('reminder failed for ' + g.id + ': ' + err);
    }
  });
  CURRENT = null;
}

function remindOneGroup(group) {
  const today = todayStamp();
  if (group.remindedOn === today) return;                 // already done today
  if (nowMinutes() < timeToMinutes(remindAt())) return;   // not yet this evening

  const tomorrow = shiftDays(today(), 1);
  const due = state().events.filter(e => e.date === tomorrow);

  const byId = {};
  pushTargets(null).forEach(t => { byId[t.parentId] = t.sub; });

  /* One notification per parent for the whole evening, not one per leg.
   *
   * Driving both ways is the ordinary case, not the exception — the same
   * parent takes them and brings them back — and two buzzes a minute apart
   * saying nearly the same thing is how a reminder becomes something people
   * swipe away without reading. Two separate events tomorrow gather into the
   * one notice for the same reason. */
  const mine = {};
  due.forEach(function (e) {
    [['toDriver', 'הלוך', e.time], ['backDriver', 'חזור', e.backTime]].forEach(function (leg) {
      (e[leg[0]] || []).forEach(function (id) {
        if (!byId[id]) return;
        (mine[id] = mine[id] || []).push({
          title: e.title || 'נסיעה', which: leg[1], time: leg[2] || '', place: e.place || ''
        });
      });
    });
  });

  const items = Object.keys(mine).map(function (id) {
    /* By the leg's own clock, not by event: a return at 18:15 comes after
       another event's outward run at 17:00, whichever was typed first. An
       unfilled time sorts last — it is the one they will have to ask about. */
    const legs = mine[id].sort(function (a, b) {
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });

    let title, body;
    if (legs.length === 1) {
      const l = legs[0];
      title = l.title;
      body = 'מחר' + (l.time ? ' ב-' + l.time : '') + ' — אתם מסיעים ' + l.which +
             (l.place ? ', ' + l.place : '') + '.';
    } else if (legs.length === 2 && legs[0].title === legs[1].title) {
      /* Both ways of one event, which is most of them. Naming the event once
         and the two times after it reads the way a parent would say it. */
      title = legs[0].title;
      body = 'מחר — אתם מסיעים ' +
             legs.map(l => l.which + (l.time ? ' ב-' + l.time : '')).join(' וגם ') +
             (legs[0].place ? ', ' + legs[0].place : '') + '.';
    } else {
      title = group.name || 'הסעות';
      body = 'מחר יש לכם ' + legs.length + ' נסיעות:\n' +
             legs.map(l => '• ' + l.title + ' — ' + l.which +
                           (l.time ? ' ' + l.time : '')).join('\n');
    }

    /* One tag for the day, so a second send — a trigger that fired twice, a
       retry — replaces the notice rather than stacking beside it. */
    return { parentId: id, sub: byId[id], title: title, body: body,
             tag: 'rides-' + tomorrow, url: './' };
  });

  /* The stamp is written whether or not there was anything to send. Without
     it a quiet evening would be retried every hour until midnight. */
  const sh = sheet('Groups', GROUP_COLS);
  const row = readAll(sh, GROUP_COLS).filter(x => x.id === group.id)[0];
  if (row) { row.remindedOn = today; writeRow(sh, GROUP_COLS, row); }

  if (items.length) pushSend(items);
}

function todayStamp() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowMinutes() {
  return Number(Utilities.formatDate(new Date(), TZ, 'H')) * 60 +
         Number(Utilities.formatDate(new Date(), TZ, 'm'));
}
function timeToMinutes(hhmm) {
  const p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/** Run once from the editor to turn the evening reminder on. */
function installReminders() {
  removeReminders();
  ScriptApp.newTrigger('pushReminders').timeBased().everyHours(1).create();
  return say_('Evening reminders installed. Each group sends at its own time.');
}

/** ...and off again. Deleting the code does not remove the trigger. */
function removeReminders() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pushReminders')
    .forEach(t => ScriptApp.deleteTrigger(t));
  return say_('Evening reminders removed.');
}

/** Check the wiring without waiting for the evening: sends to every device in
 *  every group that has one. */
function testPush() {
  migrate();
  const cfg = relay();
  const out = ['Relay         ' + (cfg.url || 'NOT SET — add PUSH_RELAY'),
               'Relay secret  ' + (cfg.secret ? 'set' : 'NOT SET — add RELAY_SECRET'),
               'Trigger       ' + (ScriptApp.getProjectTriggers()
                 .filter(t => t.getHandlerFunction() === 'pushReminders').length
                   ? 'installed' : 'not installed — run installReminders')];
  allGroups().forEach(function (g) {
    CURRENT = g;
    const targets = pushTargets(null);
    out.push('  ' + g.id + '  ' + (g.name || '(unnamed)') + '   reminds at ' +
             remindAt() + ', devices subscribed: ' + targets.length);
    if (targets.length) {
      const sent = pushSend(targets.map(t => ({
        parentId: t.parentId, sub: t.sub,
        title: g.name || 'הסעות', body: 'בדיקה — ההתראות עובדות.',
        tag: 'test', url: './'
      })));
      out.push('     sent ' + sent + ' of ' + targets.length);
    }
  });
  CURRENT = null;
  return say_(out.join('\n'));
}

/* The admin's to set, like removing a member — it changes what the whole group
 * sees, so it is not everybody's to change. */
function setDriversWanted(n, byId) {
  return withLock(function () {
    const by = parents().filter(p => p.id === byId)[0];
    if (!by || by.admin !== '1' || by.removed === '1') return { ok: false, error: 'not-admin' };

    const v = Math.round(Number(n));
    if (!(v >= 1 && v <= MAX_DRIVERS_WANTED)) return { ok: false, error: 'out-of-range' };

    const sh = sheet('Groups', GROUP_COLS);
    const row = readAll(sh, GROUP_COLS).filter(g => g.id === CURRENT.id)[0];
    if (!row) return { ok: false, error: 'not found' };
    row.driversWanted = String(v);
    writeRow(sh, GROUP_COLS, row);
    CURRENT = row;
    return { ok: true, driversWanted: v };
  });
}


// ---------- entry points ----------

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);

    migrate();

    /* Creating a group is the only thing that happens outside a group, and it
       carries the host's secret rather than any group's. */
    if (req.action === 'newGroup') return json(newGroup(req));

    /* Every group is reached by its code, with no default and no exception —
       a request without one is simply not about any group this deployment
       has. An app old enough to send nothing gets the same answer as a wrong
       code, and its owner re-enters the code once. */
    const wanted = String(req.group || '').trim().toLowerCase();
    CURRENT = wanted ? (allGroups().filter(g => g.id === wanted)[0] || null) : null;

    /* One answer for a wrong code and a wrong secret, deliberately. Telling a
       stranger which of the two they got right turns the group list into
       something worth guessing at. */
    if (!CURRENT || CURRENT.secret !== req.secret) {
      return json({ ok: false, error: 'unauthorized' });
    }

    /* Somebody who has been removed can still read the board — they hold the
     * group's secret, and taking that back means changing it for everyone.
     * What they cannot do is write to it. This is bookkeeping, not a lock:
     * see the note above kickParent. */
    if (WRITES.indexOf(req.action) >= 0 && req.me && isRemoved(req.me)) {
      return json({ ok: false, error: 'removed' });
    }

    switch (req.action) {
      case 'ping':    return json(ping());
      case 'state':   return json(state());
      case 'me':     return json(saveParent(req.parent));
      case 'joined': return json(announceJoin(req.me));
      case 'save':    return json(saveEvent(req.event));
      case 'remove':  return json(removeEvent(req.id));
      case 'claim':   return json(claim(req.id, req.leg, req.parentId));
      case 'release': return json(release(req.id, req.leg, req.parentId));
      case 'ride':    return json(setRider(req.id, req.leg, req.parentId, req.riding));
      case 'kick':    return json(kickParent(req.id, req.by));
      case 'drivers': return json(setDriversWanted(req.n, req.by));
      case 'rename':  return json(setGroupName(req.name, req.by));
      case 'places':  return json(setPlaces(req.places, req.by));
      case 'push':    return json(setPush(req.me, req.sub));
      case 'remindat':return json(setRemindAt(req.at, req.by));
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
    group: CURRENT.name || '',
    groupId: CURRENT.id,
    driversWanted: driversWanted(),
    places: groupPlaces(),
    remindAt: remindAt(),
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

  const rows = events()
    .filter(e => e.deleted !== '1' && e.date >= from)
    .map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      place: e.place,
      backTime: e.backTime,
      note: e.note,
      toDriver: parseDrivers(e.toDriver),
      backDriver: parseDrivers(e.backDriver),
      toRiders: parseList(e.toRiders),
      backRiders: parseList(e.backRiders),
      createdBy: e.createdBy,
      updatedAt: e.updatedAt
    }))
    .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));

  ensureAdmin();

  /* Removed parents travel with the rest, flagged. The app hides them from the
     list of who is in the group, but still needs their name to caption a ride
     they drove last month — drop them here and the past fills up with "הורה". */
  const people = parents().map(p => ({
    id: p.id, name: p.name, color: p.color, phone: p.phone,
    admin: p.admin === '1', removed: p.removed === '1'
  }));

  return {
    ok: true,
    version: BACKEND_VERSION,
    group: CURRENT.name || '',
    groupId: CURRENT.id,
    driversWanted: driversWanted(),
    places: groupPlaces(),
    remindAt: remindAt(),
    parents: people,
    events: rows,
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

/* A leg can have several drivers — two cars for a squad, or one parent out and
 * another back. v1 stored a single id in this cell, so a value that is not a
 * JSON array is read as the one driver it used to mean. That keeps a board
 * written before this change from losing whoever was on it. */
function parseDrivers(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.charAt(0) === '[' ? parseList(s) : [s];
}

/* Every read below goes through one of these two, and both filter by the group
 * this request authenticated as. That is the whole of the separation between
 * one group's board and another's, so it is deliberately the only way in. */
function parents() {
  return readAll(sheet('Parents', PARENT_COLS), PARENT_COLS)
    .filter(p => p.group === CURRENT.id);
}

function events() {
  return readAll(sheet('Events', EVENT_COLS), EVENT_COLS)
    .filter(e => e.group === CURRENT.id);
}

/** One event of this group's, by id — never another group's, even given its id. */
function eventById(id, liveOnly) {
  return events().filter(e => e.id === id && (!liveOnly || e.deleted !== '1'))[0];
}

function isRemoved(id) {
  const p = parents().filter(x => x.id === id)[0];
  return !!(p && p.removed === '1');
}

/* Somebody has to be able to tidy the group up, and the obvious somebody is
 * whoever set it up — they own the script and the spreadsheet already. So the
 * first parent to register is the admin, and no one has to be told to claim
 * it. A board written before admins existed gets the same answer: its first
 * row is its first registrant.
 *
 * If that person ever leaves the group, the `admin` column in the Parents tab
 * is a plain 1 or blank, and the owner of the sheet can move it by hand. */
function ensureAdmin() {
  const all = parents().filter(p => p.removed !== '1');
  if (!all.length || all.some(p => p.admin === '1')) return;

  const first = all[0];                  // lowest row = earliest to register
  first.admin = '1';
  first.updatedAt = new Date().toISOString();
  writeRow(sheet('Parents', PARENT_COLS), PARENT_COLS, first);
}

/* Registering is the whole of signing in. A parent types their name once; the
 * id that comes back is what their phone stores and sends from then on. Names
 * are not unique and are not treated as such — two Michals in one class is
 * normal, and the colour is there to tell them apart. */
/* A name as it should be stored and compared.
 *
 * The invisible characters matter more here than anywhere else in the app.
 * Hebrew typed on a phone, and Hebrew pasted out of WhatsApp especially,
 * arrives carrying right-to-left and left-to-right marks — U+200F, U+200E,
 * U+061C — which are laid out but never drawn. Two names that are the same
 * name on screen, letter for letter, compare as different, and JavaScript's
 * \s does not match any of them.
 *
 * That is not a curiosity. It is a household typing its own name on the
 * second phone, being told nothing matched, and quietly becoming a second
 * member of its own group.
 *
 * NFC because the same Hebrew letter can arrive composed or decomposed
 * depending on the keyboard. ZWJ and ZWNJ are deliberately left alone: they
 * hold emoji sequences together, and a family in somebody's name is theirs. */
function cleanName(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFC')
    .replace(/[‎‏؜​﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameName(a, b) {
  /* Case-blind for the Latin names in a Hebrew group — "Cohen" and "cohen"
     are one household. Hebrew has no case, so this costs it nothing. */
  return cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
}

function saveParent(parent) {
  if (!parent || !String(parent.name || '').trim()) {
    return { ok: false, error: 'name required' };
  }
  return withLock(function () {
    const sh = sheet('Parents', PARENT_COLS);
    /* This group's members, not the deployment's. Unfiltered, a name already
       used in another carpool would block this one, an id could match a
       stranger's row, and -- worst of the three -- a brand new group's first
       member would not become its admin, because some other group already had
       one. */
    const all = parents();
    let existing = parent.id && all.filter(p => p.id === parent.id)[0];

    /* A second device taking over an identity that already exists, rather than
     * adding itself as another person. The app only sends this after the
     * parent has picked their own name off a list. */
    if (!existing && parent.claim) {
      existing = all.filter(p => p.id === parent.claim && p.removed !== '1')[0];
      if (!existing) return { ok: false, error: 'not found' };
    }

    /* A device with no id, registering under a name the group already has.
     * Answering this by quietly reusing the existing row would be wrong — two
     * Michals in one class is ordinary, and merging them would let one of them
     * cancel the other's rides. Answering it by making a second row is what
     * used to happen, and is how one parent with a phone and a laptop became
     * two members. So neither: hand the choice back and let them say. */
    if (!existing && !parent.force) {
      const same = all.filter(p => p.removed !== '1' && sameName(p.name, parent.name));
      if (same.length) {
        return {
          ok: false,
          error: 'name-taken',
          candidates: same.map(p => ({
            id: p.id, name: p.name, color: p.color, phone: p.phone,
            admin: p.admin === '1'
          }))
        };
      }
    }

    if (existing && existing.removed === '1') return { ok: false, error: 'removed' };

    /* The very first parent through the door is the admin. */
    const anyAdmin = all.some(p => p.admin === '1' && p.removed !== '1');

    /* A claim says "I am this member" — not "I am this member, and here are
     * new details for them". The joining device's form has never held this
     * member's colour or phone: it shows the first swatch and an empty phone
     * box, because it is a different phone. Writing that over the row would
     * change the chip the whole group recognises on the board, and an empty
     * phone box would quietly take the household's number off every ride they
     * are down to drive.
     *
     * So a claim attaches the device and leaves the record exactly as it is.
     * Either device can edit it afterwards from settings, deliberately. */
    const claiming = !!(parent.claim && existing);

    const row = {
      _row: existing ? existing._row : 0,
      id: existing ? existing.id : uid(),
      name: claiming ? existing.name : cleanName(parent.name),
      color: claiming ? existing.color : String(parent.color || ''),
      phone: claiming ? existing.phone : String(parent.phone || ''),
      email: String(parent.email || (existing ? existing.email : '')),
      updatedAt: new Date().toISOString(),
      admin: existing ? existing.admin : (anyAdmin ? '' : '1'),
      removed: '',
      group: CURRENT.id
    };
    writeRow(sh, PARENT_COLS, row);
    return {
      ok: true,
      /* Stripped off in doPost before the app sees it. The announcing is done
         out there rather than here, so the lock is not held open across a
         call to the relay. */
      isNew: !existing,
      parent: { id: row.id, name: row.name, color: row.color,
                phone: row.phone, admin: row.admin === '1' }
    };
  });
}

/* Taking somebody off every ride they had signed up for, from today forward.
 *
 * This is the part that matters. Marking a family as gone and leaving their
 * name on next Tuesday's return leg would be worse than not removing them at
 * all: the board would show a ride as covered by somebody who is no longer
 * coming, and nobody would look at it again until the children were waiting.
 *
 * The past is left exactly as it was. It is a record of who drove, not a plan
 * that can still go wrong. */
function releaseEverywhere(parentId) {
  const sh = sheet('Events', EVENT_COLS);
  const from = today();
  let freed = 0;

  events().forEach(function (e) {
    if (e.deleted === '1' || e.date < from) return;
    let touched = false;

    ['toDriver', 'backDriver'].forEach(function (col) {
      const list = parseDrivers(e[col]);
      if (list.indexOf(parentId) < 0) return;
      e[col] = JSON.stringify(list.filter(p => p !== parentId));
      touched = true;
      freed++;
    });
    ['toRiders', 'backRiders'].forEach(function (col) {
      const list = parseList(e[col]);
      if (list.indexOf(parentId) < 0) return;
      e[col] = JSON.stringify(list.filter(p => p !== parentId));
      touched = true;
    });

    if (touched) {
      e.updatedAt = new Date().toISOString();
      writeRow(sh, EVENT_COLS, e);
    }
  });
  return freed;
}

/* Removing a member is housekeeping, not a lock. Everyone in the group shares
 * one secret, so a removed parent who kept it could still register again under
 * a new name — what they cannot do is go on driving under the old one, and
 * their claims on future rides are handed back. To shut somebody out properly,
 * change SHARED_SECRET and give the new one to everybody else. */
function kickParent(targetId, byId) {
  return withLock(function () {
    const sh = sheet('Parents', PARENT_COLS);
    const all = parents();          // an admin here is not an admin elsewhere
    const by = all.filter(p => p.id === byId)[0];
    const target = all.filter(p => p.id === targetId)[0];

    if (!by || by.admin !== '1' || by.removed === '1') return { ok: false, error: 'not-admin' };
    if (!target) return { ok: false, error: 'not found' };
    if (target.id === by.id) return { ok: false, error: 'self' };
    if (target.removed === '1') return { ok: true, freed: 0 };

    target.removed = '1';
    target.admin = '';                    // no coming back as an admin
    target.updatedAt = new Date().toISOString();
    writeRow(sh, PARENT_COLS, target);

    return { ok: true, freed: releaseEverywhere(targetId), name: target.name };
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
    const existing = ev.id && eventById(ev.id, false);

    const row = {
      _row: existing ? existing._row : 0,
      id: existing ? existing.id : uid(),
      title: String(ev.title).trim(),
      date: ev.date,
      time: clean(ev.time),
      place: String(ev.place || '').trim(),
      backTime: clean(ev.backTime),
      note: String(ev.note || '').trim(),
      toDriver: existing ? existing.toDriver : '[]',
      backDriver: existing ? existing.backDriver : '[]',
      toRiders: existing ? existing.toRiders : '[]',
      backRiders: existing ? existing.backRiders : '[]',
      createdBy: existing ? existing.createdBy : String(ev.createdBy || ''),
      updatedAt: new Date().toISOString(),
      deleted: '',
      group: CURRENT.id
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
    const found = eventById(id, false);
    if (!found) return { ok: false, error: 'not found' };
    found.deleted = '1';
    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

/* The one action the app exists for. Adding, not taking: a leg holds as many
 * drivers as put themselves on it, because one car does not always fit the
 * squad and two parents splitting a run is a normal arrangement rather than a
 * conflict. Nobody is ever refused, and nobody displaces anybody.
 *
 * Still under the lock. Two parents tapping in the same second are appending
 * to the same cell, and without it one of the two writes is simply lost. */
function claim(id, leg, parentId) {
  const col = LEGS[leg];
  if (!col) return { ok: false, error: 'bad leg' };
  if (!parentId) return { ok: false, error: 'no parent' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = eventById(id, true);
    if (!found) return { ok: false, error: 'not found' };

    const drivers = parseDrivers(found[col]);
    if (drivers.indexOf(parentId) < 0) drivers.push(parentId);
    found[col] = JSON.stringify(drivers);

    /* A driver is in the car by definition, so they come off the passenger
       list — otherwise they show up twice in the row of who is riding. */
    const riders = parseList(found[RIDERS[leg]]).filter(p => p !== parentId);
    found[RIDERS[leg]] = JSON.stringify(riders);

    found.updatedAt = new Date().toISOString();
    writeRow(sh, EVENT_COLS, found);
    return { ok: true };
  });
}

/* Standing down removes you and only you. There is no call for taking someone
 * else off a leg, and a filter by id means the app cannot ask for it. */
function release(id, leg, parentId) {
  const col = LEGS[leg];
  if (!col) return { ok: false, error: 'bad leg' };
  if (!parentId) return { ok: false, error: 'no parent' };

  return withLock(function () {
    const sh = sheet('Events', EVENT_COLS);
    const found = eventById(id, true);
    if (!found) return { ok: false, error: 'not found' };

    found[col] = JSON.stringify(parseDrivers(found[col]).filter(p => p !== parentId));
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
    const found = eventById(id, true);
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

  out.push('HOST_SECRET    ' + (PROPS.getProperty('HOST_SECRET')
    ? 'set — you can create further groups from the app'
    : '(not set — this deployment hosts one group only)'));

  try {
    const ss = book();
    out.push('Spreadsheet    ' + ss.getName() + '  (bound — good)');
    out.push('               ' + ss.getUrl());

    migrate();
    const list = allGroups();
    out.push('Groups         ' + list.length);

    /* Reported one group at a time, because that is how everything else in
       here works: nothing reads across a group boundary, testSetup included. */
    list.forEach(function (g) {
      CURRENT = g;
      const st = state();
      const active = st.parents.filter(p => !p.removed);
      const admins = active.filter(p => p.admin).map(p => p.name);
      out.push('  ' + g.id + '  ' + (g.name || '(unnamed)'));
      out.push('      parents  ' + active.length +
        (st.parents.length > active.length
          ? ' (+' + (st.parents.length - active.length) + ' removed)' : '') +
        '   admin: ' + (admins.length ? admins.join(', ') : 'none yet'));
      out.push('      events   ' + st.events.length +
        '   drivers wanted: ' + driversWanted() + ' per leg');
    });
    CURRENT = null;
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
