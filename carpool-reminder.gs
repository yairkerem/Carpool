/**
 * Carpool nightly reminder  —  OPTIONAL add-on to carpool-backend.gs
 *
 * A carpool fails quietly: nobody claimed tomorrow morning and nobody noticed.
 * This mails the parents once, in the evening, but only when tomorrow actually
 * has a leg with no driver — a reminder that arrives when there is nothing to
 * do is a reminder people stop opening.
 *
 * IT IS SEPARATE BECAUSE IT COSTS TWO PERMISSIONS. Adding this file makes
 * Google ask to send mail as you and to run the script while you are away.
 * The app does not need either. If you do not want the nightly mail, do not
 * add this file, and you are never asked.
 *
 * To turn it on
 *   1. In the Apps Script editor, add a file (+ next to Files) named
 *      `reminder`, and paste this in.
 *   2. Add the two scopes to appsscript.json's oauthScopes — the manifest
 *      pins the list, so a scope that is not named there is not granted and
 *      the script will fail at runtime rather than ask:
 *        "https://www.googleapis.com/auth/script.send_mail",
 *        "https://www.googleapis.com/auth/script.scriptapp"
 *   3. Put an address in the `email` column of the Parents sheet for anyone
 *      who should get it. Parents with no address are simply skipped.
 *   4. Run `installReminder` once, and accept the new permissions.
 *
 * `removeReminder` turns it off again. Deleting this file does not — the
 * trigger outlives it, so run removeReminder first.
 */

/* Roughly, not exactly: Apps Script fires a daily trigger somewhere inside the
 * hour. Evening rather than morning, so that whoever ends up driving finds out
 * the night before instead of at breakfast. */
const REMINDER_HOUR = 20;

function installReminder() {
  removeReminder();
  ScriptApp.newTrigger('dailyReminder')
    .timeBased().atHour(REMINDER_HOUR).everyDays(1).inTimezone(TZ).create();
  return 'Reminder installed for about ' + REMINDER_HOUR + ':00 daily.';
}

function removeReminder() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReminder')
    .forEach(t => ScriptApp.deleteTrigger(t));
  return 'Reminder removed.';
}

/* A trigger arrives with no request behind it, so there is no current group —
 * it has to walk them itself, and mail each one separately. A parent in two
 * groups would rather have two short mails they can act on than one long one
 * about children they are not driving. */
function dailyReminder() {
  migrate();
  allGroups().forEach(function (g) {
    CURRENT = g;
    try {
      remindGroup(g);
    } catch (err) {
      /* One group's bad address must not stop the next group's mail. */
      Logger.log('reminder failed for ' + g.id + ': ' + err);
    }
  });
  CURRENT = null;
}

function remindGroup(group) {
  const tomorrow = shiftDays(today(), 1);
  const due = state().events.filter(e => e.date === tomorrow);
  if (!due.length) return;

  /* .length, not truthiness: a leg's drivers are a list now, and an empty
     array is truthy — testing the list itself would report every unclaimed
     leg as covered and send nothing on exactly the night it matters. */
  const open = [];
  due.forEach(function (e) {
    if (!e.toDriver.length) open.push(e.title + ' — הלוך' + (e.time ? ' ' + e.time : ''));
    if (!e.backDriver.length) open.push(e.title + ' — חזור' + (e.backTime ? ' ' + e.backTime : ''));
  });
  if (!open.length) return;                 // every leg covered: say nothing

  const to = parents()
    .map(p => p.email).filter(a => a && a.indexOf('@') > 0);
  if (!to.length) return;

  /* bcc, not to: a class list is other people's addresses, and there is no
     reason for this mail to hand them all to everybody. */
  MailApp.sendEmail({
    bcc: to.join(','),
    subject: (group.name || 'Carpool') + ': אין נהג למחר',
    body: 'נסיעות מחר שעדיין אין להן נהג:\n\n' + open.join('\n') +
          '\n\nפתחו את האפליקציה כדי לשבץ את עצמכם.'
  });
}

/** Run this to check the mail before trusting it to a trigger. */
function testReminder() {
  migrate();
  const installed = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReminder').length;

  const out = [
    'Trigger        ' + (installed ? 'installed' : 'not installed — run installReminder'),
    'Quota left     ' + MailApp.getRemainingDailyQuota() + ' mails today'
  ];
  allGroups().forEach(function (g) {
    CURRENT = g;
    const all = parents();
    const reachable = all.filter(p => p.email && p.email.indexOf('@') > 0);
    out.push('  ' + g.id + '  ' + (g.name || '(unnamed)') +
      '   addresses: ' + reachable.length + ' of ' + all.length);
  });
  CURRENT = null;
  out.push('Sending now…');

  const text = out.join('\n');
  Logger.log(text);
  dailyReminder();
  return text;
}
