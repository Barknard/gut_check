# Gut Check

A tiny, phone-first tracker for bowel movements (Bristol stool scale 1–7), **vomiting**, **Imodium** and **Gas-X**.

- **Log tab:** three KPIs (poops/day, average stool type, time between poops) and four big buttons.
  Tap **Poop** to pick a Bristol type (with a "15m / 30m / 1h ago" option), or tap Vomit or a medicine to log it instantly.
  Every log shows an **Undo** toast.
- **History tab:** every entry, grouped by day. Tap a row to change its time or type; tap the trash icon twice to delete it (with Undo).
- **Did you know?** After a week of logging, the Log tab shows the most statistically significant pattern in all the data. Examples: "Stools are firmer in the 24 hours after Imodium: average type 2.8 vs 6.2", or that vomiting is more common on days with a certain medicine.
  - Each candidate pattern gets a proper test: Mann-Whitney U, Welch t, Fisher exact, chi-square, or a regression slope.
  - The p-values are Bonferroni-adjusted for the number of patterns checked. Only patterns that stay under 0.05 are shown as reliable; otherwise the strongest one is labelled "early sign".
  - **Next** cycles through the other reliable patterns.
- **Start over:** ⚙️ → **Delete all entries…** asks for confirmation (with a "download a backup first" button), deletes everything wherever it's saved, and offers Undo for 10 seconds. Settings are kept.
- **Details tab:** pattern sentences (e.g. *"After Imodium, the next poop typically comes 3h 50m later"*), plus charts for
  poops per day with medicine doses, stool type over time, type mix, medicine timing (before / during / after a poop),
  vomiting (how often, and how often it follows Imodium or Gas-X), time of day, and weekly averages.

No build step and no server. It's plain HTML, CSS and JS served by GitHub Pages.

## Where the data lives (and why it won't get lost)

Everything can be saved in several places at once. The badge at the top of the app says how many, e.g. "Saved in 3 places".

1. **Inside the app on the phone.** Always on. The app also keeps an **automatic backup for each of the last 30 days**, plus one taken just before "Delete all". Any of them can be restored.
2. **A spreadsheet file on the phone** (`.xlsx` or `.csv`). Android (Chrome) and computers (Chrome or Edge) only. Picking a Google Drive folder also gets the file off the phone. iPhones can't do this, so they get a **Save a copy to Files** button instead.
3. **A Google Sheet in her Google Drive** (recommended, free, works on every phone). A small script in the Sheet ([`google-sheet/Code.gs`](google-sheet/Code.gs)) receives the entries. Google Sheets also keeps its own version history.
4. **A private GitHub repository** (for technical users). Keeps every past version. The app refuses to save to a public repository.

How the copies stay in step:
- Every place gets every entry. If one place is unreachable (no internet, file permission expired), the others still save, and the missed changes are sent as soon as it's back.
- Anything new found in one place (another phone, a row added in Excel) is copied to the others.
- **Only deleting in the app removes an entry**, and only after a confirmation or with Undo. A missing or old copy can never wipe out data.
- If saving has been failing for over an hour, or the log is only inside the app, a warning appears on the home screen.

All copies use the same columns:

| id | timestamp | date | time | weekday | event | bristol_type | bristol_description |
|---|---|---|---|---|---|---|---|
| mwl…| 2026-11-18T08:12:00-05:00 | 2026-11-18 | 08:12 | Wed | Poop | 4 | Like a sausage or snake, smooth and soft |

`event` is one of `Poop`, `Vomit`, `Imodium`, `Gas-X`. Entries logged before the rename say `MiraLAX` in old files and are read as Imodium.

## Setup

Open the app, tap ⚙️, then **Set up saving & backups**. The wizard walks through:
1. **A file on this phone**: create or pick the spreadsheet.
2. **Online backup to Google Drive** (easiest on a computer):
   - Create a Google Sheet and open **Extensions → Apps Script**.
   - Paste the script (the wizard has a **Copy the script** button), then **Deploy → Web app** (Execute as: Me, Who has access: Anyone).
   - Reload the Sheet and use **Gut Check → Get connection link**.
   - Paste that link into the app on the phone.
   - The link holds a secret key, and only people who can edit the Sheet can see it. **Gut Check → Make a new connection link** replaces the key if the link is ever shared by mistake.
   - GitHub is offered there as an alternative.
3. **Bring in existing data**: import an Excel/CSV/text file, or restore one of the automatic backups.

To publish the site itself: in this repo, **Settings → Pages → Deploy from a branch → `main` / root**.

## App icon not showing?

Phones save the home-screen icon when the shortcut is first added and don't refresh it. If the shortcut was added before the site was working, or before the icon was updated, it keeps a generic icon. Remove the shortcut from the home screen, open the site in Safari or Chrome, refresh, and add it to the home screen again.

## Files

```
index.html            page structure
styles.css            dark, colorblind-safe theme
app.js                logging, saving (phone file or GitHub), stats and charts
vendor/xlsx.*         SheetJS 0.18.5 (Apache-2.0), loaded only when an Excel file is used
manifest.webmanifest  "Add to Home Screen" support
icon.svg, icon-*.png  app icon
```
