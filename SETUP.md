# Setting up a carpool group

One parent does this once. Everybody else just gets a link and a password.

Roughly fifteen minutes, most of it waiting for Google's permission screens.

## What you need

- A Google account. That is all — there is no API key and nothing to pay for.

The backend runs as *you*, and the spreadsheet it creates lives in *your*
Drive. Every other parent reaches it only through the app.

## 1. Create the script

1. Go to [script.google.com](https://script.google.com/) → **New project**
2. Delete the `myFunction` stub
3. Paste the whole of [`carpool-backend.gs`](carpool-backend.gs), and save

## 2. Set the two properties

**Project Settings** → **Script properties**.

| Property | Value |
|---|---|
| `SHARED_SECRET` | any random string — it is the only thing standing between your carpool and the open internet, so make it long. This is what you send the other parents |
| `GROUP_NAME` | optional; shown in the app header, e.g. `כדורגל כיתה ג׳` |

`SHEET_ID` is written for you the first time the script runs. Leave it alone
unless you want the board in a spreadsheet you already have, in which case put
its ID there and the script will use that one.

## 3. Check it before deploying

Run `testSetup` from the editor. The first time, Google will ask you to grant
permission to your spreadsheets and to send mail — that second one is for the
optional nightly reminder in step 6, and refusing it does not stop the app
working.

It prints which properties are set, creates the spreadsheet, and gives you its
URL. Anything reported as `MISSING — required` will stop the app working.

## 4. Deploy

**Deploy** → **New deployment** → type **Web app**.

- **Execute as:** Me
- **Who has access:** **Anyone**

That second one sounds alarming and is not: "anyone" may send a request, but
every request is rejected unless it carries your `SHARED_SECRET`. The app needs
this because the other parents are not signed in to your Google account.

Copy the **Web app URL**. It ends in `/exec` — that exact URL is what the app
wants. The `/dev` one only ever answers to you, and the app will refuse it.

## 5. Bring the parents in

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

Either way it opens without browser chrome and shows the last loaded board
even with no signal.

## 6. Optional: the nightly nudge

A carpool fails quietly — nobody claimed tomorrow morning and nobody noticed.

Add an `email` to each parent's row in the `Parents` tab of the spreadsheet,
then run `installReminder` once from the editor. Every evening around 20:00, if
tomorrow has a leg with no driver, everyone gets one mail saying which. If every
leg is covered, nothing is sent — which is what keeps it worth opening.

`removeReminder` turns it off again.

## Updates

**The app updates itself.** Everyone loads the same page, so a change reaches
every parent. On a phone it arrives through the service worker: a bar appears
at the top of the board offering **עדכון**, or settings → **בדיקת עדכון**.

**The backend does not.** When `carpool-backend.gs` changes here, re-paste it,
then **Deploy** → **Manage deployments** → edit the existing one → **New
version**. Editing the existing deployment keeps your URL; creating a *new*
deployment gives you a new URL and everybody's app stops reaching you.

Settings shows both numbers. If a change does not seem to have landed, they say
which half is behind.

## If something goes wrong

| What you see | Usually means |
|---|---|
| `אין תקשורת עם השרת` | the URL is wrong, the deployment is not set to *Anyone*, or the script is failing to load — open the `/exec` URL in a browser, and it should answer `Carpool backend v1 — alive` |
| `הסיסמה המשותפת שגויה` | `SHARED_SECRET` does not match what the parent typed |
| `תשובה לא תקינה מהשרת` | the URL points at something that is not this script |
| `הכתובת צריכה להיות של Web App` | the `/dev` or `/edit` URL was pasted instead of `/exec` |
| A parent shows up as `הורה` | their phone has a cached board from before they registered; pulling to refresh fixes it |
| Two spreadsheets appeared | `SHEET_ID` was cleared at some point. Put the ID of the one you want back into Script properties |
