# Robotics Publications Globe Visualizer

A full-stack web app that visualizes global robotics research activity on an interactive 3D globe: a Python data pipeline (OpenAlex) and a vanilla JS + Three.js WebGPU frontend.

## Textures (required)

The globe uses free, non-commercial planet textures from **Solar System Scope**. Download and place them in the `img/` directory:

- **Earth day:** [Earth 2K – Day](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) → save as `img/earth_day.jpg`
- **Earth night:** [Earth 2K – Night](https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg) → save as `img/earth_night.jpg`
- **Bump/roughness/clouds:** Use a combined or separate 2K bump/clouds texture and save as `img/earth_bump_roughness_clouds.jpg`

If you use different resolutions (e.g. 4K), keep the same filenames or update the paths in `main.js` (`textureBase` and texture filenames).

## Setup

### 1. Textures

Download the three texture files from Solar System Scope (links above) and place them in `img/` as:

- `img/earth_day.jpg`
- `img/earth_night.jpg`
- `img/earth_bump_roughness_clouds.jpg`

### 2. Python pipeline (optional but recommended)

```bash
pip install -r requirements.txt
python scripts/backfill.py
```

This creates `data/publications.db`, fetches robotics papers from OpenAlex (2018–2026), and writes `data/institutions.json` and `data/meta.json`. Without this, the globe will load with no markers and zero stats.

### 3. Serve the app

From the project root:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the URL shown (e.g. `http://localhost:3000` or `http://localhost:8000`). The app must be served over HTTP (or HTTPS); opening `index.html` as a file will fail due to module/import rules.

### 4. Daily updates (optional)

**GitHub Actions (recommended)**  
Push the repo to GitHub; the workflow in `.github/workflows/daily-update.yml` runs `scripts/update.py` every day at 02:00 UTC and commits updated `data/` back to the repo. You can also trigger it manually from the Actions tab.

**Local cron**  
To run updates on your own machine instead:

```bash
crontab -e
```

Add:

```
0 3 * * * /usr/bin/python3 /path/to/RoboticsMap/scripts/update.py
```

Replace `/usr/bin/python3` and `/path/to/RoboticsMap` with your Python path and project path.

## Project layout

```
/
├── index.html              # Entry page; import map for Three.js
├── main.js                 # Globe, markers, sidebar, leaderboards, data loading
├── style.css               # Layout, sidebar, leaderboard, tooltip, loading overlay
├── requirements.txt        # Python deps (requests, schedule)
├── data/
│   ├── publications.db     # SQLite DB (papers, institutions, links); created by backfill/update
│   ├── institutions.json  # Per-institution list + paper_count; written by export
│   └── meta.json          # Totals, date range, papers_by_country; written by export
├── img/
│   ├── earth_day.jpg
│   ├── earth_night.jpg
│   └── earth_bump_roughness_clouds.jpg
├── scripts/
│   ├── backfill.py        # Initial load: fetch robotics papers from OpenAlex, build DB, run export
│   ├── update.py          # Incremental update from last date, then export
│   └── export.py         # DB → institutions.json + meta.json (incl. distinct papers per country)
└── .github/
    └── workflows/
        └── daily-update.yml   # Scheduled job: run update.py, commit updated data
```

## Tech notes

- **Frontend:** Vanilla JS, Three.js r170+ WebGPU and TSL, no bundler. Three.js is loaded via the import map in `index.html`.
- **Sidebar:** Search (filter markers by institution name), top institutions and top countries leaderboards (click to highlight that institution or country on the globe). Country counts use distinct papers per country from `meta.papers_by_country`.
- **Data:** OpenAlex Works API with concept filter for Robotics (`C18903297`), cursor pagination, institution geo required. Export writes `papers_by_country` so country leaderboard counts never exceed total papers.
- **Globe:** Day/night textures, bump/roughness/clouds, fresnel atmosphere; markers as instanced spheres with log-scaled size and a subtle opacity pulse.
