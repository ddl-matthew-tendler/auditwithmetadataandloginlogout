## Domino Audit Trail Export (Full Metadata) – Streamlit App

Currently, Domino's unified audit trail provides additional metadata for Audit Events that is only available by clicking into each event and viewing its attributes. Those attributes are not included in the native CSV Download extract. This app allows the admin user to export Domino Audit Trail events to JSON and CSV with FULL human-friendly metadata and attributes.  This Streamlit app calls the Domino Audit Trail API, flattens event structures (including metadata and affected entities), and writes results to a Domino Dataset for download and analysis.

> Note: This is not an official Domino product. It is provided as-is and has not been formally validated. Screenshots below:

> <img width="558" height="567" alt="image" src="https://github.com/user-attachments/assets/c553fc0e-b99c-4039-93b8-9404bbd2568d" />


<img width="543" height="549" alt="image" src="https://github.com/user-attachments/assets/92b91dad-f342-4bd8-b589-8358b429ba47" />


### Features
- **Full metadata flattening**: dynamic inclusion of `metadata` fields and affected entities.
- **Human-readable timestamps**: UTC string alongside raw metadata.
- **Large exports**: fetches in pages; can chunk CSV output when very large.
- **Domino Dataset output**: saves JSON and CSV into a project dataset for easy access.

### Requirements
- Python 3.8+
- Packages: `streamlit`, `requests`, `pandas`, `duckdb`, `pyarrow`, `streamlit-js-eval`
- Domino user API key exposed via environment variable `DOMINO_USER_API_KEY` (or enter it in the UI)
- Access to a Domino deployment and its Audit Trail API

### Configuration
- **Domino host**: When run as a Domino App, the host is auto-detected from the browser origin (and sanitized), so no code edits are required. When running locally, enter your Domino URL in the UI.
- **API key**: Provide `DOMINO_USER_API_KEY` via environment or enter it in the UI.
- **Dataset selection**: You choose a mounted Domino Dataset from a dropdown in the app. No hardcoded dataset path is required.
- **Fetch settings**: Pagination size is 1000 per request. The UI lets you choose a date range and `Maximum number of rows` (default 1,000,000).

### Output files
Written into the selected Domino Dataset:
- `audit_full_metadata_YYYYMMDD.json`
- `parquet/date=YYYYMMDD/audit_full_metadata_YYYYMMDD.parquet` (partitioned by day)
- `audit_full_metadata_friendly_YYYYMMDD.csv`
- If very large: `audit_full_metadata_friendly_YYYYMMDD_partN.csv`

### CSV columns (high level)
- Core: `Date & Time`, `User Name`, `User First Name`, `User Last Name`, `Event`, `Project`, `Event Source`
- Targets: `Target Entity Type`, `Target User`, `Target Entity Id`
- Field changes (when present): `Field Changed`, `Field Type`, `Before`, `After`, `Added`, `Removed`
- Dynamic entity expansions: `<entityType>_1`, `<entityType>_2`, ... (from `affecting[]`)
- Dynamic metadata expansions: `Meta: <key>` for each key in `metadata`

### Running on Domino (recommended)
1. Ensure a user API key is available as an environment variable `DOMINO_USER_API_KEY` in your workspace or app environment (or be ready to paste it into the UI).
2. Add this script as an App (Streamlit). The script self-starts Streamlit on `DOMINO_APP_PORT` when launched by Domino.
3. Open the App. The Domino Host field will be pre-filled from the page origin. Select a destination dataset, date range, and max rows; click "Generate Audit Trail Export".

### Running locally (for testing)
This app targets Domino environments (dataset mounts, auth). You can still run locally for development:

1. Install dependencies and activate a virtual environment:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

2. Provide your Domino user API key:

```bash
export DOMINO_USER_API_KEY=your_api_key_here
```

3. Prepare output directory: on local runs, set a writable path in the UI’s dataset field or create a matching local path.

4. Run the app:

```bash
streamlit run app_audit_trail_export.py
```

### Using the app
- **Configure**: Choose Start Date, End Date, and `Maximum number of rows`.
- **Run export**: Click "Generate Audit Trail Export". A compact progress message displays while fetching pages from the API.
- **Results**: A raw JSON export, Parquet partitions, and a flattened CSV are written to the dataset. If the CSV is large, it is split into parts. A download button will appear in the UI.

### Limits and notes
- The app fetches in pages of 1000. Very large ranges can take minutes.
- If you cap `Maximum number of rows`, the app stops once that many events are fetched.
- Dynamic structures: new Domino metadata keys automatically appear as `Meta: <key>` columns.
- If no events are in the range, the app will report that nothing was found.
 - Explore tab reads the Parquet files in the selected dataset. Run an export first for the dataset you want to explore.

### Troubleshooting
- **Dataset not found**: Create a project Dataset named `fullauditextracts` so the path `/domino/datasets/local/fullauditextracts` exists.
- **Missing API key**: Set `DOMINO_USER_API_KEY` in the environment before starting.
- **401/403 errors**: Ensure the API key is valid and has permission to call the Audit Trail API.
- **Wrong host**: Update `DOMINO_HOST` to the correct Domino base URL for your deployment.
- **No events returned**: Confirm the selected date range; try expanding the window.
 - **Explore shows DuckDB missing**: Install requirements.txt into your environment so `duckdb` and `pyarrow` are available.

### Development
- Primary script: `app_audit_trail_export.py`
- Key functions: fetching with pagination, event flattening, and Streamlit UI.
- Adjust constants (`DOMINO_HOST`, `DATASET_DIR`) as needed for your environment.

