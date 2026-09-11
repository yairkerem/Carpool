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
  Optionally repeated weekly until a date you give — a term's worth of training
  in one go, and one request rather than one per week.

  The weeks stay related. Each is its own event with its own drivers, but they
  share a series id, so one week can speak for the others. Saving asks whether
  the change is only that week or the rest of the term with it — a time that
  changed usually changed for all of them. Deleting asks at the moment the
  button is pressed, not before: this week, or the whole repeat, with the count
  on the button. A season called off is not twelve separate deletions.

  The date and the two times are plain text taking the same shorthand as the
  title — `16`, `1600` and `16:00` are all four o'clock; `15/09`, `15.9` and
  `1509` are all the fifteenth — and they read the same on every phone: a
  24-hour clock, and the day before the month.

  They have to be. The browser's own date and time controls lay themselves out
  in the browser's UI language, so a phone set to English shows `4:00 PM` in
  the one place a time is typed, and offers `09/15` on a board that prints
  `15/09` everywhere else. Nothing the page can set reaches them — not
  `lang="he"`, which they ignore, and not the phone's own 24-hour setting,
  which they never consult.

  A year is only worth typing for something more than six months out; leave it
  off and the nearest one is used, so `03/01` written in December is a fortnight
  away rather than eleven months back. Under the date the field names the day
  it landed on — *יום שלישי · 15/09* — which is the one thing the calendar
  picker was good for.
- **One line is enough.** Type the event the way you would say it in the group
  — *אימון כדורגל יום שלישי 16:30-18:15 במגרש הדשא* — and the day, both times
  and the place fill themselves in. Then they come out of the title, so the
  card reads *אימון כדורגל* rather than repeating itself three times. Every
  field below is optional; fill in as many or as few as you like.

  What it reads: `יום` + a day name, plus `שבת`, `היום`, `מחר`, `מחרתיים`; one
  or two times, the first being the way there; and a place — one of the group's
  saved places or anywhere it has met before, matched exactly, or a phrase
  starting at a venue word like `מגרש`, `אולם`, `בריכה`. `@` marks a place
  outright when the guessing gets it wrong.

  Times take any of `16:00`, `1600` and `16` for four o'clock, `16:30` or
  `1630` for half past, and `16-18`, `1600-1815` or `16:00 עד 18:15` for both
  legs at once. `בשעה 8` and `ב16` work too, word and all.

  `2030` is half past eight; `2026` stays the year it is. A bare 20xx is read
  as a time only when its minutes fall on a multiple of five, which is how
  people arrange to be collected and is not how years fall.

  A day named as a day is **never today**. Somebody who means today says
  `היום`; saying `יום רביעי` on a Wednesday is how people say next
  Wednesday, and reading it as this afternoon puts a training session on the
  board hours after it should have been claimed. When it lands on *tomorrow*
  both readings are ordinary — you might have said `מחר` — so the screen asks,
  offering the two dates side by side, rather than picking one and hoping.
  The same rule and the same question as the calendar app.

  Deliberately cautious, because a wrong guess is worse than none. A bare
  `ראשון` or `שני` is far more often "first" or "second" than a weekday, so
  only `יום` + name counts. `8.9.26` is a date; `טורניר 2026` is a year;
  `16 קבוצות` and `לגיל 12` are counts. Bare numbers are read as times only
  when the line holds no `HH:MM` at all, so `אימון 16:30 עם 12 ילדים` does not
  send twelve children home. And any field you set by hand stops being guessed
  at — just that one; the others carry on.
- **A column per event, running along the page.** The soonest is on the right
  and later ones off to the left — the page is RTL, so time runs the way the
  reader does. Each column names the event and the day, and holds its two legs.
  One of a weekly repeat says so, so four of the same training reads as one
  arrangement rather than as somebody having added it four times.
- **This week and next, and no further.** A repeat that runs to the end of term
  is twenty cards of something nobody has to think about yet, sitting between
  the parent and the reason they opened the app. The rest wait behind a column
  at the far end that says how many they are and shows them on one tap.
- **Two legs per event, always shown, never confusable.** *הלוך* and *חזור* get
  their own colour, their own icon and their own word: mixing them up is the
  mistake that strands a child, so no one signal carries it alone. A leg with
  no driver is ringed in amber, because a trip home nobody has claimed is
  exactly the one people forget.
- **Drivers stacked, one to a line**, under the leg they signed up for.
- **Finished events go grey and stay a week.** They keep their record of who
  drove but lose their buttons — there is nothing to volunteer for on a ride
  that has already happened — and carry a **⧉** that copies the event into a
  new one, dated to the next time that weekday comes round. That is why they
  are still there: so next Tuesday's training is one tap rather than retyping.
  After a week they stop being sent. The row stays in the spreadsheet; who
  drove whom is the only history this thing keeps.
- **One tap to drive.** *אני אסיע* puts you on a leg; *לא אוכל* takes you off
  again. A leg holds **as many drivers as put themselves on it** — one car does
  not always fit the squad, and two parents splitting a run is an arrangement
  rather than a clash — so once somebody is on it the button reads *גם אני*.
  You can only ever remove yourself.
- **Green once a leg has enough drivers** — how many is the group's own, set by
  its admin — with the word to go with the colour, so
  a board can be read for what still needs somebody rather than for what is
  already fine. Nobody is stopped from joining a full leg; it only changes how
  it looks.
