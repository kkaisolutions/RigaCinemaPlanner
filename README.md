# Riga Cinema Planner

A single-page GitHub Pages homepage for checking today's movie sessions across Riga cinema sources.

Live site: `https://mckebabs.github.io/RigaCinemaPlanner/`

GitHub repository: `https://github.com/mckebabs/RigaCinemaPlanner`

## Project Location

The project folder is:

```text
/Users/kaspars/code/RigaCinemaPlanner
```

Older project folders should no longer be used.

If Codex or Finder still points to the old path, reopen or attach the workspace from `/Users/kaspars/code/RigaCinemaPlanner`.

## What The Page Should Do

- Show one compact card per showtime, not one grouped card per movie.
- Sort showtime cards chronologically by start time.
- Show upcoming sessions for the current and following `Europe/Riga` day.
- Provide Today and Tomorrow tabs, with Today selected by default.
- Each card links to the corresponding movie page on the corresponding cinema website.
- The whole card is clickable.
- Cards link to movie detail pages, not ticket checkout pages.
- Cards do not include a separate ticket button.
- Hide any showtime that cannot link to a movie page.

Each showtime card should include, when available:

- Cinema name.
- Start time in 24-hour format.
- Movie title and original title in slash format, for example `Local Title / Original Title`.
- Portrait poster image, using external image URLs.
- Age/kids rating in simple wording, such as `All ages`, `7+`, `12+`, `16+`.
- Genre.
- IMDb score when the cinema source publishes a score.
- IMDb link/text when a source publishes a link but not a score.
- Movie language.
- Auditorium.
- Seat availability.

## Cinema Sources

Use the public schedule information from:

- Forum Cinemas: `https://www.forumcinemas.lv/filmas/seansi`
- Apollo Kino: `https://www.apollokino.lv/schedule?theatreAreaID=1014`
- Cinamon Akropole Alfa: `https://cinamonkino.com/akropole-alfa/saraksts/lv`

Apollo behavior:

- Include all Apollo cinemas returned by the Apollo schedule page, not only the linked location.
- Use short readable names such as `Apollo Akropole`, `Apollo Domina`, and `Apollo Plaza`.
- Fetch each unique Apollo movie detail page once per scrape to get better portrait posters and rating details.

Forum behavior:

- Use the Forum schedule XML for sessions.
- Also fetch Forum Events XML for richer metadata, posters, and IMDb links.
- Do not scrape Forum `/websales/show/` pages.

Cinamon behavior:

- Parse the rendered public Nuxt state from the schedule page.
- Do not call Cinamon `/api/`, `/seat-plan/`, `/booking/`, or other robots-disallowed paths directly.

## Data Policy

Use public-only data.

Do not scrape ticket-purchase flows, booking pages, seat-plan pages, account pages, or robots-disallowed URLs. If exact data is unavailable from public schedule pages or allowed feeds, do not invent it.

Seat availability rules:

- Show exact `taken / total seats` only when exact total and free/taken values are publicly available.
- Use the wording `taken seats`, not `tickets bought`, because public sources may include reservations or holds.
- If exact sold/taken total is unavailable but exact free seats are public, show free seats, for example `269 free seats`.
- Do not show guessed sold/total values.

IMDb rules:

- Show IMDb score when the cinema source publicly exposes it.
- If a source provides only an IMDb link, show IMDb link/text.
- Do not use external IMDb, OMDb, or TMDb API keys.
- Do not guess ratings.

## UI Decisions

- Interface language: English.
- First heading: `Riga Cinema Planner` only.
- Movie titles, genres, and language values remain as published by cinema sources.
- Visual style: clean light utility layout.
- Layout: compact list.
- Images: portrait posters where available.
- Filters:
  - Cinema multi-select.
  - Movie-name search.
- Manual refresh:
  - Show a `Refresh data` button in the header.
  - The button re-fetches the latest deployed `data/schedule.json` with cache busting.
  - It does not directly scrape cinema websites from the browser.
- Default filters: all cinemas selected.
- Movie search:
  - Match both local and original titles.
  - Ignore accents/diacritics.
  - Store filter state in the URL query string.
- Kids suitability:
  - Show as a badge only.
  - No kids filter.
- Cinema names:
  - Use short readable labels.
- Link affordance:
  - No external-link icon.
  - Use card hover/focus styling.
- Empty state:
  - Show a clear `No upcoming sessions today` state.
  - Do not reveal past sessions automatically.
- Warnings:
  - Show a small header note if a source fails.
  - Keep source failure messages concise and user-readable.
