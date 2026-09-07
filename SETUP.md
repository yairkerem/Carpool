# Setting up a carpool group

One parent does this once. Everybody else just gets a link and a password.

Roughly fifteen minutes, most of it waiting for Google's permission screens.

## What you need

- A Google account. That is all — there is no API key and nothing to pay for.

The board is a spreadsheet in your Drive, and the script that serves it runs as
you. Every other parent reaches it only through the app.

## A note on the one permission it asks for

The script is created **from inside the spreadsheet**, not as a standalone
project, and its manifest pins the scope to `spreadsheets.currentonly`. That
combination is what makes Google ask for access to *that one spreadsheet*
rather than to every spreadsheet in your account — which is what a standalone
script would have to ask for, because it would need to find its sheet by ID.

So step 1 below is not a matter of taste. Build it the other way round and the
permission screen gets much wider.

You will still see *"Google hasn't verified this app"*. Every script anyone
writes for themselves shows that; verification is a review process for software
distributed publicly. The script is the text you pasted.

The nightly reminder needs two further permissions — sending mail as you, and
running while you are away — so it is a separate file that you add only if you
want it. See the last section.

## 1. Create the spreadsheet, then the script inside it

1. Go to [sheets.new](https://sheets.new) — a blank spreadsheet
2. Name it something you will recognise in Drive, e.g. `Carpool — כדורגל כיתה ג׳`
3. **Extensions** → **Apps Script**. A script editor opens, already tied to
   this spreadsheet
4. Rename the script project from *Untitled project* to `Carpool`

## 2. Paste the code

The editor opens on `Code.gs` with a `myFunction` stub. Select all of it and
replace it with the whole of [`carpool-backend.gs`](carpool-backend.gs). Save.

## 3. Pin the permissions in the manifest

This is the step that narrows the scope, and it is easy to skip.

1. Left sidebar → **⚙ Project Settings**
2. Tick **Show "appsscript.json" manifest file in editor**
3. Back to **Editor** → open `appsscript.json`
4. Replace it with [`appsscript.json`](appsscript.json) from this repository,
   and save

If your group is not in Israel, change `timeZone` to match.

## 4. Set the two properties

Still in **⚙ Project Settings**, scroll to **Script Properties** → **Add script
property**.

| Property | Value |
|---|---|
| `SHARED_SECRET` | any long random string — it is the only thing standing between your carpool and the open internet. This is what you send the other parents |
| `GROUP_NAME` | optional; shown in the app header, e.g. `כדורגל כיתה ג׳` |

**Save script properties**.

## 5. Check it before deploying

Back to **Editor**. In the toolbar, change the function dropdown to
**`testSetup`** and press **▶ Run**.

The first run asks for authorisation:

1. **Review permissions** → choose your account
2. *"Google hasn't verified this app"* → **Advanced** → **Go to Carpool
   (unsafe)**
3. One permission, naming this spreadsheet → **Allow**

If you are offered access to *all* your spreadsheets, stop: either the
manifest in step 3 did not save, or the script is standalone rather than bound.

The **Execution log** should then read something like:

```
SHARED_SECRET  set (40 chars)
GROUP_NAME     כדורגל כיתה ג׳
Spreadsheet    Carpool — כדורגל כיתה ג׳  (bound — good)
               https://docs.google.com/spreadsheets/d/...
Parents        0
Events ahead   0
Backend        v1
```

Two tabs, `Events` and `Parents`, have now appeared in the spreadsheet.

## 6. Deploy

**Deploy** → **New deployment** → the **⚙** next to *Select type* → **Web app**.

- **Execute as** — **Me**
- **Who has access** — **Anyone** (not *Anyone with a Google account*)

Both should already be set, because the manifest sets them.

**Deploy**, and copy the **Web app URL**. It ends in `/exec` — that exact URL is
what the app wants. The `/dev` one only ever answers to you, and the app will
refuse it.

## 7. Prove it from a browser

Paste the `/exec` URL into a browser tab. You want:

```
Carpool backend v1 — alive. board: ok
```

`board: ok` is the part that matters — it means the deployed web app really can
reach its spreadsheet under the narrow permission. Anything else, and the app
will not work; the message says why.

## 8. Bring the parents in

Send each parent two things: the address of the app, and the `SHARED_SECRET`.

On first open they enter:

- **השם שלי** — how the others will see them
- **הצבע שלי** — one colour each, so a card can be read without reading names
- **טלפון** — optional, and what lets another parent call them from the app
- **כתובת השרת** and **סיסמה משותפת** — the two things you sent

Then **התחברות**. Everything is stored on that device only, so each phone does
this once.

Installing it:

- **Android** — Chrome's menu → **Add to Home screen**
- **iPhone** — Safari's share button → **Add to Home Screen**. It has to be
  Safari; Chrome on iOS cannot install a PWA.

Either way it opens without browser chrome and shows the last loaded board even
with no signal.

## Who is the admin

**The first parent to register.** That is whoever set the group up — you — and
nobody has to claim anything. The admin sees a **×** next to each of the other
parents in settings, and removing one frees every future leg that parent had
claimed, so the board stops showing rides as covered by somebody who has left.
Rides that already happened are untouched.

An admin cannot remove themselves, which means a group always has one. If the
admin ever needs to change — a phone lost, a family leaving — the `admin`
column in the `Parents` tab is a plain `1` or blank, and you own the
spreadsheet. Put the `1` on whoever should have it.

### One person, however many devices

Registering used to be per device, so a laptop and a phone became two members.
Now a device with no stored identity that registers under a name the group
already has is offered that member to continue as — pick yourself and the
device carries on as you, keeping your rides, your colour and your admin flag.
Two parents who genuinely share a name can say **לא, אני הורה אחר/ת** and get
their own entry, which is why the app asks instead of merging by itself.

Settings shows the device's own id under the version, next to the word `admin`
when the group agrees. Compare it against the `id` column in the `Parents` tab:

- **Wrong row has the `1`** — move it to the row whose id matches the device
  you actually use.
- **A row belongs to a device you have stopped using** — delete the row.

Anyone who deletes their own row is simply asked to register again next time
they open the app.

**Removing is housekeeping, not a lock.** Everyone in the group shares one
secret, so a removed parent who kept it could register again under a new name.
What they cannot do is keep driving under the old one. To shut somebody out
properly, change `SHARED_SECRET` in Script Properties and send the new one to
everybody else.

## Optional: the nightly nudge

A carpool fails quietly — nobody claimed tomorrow morning and nobody noticed.

This costs two more permissions, which is why it is not in the main file. Turn
it on only if you want it:

1. In the editor, **+** next to *Files* → **Script**, named `reminder`. Paste
   in [`carpool-reminder.gs`](carpool-reminder.gs)
2. Add these two lines to `oauthScopes` in `appsscript.json` — the manifest
   pins the list, so a scope not named there is never granted:
   ```
   "https://www.googleapis.com/auth/script.send_mail",
   "https://www.googleapis.com/auth/script.scriptapp"
   ```
3. Put an address in the `email` column of the `Parents` tab for anyone who
   should get the mail. Parents without one are skipped
4. Run **`installReminder`** once, and accept the two new permissions
5. Run **`testReminder`** to send one immediately and check it looks right

Every evening around 20:00, if tomorrow has a leg with no driver, everyone gets
one mail saying which. If every leg is covered, nothing is sent — which is what
keeps it worth opening.

`removeReminder` turns it off. Deleting the file does **not**: the trigger
outlives it, so run `removeReminder` first.

## Updates

**The app updates itself.** Everyone loads the same page, so a change reaches
every parent. On a phone it arrives through the service worker: a bar appears at
the top of the board offering **עדכון**, or settings → **בדיקת עדכון**.

**The backend does not.** When `carpool-backend.gs` changes here, re-paste it,
then **Deploy** → **Manage deployments** → edit the existing one → **New
version**. Editing the existing deployment keeps your URL; creating a *new*
deployment gives you a new URL and everybody's app stops reaching you.

Settings shows both numbers. If a change does not seem to have landed, they say
which half is behind.

## If something goes wrong

| What you see | Usually means |
|---|---|
| Google offers access to *all* your spreadsheets | the manifest edit in step 3 did not save, or the script is standalone. It has to be created from **Extensions → Apps Script** inside the sheet |
| `board: unreachable (no bound spreadsheet…)` | same thing — the script is not bound to a spreadsheet |
| A runtime error naming a scope | something in the code needs a permission the manifest does not list. Add that scope to `oauthScopes` and run again |
| `אין תקשורת עם השרת` | the URL is wrong, the deployment is not set to *Anyone*, or the script is failing to load — open the `/exec` URL in a browser and read what it says |
| `הסיסמה המשותפת שגויה` | `SHARED_SECRET` does not match what the parent typed |
| `תשובה לא תקינה מהשרת` | the URL points at something that is not this script |
| `הכתובת צריכה להיות של Web App` | the `/dev` or `/edit` URL was pasted instead of `/exec` |
| A parent shows up as `הורה` | their phone has a cached board from before that parent registered; refreshing fixes it |
