# Moving the backend to a Cloudflare Worker

## Why

Apps Script's web-app hosting is not reliable enough for this app. Measured
against the live deployment on 2026-09-10, repeatedly:

| | script's own time | whole round trip |
|---|---|---|
| ping | 593 ms | 9.8 s |
| ping | 707 ms | 13.4 s |
| write | 1.9 s | 4.3 s |
| write | — | never answered (20 s) |

The script is the fast part. Nine to twelve seconds of a typical request, and
every failure, happen in the `POST → 302 → googleusercontent` hop that fronts
every Apps Script web app. Roughly one request in three does not complete.
Redeploying helps for a while and then it creeps back.

Four rounds of mitigation are already in — idempotent writes, retries budgeted
by failure cost, one request per save instead of four. They hide it; they do
not fix it, and "most attempts fail" on adding an event is past hiding.

A Worker answers these requests in tens of milliseconds, with no redirect hop
to lose.

## On hold — measuring first (2026-09-10)

Not started. The redeploy that preceded this fixed the *median* round trip and
not the failures: immediately afterwards one board load still timed out at 20s
and another took 10.3s. So "redeploy when it degrades" may buy less than it
appears to, and one bad afternoon is a thin basis for a rebuild that costs the
spreadsheet, the fifteen-minute setup story, and a file you own.

Two weeks of evidence first. The app counts what happens to the four things a
parent actually does — saving an event, saving group settings, claiming a leg,
joining — and shows the tally in settings under the version:

> מאז 10/09: 7 פעולות · 1 נשלחו שוב · 1 נכשלו · שרת עד 6.2ש

Read as: how many went through first time, how many needed another go, how many
gave up, and the slowest the server admitted to. Background refreshes are not
counted; a stale board is not a failure anyone notices.

**What decides it.** Failures that reach a parent *through* three retries mean
Apps Script is not good enough and this plan goes ahead. A tally of a hundred
actions with a handful of retries and no failures means the retries are doing
their job and the rebuild is not worth what it costs.

The rest of this document is the plan for if it goes ahead.

## The one rule that makes this safe

**The Worker speaks exactly the protocol the app already speaks.** Same request
envelope, same action names, same reply shapes. Then:

- the app changes by one string, not one screen;
- the Worker can be tested by replaying real requests against both backends and
  comparing the answers;
- rolling back is changing that string back.

Any temptation to improve the protocol on the way waits until after the move.

## Storage: D1

SQLite at the edge, read in single figures of milliseconds. Not KV: it is
eventually consistent, so a parent could claim a leg and not see it on the next
refresh — the one thing this app must never do.

Three tables, one column per field the sheet already has, so the port is a
transcription rather than a redesign.

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY,            -- the six-character code
  name TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL,
  drivers_wanted INTEGER,
  places TEXT NOT NULL DEFAULT '[]',   -- JSON array
  remind_at TEXT,                      -- 'HH:MM', the group's own
  reminded_on TEXT,                    -- 'YYYY-MM-DD', stops a second send
  created_at TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE parents (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  push TEXT NOT NULL DEFAULT '',       -- JSON subscription, per device
  admin INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX parents_by_group ON parents(group_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,            -- ten hex characters, made by the phone
  group_id TEXT NOT NULL REFERENCES groups(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  time TEXT NOT NULL DEFAULT '',
  back_time TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  to_driver TEXT NOT NULL DEFAULT '[]',
  back_driver TEXT NOT NULL DEFAULT '[]',
  to_riders TEXT NOT NULL DEFAULT '[]',
  back_riders TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_by_group_date ON events(group_id, date);
```

`LockService` has no equivalent and needs none: a claim becomes one
`UPDATE … WHERE id = ?` rather than read-modify-write, so two parents claiming
the same leg at once stop being a race at all.

## Steps

1. **Worker skeleton** — routing, the group/secret check, the removed-writer
   guard, `json()` with its `ms`. Nothing else. Deployed and answering `ping`.
2. **Port the actions** — `state`, `me`, `save`, `remove`, `claim`, `release`,
   `ride`, `kick`, `group`, `push`, `joined`, `newGroup`, and the four
   single-field settings actions kept for older phones.
3. **Copy the data** — a one-off script: `state` from Apps Script per group,
   plus the two secrets, written into D1. Read-only against the old backend.
4. **Compare, do not trust** — replay a scripted set of requests against both
   and diff the replies field by field. This is the step that decides whether
   the port is finished.
5. **Cut over without anyone re-typing anything**
   - ship an app release that understands `{ok:false, error:'moved', backend}`
     and rewrites its own stored address;
   - make the old Apps Script answer exactly that;
   - every phone migrates itself on its next refresh. The old deployment only
     has to answer once per phone, which it manages even at one-in-three.
6. **Fold in push** — the relay becomes part of the same Worker, and the
   evening reminder becomes a Cron Trigger. Cloudflare crons fire on the
   minute, so 19:00 stops meaning "somewhere before 20:00".
7. **Replace the sheet** — a small admin page over the same data: the board,
   the members, who is admin, and the few repairs that have actually been
   needed this season (move the admin flag, delete a stray duplicate parent).

## Care needed

- **Time zone.** Apps Script had `Asia/Jerusalem` configured; a Worker runs in
  UTC. Every date decision — what "today" is, what "tomorrow" is, when 19:00
  falls — goes through `Intl.DateTimeFormat` with an explicit zone, per group.
- **Secrets.** Group secrets live in D1 with their group. `HOST_SECRET`, the
  VAPID key and the relay secret become Worker secrets.
- **The `me` guard.** A removed parent may read and may not write. Same list of
  write actions, same behaviour.
- **Admin rules.** First parent to register is admin; an admin cannot remove
  themselves; only an admin changes group settings.
- **Idempotency stays.** Phone-generated event ids, absolute-value settings
  writes, and claims that are safe to repeat are all load-bearing for the
  retries the app already does.
- **Keep the versions moving.** `BACKEND_VERSION` goes on being reported, so
  settings still shows what a phone is actually talking to.

## Not doing

Improving the protocol, changing the data model, or touching the app's screens.
The move is worth nothing if it also breaks something that works.