- Freshness:
  - Show a last-updated timestamp in Riga time.
- Attribution:
  - Per-card links only.
  - No separate footer source list.
- Non-movie events:
  - Exclude non-movie events when the source identifies event type.
- Duplicate showtimes:
  - Keep cards compact.
  - Add disambiguating tags only if otherwise identical cards need it.

## Scraping And Deployment

Scraping is done by GitHub Actions and deployed to GitHub Pages.

Workflow decisions:

- Deploy the generated site as a GitHub Pages artifact.
- Do not commit hourly generated JSON updates to the repository.
- Run hourly during Riga daytime/evening, from 08:00 through 23:00 Riga time.
- The GitHub Actions cron is UTC; the scraper must compute `today` in `Europe/Riga`.
- Also support manual `workflow_dispatch`.
- If one source fails, still deploy partial data from successful sources and include a warning.
- A source returning zero sessions is valid (for example, overnight); only fetch or parser failures should be reported as source failures.
- The initial committed `site/data/schedule.json` is a valid empty dataset.
- GitHub Actions uses current Node-compatible action versions to avoid Node 20 deprecation annotations.

GitHub Pages target:

- Treat this as a project page.
- Use relative asset and data paths so the site works under a repo path such as `/RigaCinemaPlanner/`.

Current scraper limitation:

- Local scraping from a normal network has successfully returned all three sources.
- GitHub-hosted Actions runners currently receive `HTTP 403` from Apollo and time out when reaching Cinamon.
- The deployed page therefore may show Forum Cinemas only when generated by GitHub-hosted Actions.
- The practical workaround is a self-hosted GitHub Actions runner on a network the cinema sites allow, or another small trusted scraping host/proxy.

## Commands

Install dependencies:

```bash
pnpm install
```

Run parser tests:

```bash
pnpm test
```

Run the scraper locally:

```bash
pnpm scrape
```

Start a local static server from the site folder:

```bash
cd site
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

The file URL is:

```text
file:///Users/kaspars/code/RigaCinemaPlanner/site/index.html
```

The local server is preferred because the page fetches `data/schedule.json`.

## Current Implementation

Important files:

- `site/index.html` - static page shell.
- `site/assets/styles.css` - clean light compact-list styling.
- `site/assets/app.js` - client-side JSON loading, filtering, and rendering.
- `site/data/schedule.json` - generated schedule data; committed as an empty starter dataset.
- `scripts/scrape.mjs` - public-data scraper and normalizer.
- `test/parsers.test.mjs` - focused parser fixture tests.
- `.github/workflows/pages.yml` - scheduled scrape and GitHub Pages deployment.

Data model highlights:

- `cinema`
- `title`
- `originalTitle`
- `posterUrl`
- `imdbRating`
- `imdbUrl`
- `ageRating`
- `genres`
- `startTime`
- `auditorium`
- `language`
- `movieUrl`
- `availability`

The scraper publishes both the current Riga date and the following Riga date
in `dates`, and each showtime carries `serviceDate`. Today is filtered to
future sessions; tomorrow is kept as a complete upcoming-day schedule.

Availability now keeps `freeSeats`, `totalSeats`, `takenSeats`, and (when the
denominator is known) `occupiedPercent`. Apollo uses the cinema-published
auditorium capacity table; Forum reads seat totals when present in its public
schedule XML; Cinamon uses the public Nuxt schedule values. Unknown values stay
unset rather than being estimated.

IMDb links use a source-provided IMDb URL when available. Otherwise the UI
provides an IMDb title-search link using the original title, which avoids
claiming a potentially incorrect direct match without an external API key.

## Latest Verification

The current implementation was verified with:

```bash
pnpm test
pnpm scrape
```

Recent local scrape result: all three sources succeeded locally. Recent GitHub Actions result: workflow and deployment succeeded, but Apollo and Cinamon were blocked/unreachable from GitHub-hosted runners, so the live generated data contained Forum Cinemas plus concise warnings. The in-page refresh button can reload the newest deployed JSON, but it cannot bypass the GitHub-hosted runner network block.

## Notes For Future Codex Work

- The project folder should be `/Users/kaspars/code/RigaCinemaPlanner`.
- The GitHub repository should be `mckebabs/RigaCinemaPlanner`.
- If Codex cannot reveal the folder in Finder, reopen or reattach the workspace at `/Users/kaspars/code/RigaCinemaPlanner`.
- Keep using public-only source data unless the user explicitly changes the data policy.
- Do not add analytics.
- Keep the homepage as the first screen; do not turn it into a landing page.
