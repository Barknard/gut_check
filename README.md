# Gut Check

A tiny, phone-first tracker for bowel movements (Bristol stool scale 1–7), **vomiting**, **MiraLAX** and **Gas-X**.

- **Log tab:** three KPIs (poops/day, average stool type, time between poops) and four big buttons.
  Tap **Poop** to pick a Bristol type (with a "15m / 30m / 1h ago" option), or tap Vomit or a medicine to log it instantly.
  Every log shows an **Undo** toast.
- **History tab:** every entry, grouped by day. Tap a row to change its time or type; tap the trash icon twice to delete it.
- **Details tab:** pattern sentences (e.g. *"After MiraLAX, the next poop typically comes 3h 50m later"*), plus charts for
  poops per day with medicine doses, stool type over time, type mix, medicine timing (before / during / after a poop),
  vomiting (how often, and how often it follows MiraLAX or Gas-X), time of day, and weekly averages.

No build step and no server. It's plain HTML, CSS and JS served by GitHub Pages.

## Where the data lives

This repo only holds the **app**, and it can be public. The log is stored in a **separate private repo**
(default name `gut-check-data`), in a file called `gut-check.csv`. Excel, Numbers and Google Sheets all open it directly.
The app checks the data repo before every session and **refuses to save to a public repo**.

| id | timestamp | date | time | weekday | event | bristol_type | bristol_description |
|---|---|---|---|---|---|---|---|
| mwl…| 2026-11-18T08:12:00-05:00 | 2026-11-18 | 08:12 | Wed | Poop | 4 | Like a sausage or snake, smooth and soft |

- Logging works offline too: entries queue on the phone and save when the connection returns.
- Two phones can log to the same file. If both save at the same moment, the app reloads the file and merges the entries instead of overwriting.
- **Settings → Download Excel / Download CSV** exports everything.
  **Import file…** reads `.xlsx`, `.csv` or `.txt` files and skips duplicate rows.

## Setup

1. **Site:** in this repo, open **Settings → Pages → Deploy from a branch → `main` / root**.
   The site is at `https://<owner>.github.io/<repo>/`.
2. **Data repo:** create a new **private** repo named `gut-check-data` at <https://github.com/new>.
   Ticking "Add a README" is fine; the app creates the CSV itself.
3. **Token:** at <https://github.com/settings/personal-access-tokens/new>, create a **fine-grained** token with
   repository access **Only select repositories → `gut-check-data`** and permission **Contents → Read and write**.
4. **Phone:** open the site, tap ⚙️, check that Owner is right and Private repo says `gut-check-data`, paste the token,
   and tap **Save & connect**. Then use **Share → Add to Home Screen**. The token is stored only on that phone.

## Files

```
index.html            page structure
styles.css            dark, colorblind-safe theme
app.js                logging, GitHub sync, stats and charts (no dependencies;
                      the Excel library loads from cdnjs only for .xlsx import/export)
manifest.webmanifest  "Add to Home Screen" support
icon.svg, icon-*.png  app icon
```
