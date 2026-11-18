# Gut Log

A tiny, phone-first tracker for bowel movements (Bristol stool scale 1–7), **MiraLAX** and **Gas-X**.

- **Log tab:** three KPIs (poops/day, average stool type, time between poops) and three big buttons.
  Tap **Poop** to pick a Bristol type (with a "15m / 30m / 1h ago" option), or tap a medicine to log it instantly.
  Every log shows an **Undo** toast.
- **History tab:** every entry, grouped by day. Tap a row to change its time or type; tap the trash icon twice to delete it.
- **Details tab:** pattern sentences (e.g. *"After MiraLAX, the next poop typically comes 3h 50m later"*), plus charts for
  poops per day with medicine doses, stool type over time, type mix, medicine timing (before / during / after a poop),
  time of day, and weekly averages.

No build step and no server. It's plain HTML, CSS and JS served by GitHub Pages.

## Where the data lives

Each entry is written to **`data/gut-log.csv`** on a branch named **`data`** in a GitHub repo you choose.
The app creates both the branch and the file the first time it saves. Excel, Numbers and Google Sheets all open the CSV directly.

| id | timestamp | date | time | weekday | event | bristol_type | bristol_description |
|---|---|---|---|---|---|---|---|
| mwl…| 2026-11-18T08:12:00-05:00 | 2026-11-18 | 08:12 | Wed | Poop | 4 | Like a sausage or snake, smooth and soft |

- Logging works offline too: entries queue on the phone and save when the connection returns.
- Two phones can log to the same file. If both save at the same moment, the app reloads the file and merges the entries instead of overwriting.
- **Settings → Download Excel / Download CSV** exports everything.
  **Import file…** reads `.xlsx`, `.csv` or `.txt` files and skips duplicate rows.

## Setup (about 5 minutes)

1. **Publish the site.** Merge this branch into `main`. In the repo, open **Settings → Pages**, choose
   **Deploy from a branch → `main` / root**, and wait a minute. The site will be at `https://<owner>.github.io/<repo>/`.
   > GitHub Pages on a *private* repo needs a paid GitHub plan. The page itself contains no data,
   > so you can also host it from a public repo and keep the data in a private one (step 3).
2. **Make a token.** Go to <https://github.com/settings/personal-access-tokens/new> and create a **fine-grained** token:
   - Repository access: **Only select repositories →** the repo that will hold the data
   - Permissions: **Contents → Read and write**
   - Expiration: whatever you're comfortable with. The app will show "Not saved" when the token expires.
3. **On the phone:** open the site, tap ⚙️, and check that Owner and Repository point at the **data** repo
   (these fill in automatically from the URL). Paste the token, then tap **Save & connect**. Anything already logged on the phone gets uploaded.
4. **Add it to the home screen.** On iPhone, tap Safari's Share button, then **Add to Home Screen**. It then opens full screen like an app.

The token is stored only in that phone's browser storage. It never gets committed.

## Privacy

Keep the repository that holds `data/gut-log.csv` **private**: it's health data. The page has a `noindex` meta tag.

## Files

```
index.html            page structure
styles.css            dark, colorblind-safe theme
app.js                logging, GitHub sync, stats and charts (no dependencies;
                      the Excel library loads from cdnjs only for .xlsx import/export)
manifest.webmanifest  "Add to Home Screen" support
icon.svg, icon-*.png  app icon
```