- **A phone number next to the driver**, so the parent waiting in the car park
  can call rather than open WhatsApp.
- **Share to WhatsApp**, because that is where the group already lives — the
  app writes the message, it does not try to replace the conversation. An
  event goes out as who is driving which leg; a whole group goes out from
  settings as an invitation — the app's address, the group's code and its
  secret, which is everything a new parent has to type.

  The invitation is **one link**. Everything a phone needs to join — the
  backend's address, the group's code and its secret — rides in the URL's
  fragment, so tapping it opens the app with all three filled in and the parent
  types only their name. Nothing is copied, dictated or typed wrong.

  In the fragment (`#`) rather than the query string, because a fragment never
  leaves the browser: the secret reaches no server and no access log on the way,
  and the app strips it out of the address bar the moment it has read it. It is
  no more exposed in the message than the secret already was, and a good deal
  less exposed than sitting in a chat as a line somebody has to select.

  Tapping the link for a group the phone is already in switches to that board
  and says so, rather than offering to join it twice. A mangled link is simply
  not an invitation — the app opens as it always would.

  Settings still writes the code and the secret out, with copy buttons, for a
  parent who cannot use a link.
- **An admin, to keep the list honest.** The first parent to register is the
  admin — whoever set the group up, without being told to claim anything — and
  can remove a member from settings. Removing frees every future leg that
  parent had claimed, because a family that has left still showing as driving
  next Tuesday is worse than not removing them at all. Past rides are left
  exactly as they were: a record of who drove, not a plan that can go wrong.

  The admin also names the group, sets how many drivers a leg wants before it
  counts as sorted, and keeps the group's list of places.

  And they are told when somebody new joins — a line at the top of the board
  naming them, which stays until the admin opens settings and sees the list.
  Nobody else is told: for the rest of the group a new name is just a new name,
  but the admin is the one who answers for the list being right. It is worked
  out on the device from the board it already has, so it costs no column and no
  request, and a second phone joining an existing member says nothing, because
  no member arrived.

  Removing is housekeeping rather than a lock. Everyone in a group shares one
  secret, so a removed parent who kept it could register again under a new
  name. To shut somebody out properly, change that group's secret and give the
  new one to everybody else.
- **The places the group goes, saved once.** A carpool visits the same four or
  five venues all season, and typing one out every week is how a board ends up
  with three spellings of one pitch and a parent at the wrong gate. The admin
  writes them down in settings; everybody else gets them as buttons under the
  *איפה* field and taps one. The field stays free text underneath — the week
  the training moves somewhere else is exactly the week a closed list would be
  in the way — and the saved names feed the title parser too, so a venue is
  understood from a typed line before anyone has ever met there.
- **One entry, however many devices.** A second phone registering under a name
  the group already has is offered that member to continue as, so a laptop and
  a phone stay one person — and so two parents of a household can share one
  entry deliberately, by both using the name the board should show. Two parents
  who genuinely share a name can say so and get their own. Joining an existing
  member never overwrites it: the joining phone has never held that member's
  colour or number, and writing its blank form over the record would take the
  household's phone number off every ride they are down to drive.
- **Android's back button closes the screen, not the app.** Settings, the
  editor and the create-a-group screen each carry a history entry, so back
  goes up one exactly as the arrow in the corner does. At the board it is the
  phone's press again, which is what leaving an app should take.
- **Updates itself while nobody is looking.** A new build installs in the
  background and waits. If the app is on screen it offers itself as a bar,
  because reloading a page somebody is typing an event into would throw the
  event away; if the app is in a pocket, it is simply taken, and the next
  time it opens it is the new one. Not while an editor is open behind a
  hidden tab. It also asks every half hour rather than only on a page load,
  or an installed app that is never closed would serve the same version for
  weeks — which for a group app means parents on different ones.
- Works offline on the last loaded board, and installs to a home screen on
  both Android and iOS.

## How it is put together

**The app** is a PWA — `index.html`, `sw.js` and `manifest.webmanifest`,
served as static files. One page, vanilla JavaScript, no build step.

**The backend** is a Google Apps Script Web App with a Google Sheet behind it.
One deployment can hold **several groups** — each with its own code, secret,
board, members and admin, and none able to see another. A phone can belong to
as many as it likes and switches between them from the name at the top.

Every parent in a group points their phone at the same address, which is the
point: unlike a private family app, this one exists so that several households
see and edit the same thing.

The Sheet is deliberately plain — `Groups`, `Events` and `Parents` — so anyone
who can open it can read the board or fix something the app will not let them
fix. Separating one group from another is the `group` column and one rule: every
read goes through a helper that filters by the group the request authenticated
as, and nothing reads across that line.

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

## The guide for new parents

[**yairkerem.github.io/carpool-guide**](https://yairkerem.github.io/carpool-guide/)
— three steps to get in, how to read the board, how to put yourself down to
drive. In Hebrew, for a phone, written to be read once.

It is hosted from [its own repository](https://github.com/yairkerem/carpool-guide)
rather than beside the app, and that is not tidiness. The manifest claims this
whole path as the app's scope, so a page sitting next to it can be intercepted
twice over: an installed Android app captures links under its own scope, and
the service worker answers navigations within it. Either one turns a link to
the guide into the board — on exactly the phones most likely to forward it.
Outside the scope, neither can reach it.

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
