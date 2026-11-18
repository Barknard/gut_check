# Gut Check

A tiny, phone-first tracker for bowel movements (Bristol stool scale 1–7), **vomiting**, **MiraLAX** and **Gas-X**.

- **Log tab:** three KPIs (poops/day, average stool type, time between poops) and four big buttons.
  Tap **Poop** to pick a Bristol type (with a "15m / 30m / 1h ago" option), or tap Vomit or a medicine to log it instantly.
  Every log shows an **Undo** toast.
- **History tab:** every entry, grouped by day. Tap a row to change its time or type; tap the trash icon twice to delete it (with Undo).
- **Start over:** ⚙️ → **Delete all entries…** asks for confirmation (with a "download a backup first" button), deletes everything wherever it's saved, and offers Undo for 10 seconds. Settings are kept.
- **Details tab:** pattern sentences (e.g. *"After MiraLAX, the next poop typically comes 3h 50m later"*), plus charts for
  poops per day with medicine doses, stool type over time, type mix, medicine timing (before / during / after a poop),
  vomiting (how often, and how often it follows MiraLAX or Gas-X), time of day, and weekly averages.

No build step and no server. It's plain HTML, CSS and JS served by GitHub Pages.

## Where the data lives

Entries are always kept inside the app on the phone. On top of that, **Settings (⚙️)** offers one of two places to save:

**1. A spreadsheet file on the phone**: Android (Chrome) and computers (Chrome or Edge)
- Tap **Create new file…** or **Use existing file…** and pick any folder: Downloads, Documents, Google Drive and so on.
- After that, every tap is written straight into that file. The app re-reads it each time it opens, so edits made in Excel show up too.
- Name it **`.xlsx`** for a real Excel file or **`.csv`** for a plain one.
- After a while Chrome may ask again. The badge at the top then says **Tap to reconnect**; one tap restores access. Entries made in the meantime wait in the app and are written on reconnect.
- **iPhone and iPad can't do this.** Apple doesn't let any website stay linked to a file. On iPhone the same box shows **Save copy to Files**, which saves a copy into a folder she chooses. **Import file…** reads a copy back in.

**2. A private GitHub repo**: backed up, and several phones can share one log
- The log is stored as `gut-check.csv` in a **separate private repo** (default name `gut-check-data`).
- The app **refuses to save to a public repo**.

Both use the same columns:

| id | timestamp | date | time | weekday | event | bristol_type | bristol_description |
|---|---|---|---|---|---|---|---|
| mwl…| 2026-11-18T08:12:00-05:00 | 2026-11-18 | 08:12 | Wed | Poop | 4 | Like a sausage or snake, smooth and soft |

- Two phones can log to the same GitHub file. If both save at the same moment, the app reloads the file and merges the entries instead of overwriting.
- **Settings → Download Excel / Download CSV** exports everything at any time.
  **Import file…** reads `.xlsx`, `.csv` or `.txt` files and skips duplicate rows.

## Setup

Only needed for the GitHub option. The phone-file option needs no setup beyond picking the file.

1. **Site:** in this repo, open **Settings → Pages → Deploy from a branch → `main` / root**.
   The site is at `https://<owner>.github.io/<repo>/`.
2. **Data repo:** create a new **private** repo named `gut-check-data` at <https://github.com/new>.
   Ticking "Add a README" is fine; the app creates the CSV itself.
3. **Token:** at <https://github.com/settings/personal-access-tokens/new>, create a **fine-grained** token with
   repository access **Only select repositories → `gut-check-data`** and permission **Contents → Read and write**.
4. **Phone:** open the site, tap ⚙️, check that Owner is right and Private repo says `gut-check-data`, paste the token,
   and tap **Save & connect**. Then use **Share → Add to Home Screen**. The token is stored only on that phone.

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
