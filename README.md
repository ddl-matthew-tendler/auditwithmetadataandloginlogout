## Domino Audit Trail Exporter (Full Metadata + Login Audit)

A Domino standard app that exports Audit Trail events with full metadata flattening, generates 21 CFR Part 11 compliant PDF reports, and tracks login/logout events via Keycloak integration.

Currently, Domino's unified audit trail provides additional metadata for Audit Events that is only available by clicking into each event and viewing its attributes. Those attributes are not included in the native CSV Download extract. This app calls the Domino Audit Trail API, flattens event structures (including metadata and affected entities), and writes results to a Domino Dataset for download and analysis.

> Note: This is not an official Domino product. It is provided as-is and has not been formally validated.

### Architecture

- **Backend**: FastAPI (Python) — handles API calls, data flattening, PDF generation, and DuckDB queries
- **Frontend**: React 18 + Ant Design 5 via CDN (no build step required)
- **Charts**: Highcharts for event and actor rollup visualizations
- **PDF**: fpdf2 for 21 CFR Part 11 compliant audit trail reports

### Features

- **Export tab**: Fetch audit trail events, flatten metadata dynamically, and save as JSON, Parquet (partitioned by day), and CSV
- **Explore tab**: Query previously exported Parquet files with DuckDB for fast rollups and filtering
- **Login Audit tab**: Fetch login/logout events from Keycloak for 21 CFR Part 11 compliance tracking
- **PDF export**: Generate regulatory-grade PDF reports with fixed 6-column layout (Date & Time, User, Event, Project, Target, Detail)
- **Full metadata flattening**: Dynamic inclusion of `metadata` fields, affected entities, targets, and field changes
- **Dummy data mode**: Built-in mock data for demos and development without a Domino connection

### Requirements

- Python 3.8+
- Packages: `fastapi`, `uvicorn`, `requests`, `pandas`, `duckdb`, `pyarrow`, `fpdf2`, `python-keycloak`
- Domino user API key exposed via environment variable `DOMINO_USER_API_KEY`
- Access to a Domino deployment and its Audit Trail API
- (Optional) Keycloak access for login/logout event auditing

### Output files

Written into the selected Domino Dataset:
- `audit_full_metadata_YYYYMMDD.json` — raw API response
- `parquet/date=YYYYMMDD/audit_full_metadata_YYYYMMDD.parquet` — partitioned by day
- `audit_full_metadata_friendly_YYYYMMDD.csv` — flattened tabular data
- `audit_trail_report_YYYYMMDD.pdf` — 21 CFR Part 11 compliant PDF (via Export PDF button)

### CSV / PDF columns

- **Core**: `Date & Time`, `User Name`, `User First Name`, `User Last Name`, `Event`, `Project`, `Event Source`
- **Targets**: `Target Entity Type`, `Target User`, `Target Entity Id`
- **Field changes**: `Field Changed`, `Field Type`, `Before`, `After`, `Added`, `Removed`
- **Dynamic entity expansions**: `<entityType>_1`, `<entityType>_2`, ... (from `affecting[]`)
- **Dynamic metadata expansions**: `Meta: <key>` for each key in `metadata`
- **PDF Detail column**: All metadata and field changes collapsed into a single human-readable cell

### Running on Domino (recommended)

1. Ensure `DOMINO_USER_API_KEY` is available as an environment variable.
2. Install dependencies: `pip install -r requirements.txt`
3. Add this as a Domino App. The entry point is `app.sh` which runs: `uvicorn app:app --host 0.0.0.0 --port 8888`
4. Open the App. The Domino Host is auto-detected from environment variables. Select a destination dataset, date range, and max rows; click "Generate Audit Trail Export".

For Keycloak login auditing, also set:
- `KEYCLOAK_HOST` — Keycloak server URL
- `KEYCLOAK_PASSWORD` — Admin password
- `KEYCLOAK_REALM` (default: `DominoRealm`)
- `KEYCLOAK_USERNAME` (default: `keycloak`)

### Running locally (for development)

1. Install dependencies:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

2. Start the FastAPI backend:

```bash
python3 -m uvicorn app:app --host 0.0.0.0 --port 8889
```

3. Start the dev server (serves frontend + proxies API calls to backend):

```bash
node dev_server.js
```

4. Open http://localhost:8888. The app defaults to Dummy Data mode when not running on Domino.

### Project structure

```
app.py                  # FastAPI backend — API routes, data flattening, PDF generation
app.sh                  # Domino App entry point
dev_server.js           # Node.js dev proxy (local development only)
requirements.txt        # Python dependencies
static/
  index.html            # SPA entry point with sequential script loader
  app.js                # React + Ant Design frontend (3 tabs)
  mock_data.js          # Dummy data generators for demo mode
  styles.css            # Domino-themed styles
  domino-logo.svg       # Domino brand logo
  react.min.js          # React 18 (local CDN copy)
  react-dom.min.js      # ReactDOM 18 (local CDN copy)
  antd.min.js           # Ant Design 5 (local CDN copy)
  antd-reset.css        # Ant Design reset styles
  dayjs.min.js          # Day.js (local CDN copy)
  dayjs-relativeTime.js # Day.js relative time plugin
  highcharts.js         # Highcharts (local CDN copy)
```

### Troubleshooting

- **Dataset not found**: Create a project Dataset so the mounted path exists under `/domino/datasets/local/`.
- **Missing API key**: Set `DOMINO_USER_API_KEY` in the environment before starting.
- **401/403 errors**: Ensure the API key is valid and has permission to call the Audit Trail API.
- **No events returned**: Confirm the selected date range; try expanding the window.
- **DuckDB missing in Explore tab**: Install `requirements.txt` into your environment so `duckdb` and `pyarrow` are available.
- **Keycloak not configured**: The Login Audit tab requires `KEYCLOAK_HOST` and `KEYCLOAK_PASSWORD` environment variables. Without them, use Dummy Data mode.
