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

### 4. Nightly updates (optional)

To refresh with new papers daily:

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
├── index.html
├── style.css
├── main.js
├── data/
│   ├── publications.db   # created by backfill/update
│   ├── institutions.json # written by export
│   └── meta.json
├── img/
│   ├── earth_day.jpg
│   ├── earth_night.jpg
│   └── earth_bump_roughness_clouds.jpg
├── scripts/
│   ├── backfill.py
│   ├── update.py
│   └── export.py
└── requirements.txt
```

## Tech notes

- **Frontend:** Vanilla JS, Three.js r170+ WebGPU and TSL, no bundler. Three.js is loaded via the import map in `index.html`.
- **Data:** OpenAlex Works API with concept filter for Robotics (`C18903297`), cursor pagination, institution geo required.
- **Globe:** Day/night textures, bump/roughness/clouds, fresnel atmosphere; markers as instanced spheres with log-scaled size and a subtle opacity pulse.
