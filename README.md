# Kino Today

A single-page GitHub Pages homepage for checking today's movie sessions across Riga cinema sources.

## Project Location

The project was moved from:

```text
/Users/kaspars/Documents/Kino
```

to:

```text
/Users/kaspars/code/Kino
```

If Codex or Finder still points to the old path, reopen or attach the workspace from `/Users/kaspars/code/Kino`.

## What The Page Should Do

- Show one compact card per showtime, not one grouped card per movie.
- Sort showtime cards chronologically by start time.
- Show only upcoming sessions for the current `Europe/Riga` day.
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
- Movie titles, genres, and language values remain as published by cinema sources.
- Visual style: clean light utility layout.
- Layout: compact list.
- Images: portrait posters where available.
- Filters:
  - Cinema multi-select.
  - Movie-name search.
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
- The initial committed `site/data/schedule.json` is a valid empty dataset.

GitHub Pages target:

- Treat this as a project page.
- Use relative asset and data paths so the site works under a repo path such as `/Kino/`.

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
file:///Users/kaspars/code/Kino/site/index.html
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

## Verification Already Done

The implementation was locally verified with:

```bash
pnpm test
node --check scripts/scrape.mjs
node --check site/assets/app.js
pnpm scrape
```

The live scrape was verified successfully and returned upcoming sessions from all three sources during testing.

## Notes For Future Codex Work

- This thread's original workspace was `/Users/kaspars/Documents/Kino`, but the project now lives at `/Users/kaspars/code/Kino`.
- If Codex cannot reveal the folder in Finder, reopen or reattach the workspace at `/Users/kaspars/code/Kino`.
- Keep using public-only source data unless the user explicitly changes the data policy.
- Do not add analytics.
- Keep the homepage as the first screen; do not turn it into a landing page.
