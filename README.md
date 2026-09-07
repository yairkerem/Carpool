# הסעות — Carpool

A Hebrew PWA for parents sharing lifts. Somebody adds the events the children
need to get to — a training session, a class, a birthday party — and every
event has two legs, **הלוך** and **חזור**. Each parent taps once to put
themselves on a leg, and everyone sees the same board.

That is the whole app. No rota to maintain, no rotation to agree on, no
account to create: the thing that actually breaks a carpool is nobody knowing
who is bringing the children home at 18:15, and this puts that on one screen.

## What it does

- **Events, added by hand.** Title, date, time, place, return time, a note.
  Optionally repeated weekly, for a term's worth of training in one go.
- **The title sets the date.** Type *אימון יום שלישי* and the date jumps to the
  next Tuesday. Only `יום` + a day name counts, plus `שבת`, `היום`, `מחר` and
  `מחרתיים` — a bare `ראשון` or `שני` is far more often "first" or "second"
  than a weekday, and guessing wrong moves an event by days. It stops guessing
  the moment you set the date yourself.
- **A column per event, running along the page.** The soonest is on the right
  and later ones off to the left — the page is RTL, so time runs the way the
  reader does. Each column names the event and the day, and holds its two legs.
- **Two legs per event, always shown, never confusable.** *הלוך* and *חזור* get
  their own colour, their own icon and their own word: mixing them up is the
  mistake that strands a child, so no one signal carries it alone. A leg with
  no driver is ringed in amber, because a trip home nobody has claimed is
  exactly the one people forget.
- **Drivers stacked, one to a line**, under the leg they signed up for.
- **One tap to drive.** *אני אסיע* puts you on a leg; *לא אוכל* takes you off
  again. A leg holds **as many drivers as put themselves on it** — one car does
  not always fit the squad, and two parents splitting a run is an arrangement
  rather than a clash — so once somebody is on it the button reads *גם אני*.
  You can only ever remove yourself.
- **One tap to ask for a lift.** *צריכים טרמפ* puts you on the passenger list
  so the driver knows who to collect.
- **A phone number next to the driver**, so the parent waiting in the car park
  can call rather than open WhatsApp.
- **Share to WhatsApp**, because that is where the group already lives — the
  app writes the message, it does not try to replace the conversation.
- Works offline on the last loaded board, and installs to a home screen on
  both Android and iOS.

## How it is put together

**The app** is a PWA — `index.html`, `sw.js` and `manifest.webmanifest`,
served as static files. One page, vanilla JavaScript, no build step.

**The backend** is a Google Apps Script Web App with a Google Sheet behind it,
**one per carpool group**. It holds the shared secret and the board. Every
parent in the group points their phone at the same address, which is the point:
unlike a private family app, this one exists so that several households see and
edit the same thing.

The Sheet is deliberately plain — two tabs, `Events` and `Parents` — so anyone
who can open it can read the board or fix something the app will not let them
fix.

The script is **bound to that spreadsheet**, and [`appsscript.json`](appsscript.json)
pins its scope to `spreadsheets.currentonly`. So setting it up asks the owner
for access to one file, not to every spreadsheet in their account — which is
what a standalone script finding its sheet by ID would have to request. The
code only ever reaches the board through `SpreadsheetApp.getActive()`; an
`openById` anywhere would quietly widen that permission back out.

The nightly "nobody has claimed tomorrow" reminder needs two further
permissions — send mail as you, run while you are away — so it is a separate
optional file, [`carpool-reminder.gs`](carpool-reminder.gs), and those are
asked for at the moment you opt in.

## Running a group

See [SETUP.md](SETUP.md). One parent sets up the backend, once, and sends the
other parents a URL and a password.

## Versions

Three counters, and each proves a different thing:

- `BACKEND_VERSION` in `carpool-backend.gs` — which backend is actually
  deployed. Shown in settings.
- `APP_VERSION` in `index.html` — also shown in settings.
- `CACHE_VERSION` in `sw.js` — must move with `APP_VERSION`, or phones keep
  serving the old shell.
