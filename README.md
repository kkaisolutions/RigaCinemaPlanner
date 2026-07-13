# Riga Cinema Planner

A GitHub Pages site showing **today's upcoming** movie sessions in Riga.

Planned public address: <https://kkaisolutions.github.io/RigaCinemaPlanner/>

## Sources and data flow

| Source | Acquisition | Why |
| --- | --- | --- |
| Forum Cinemas | GitHub Actions, hourly at `:00` | Public XML works from GitHub-hosted runners. |
| Apollo Kino, including Domina | ESP32 at home, hourly at `:10` | Apollo blocks GitHub-hosted runner traffic. |
| Cinamon Alfa | ESP32 at home, hourly at `:10` | Cinamon times out from GitHub-hosted runners. |

The ESP32 uploads raw public schedule HTML to a temporary release in the private `RigaCinemaPlannerIngest` repository. Its release workflow parses the assets and updates this repository's `data` branch. The raw release is deleted immediately after a fully successful ingest; partial/failed releases are retained for seven days.

`main` holds website code. The `data` branch holds only generated schedule changes. Pages combines website code from `main` with the latest schedule from `data`.

## Freshness and failure handling

- Apollo and Cinamon are fresh for 90 minutes after a successful ESP update.
- If a source fails, its last successful data for today is retained and marked stale.
- Before the first morning ESP upload, the site says it is waiting for Apollo/Cinamon.
- Yesterday's sessions are never displayed.
- A private ingest-repository issue opens after two expected ESP uploads are missed, updates during the outage, and closes after recovery.

## Local development

```bash
pnpm install
pnpm test
```

Run a direct local scrape only when your network can reach all sources:

```bash
pnpm scrape
```

Run the Forum-only merge used by the hourly public workflow:

```bash
node scripts/scrape.mjs --forum-only --previous site/data/schedule.json
```

The parser can consume pages supplied by the ESP32 without making Apollo/Cinamon requests itself:

```bash
node scripts/scrape.mjs \
  --skip-forum \
  --previous previous-schedule.json \
  --apollo-file apollo-riga.html \
  --apollo-domina-file apollo-domina.html \
  --cinamon-file cinamon-alfa.html \
  --output site/data/schedule.json
```

## Deployment prerequisites

1. Create the public `kkaisolutions/RigaCinemaPlanner` repository and push this project.
2. Create the private `kkaisolutions/RigaCinemaPlannerIngest` repository and push its companion workspace.
3. Create the `data` branch from `main` in the public repository.
4. Enable GitHub Pages with **GitHub Actions** as the publishing source.
5. Add the private repository's `WEB_PUBLISH_TOKEN` Action secret. It must only access the public repository, with permission to update `data` and dispatch deployment.
6. Follow the private repository's firmware README to configure Arduino IDE and the ESP32.

Never commit device Wi-Fi credentials or GitHub tokens. The firmware uses a local ignored `secrets.h` file.
