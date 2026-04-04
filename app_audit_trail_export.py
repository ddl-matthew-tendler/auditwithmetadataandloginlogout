#!/usr/bin/env python3

import streamlit as st
import os
import datetime
import json
import requests
import pandas as pd
import time

# Config
API_KEY = os.environ.get("DOMINO_USER_API_KEY")

# Default paths and values
DEFAULT_DATASETS_ROOT = "/domino/datasets"
TODAY = datetime.datetime.utcnow().strftime("%Y%m%d")


def get_default_domino_host():
    """Attempt to auto-detect the Domino host from environment variables.

    Falls back to the known default if not available.
    """
    raw_candidates = [
        os.environ.get("DOMINO_API_HOST"),
        os.environ.get("DOMINO_URL"),
        os.environ.get("DOMINO_HOST"),
        os.environ.get("DOMINO_DNS_NAME"),
        os.environ.get("DOMINO_DOMAIN"),
        # Additional Domino envs that often include full URLs
        os.environ.get("DOMINO_RUN_PUBLIC_URL"),
        os.environ.get("DOMINO_APP_URL"),
        os.environ.get("DOMINO_RUN_URL"),
    ]

    # Normalize candidates to origins (scheme://host) where possible
    candidates = []
    for c in raw_candidates:
        if not c:
            continue
        c = c.strip()
        # If the value looks like a full URL, reduce to origin
        if c.startswith("http://") or c.startswith("https://"):
            try:
                # Avoid importing urllib.parse repeatedly in hot loop
                from urllib.parse import urlparse
                parsed = urlparse(c)
                if parsed.scheme and parsed.netloc:
                    candidates.append(f"{parsed.scheme}://{parsed.netloc}")
                    continue
            except Exception:
                pass
        candidates.append(c)
    def looks_internal(host: str) -> bool:
        if not host:
            return False
        h = host.lower()
        return ("nucleus-frontend" in h) or ("domino-platform" in h)

    for c in candidates:
        if not c:
            continue
        # Skip obvious internal service names
        if looks_internal(c):
            continue
        # Ensure scheme; many envs already include https://
        if c.startswith("http://") or c.startswith("https://"):
            return c.rstrip("/")
        return f"https://{c.strip().rstrip('/')}"
    # No detectable host; return empty so UI doesn't show a wrong cluster
    return ""


def normalize_domino_host(value: str) -> str:
    """Normalize a Domino host string to an origin with scheme.

    - Adds https:// if scheme missing
    - Reduces full URLs to scheme://host
    - Strips trailing slashes
    """
    if not value:
        return ""
    v = value.strip()
    if v.startswith("//"):
        v = "https:" + v
    if not (v.startswith("http://") or v.startswith("https://")):
        v = "https://" + v
    try:
        from urllib.parse import urlparse
        p = urlparse(v)
        if p.scheme and p.netloc:
            netloc = p.netloc
            # If app is hosted under apps.<domain>, call APIs on root domain
            if netloc.startswith("apps."):
                netloc = netloc[5:]
            return f"{p.scheme}://{netloc}"
    except Exception:
        pass
    return v.rstrip("/")


def get_browser_origin() -> str:
    """Best-effort read of the browser origin via a tiny JS eval component.

    Returns "" if unavailable or if the helper package is not installed.
    """
    try:
        # Imported lazily so the app still works without this optional dep
        from streamlit_js_eval import streamlit_js_eval  # type: ignore
    except Exception:
        return ""
    try:
        origin = streamlit_js_eval(js_expressions='window.location.origin', key='domino_origin')
        if isinstance(origin, str) and origin:
            return origin
    except Exception:
        return ""
    return ""


def list_mounted_datasets(root_dir=DEFAULT_DATASETS_ROOT, require_writable=True):
    """List dataset mount directories under /domino/datasets.

    Returns list of (label, path) tuples. Labels use owner/name.
    Optionally filter to writable paths.
    """
    results = []
    if not os.path.isdir(root_dir):
        return results

    try:
        for owner in sorted(os.listdir(root_dir)):
            owner_path = os.path.join(root_dir, owner)
            if not os.path.isdir(owner_path):
                continue

            for ds_name in sorted(os.listdir(owner_path)):
                ds_path = os.path.join(owner_path, ds_name)
                if not os.path.isdir(ds_path):
                    continue
                if require_writable and not os.access(ds_path, os.W_OK):
                    continue
                label = f"{owner}/{ds_name}"
                results.append((label, ds_path))
    except Exception:
        # In case of permission errors or unusual layouts, fall back to none
        return []

    return results

# ----------------------------------------------------------------------
# Core functions
# ----------------------------------------------------------------------

def fetch_audit_events(domino_host, api_key, start_date=None, end_date=None, max_rows=1_000_000, offset=0, page_size=1000):
    """Fetch audit events from Domino API with pagination"""
    all_events = []
    while len(all_events) < max_rows:
        params = {"limit": page_size, "offset": offset}
        if start_date:
            start_ms = int(datetime.datetime.combine(start_date, datetime.time.min).timestamp() * 1000)
            params["startTimestamp"] = start_ms
        if end_date:
            end_ms = int(datetime.datetime.combine(end_date, datetime.time.max).timestamp() * 1000)
            params["endTimestamp"] = end_ms
        endpoint = f"{domino_host}/api/audittrail/v1/auditevents"
        headers = {"Content-Type": "application/json", "X-Domino-Api-Key": api_key}
        resp = requests.get(endpoint, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        events = data.get("events", [])

        if not events:
            break

        all_events.extend(events)
        offset += page_size
        time.sleep(0.05)

        if len(events) < page_size:
            break

    return all_events[:max_rows]


def flatten_events(events):
    """Flatten audit events into tabular rows with metadata and entity expansion"""
    rows = []
    for evt in events:
        # Convert timestamp to human-readable UTC
        ts = evt.get("timestamp")
        date_str = None
        if ts:
            try:
                date_str = datetime.datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                date_str = ts

        base = {
            "Date & Time": date_str,
            "User Name": evt.get("actor", {}).get("name"),
            "User First Name": evt.get("actor", {}).get("firstName"),
            "User Last Name": evt.get("actor", {}).get("lastName"),
            "Event": evt.get("action", {}).get("eventName"),
            "Project": evt.get("in", {}).get("name"),
        }

        # Add Event Source(s)
        using = evt.get("action", {}).get("using", [])
        if using:
            sources = [u.get("id") for u in using if "id" in u]
            base["Event Source"] = ", ".join(sources)

        # Expand affecting[] with numbering per type
        affecting = evt.get("affecting", [])
        type_counters = {}
        for a in affecting:
            etype = a.get("entityType", "entity")
            name = a.get("name", "")
            type_counters.setdefault(etype, 0)
            type_counters[etype] += 1
            base[f"{etype}_{type_counters[etype]}"] = name

        # Add metadata dynamically
        for k, v in evt.get("metadata", {}).items():
            base[f"Meta: {k}"] = v

        targets = evt.get("targets", [])
        if not targets:
            rows.append(base)
            continue

        for tgt in targets:
            tgt_base = base.copy()
            tgt_base["Target Entity Type"] = tgt.get("entity", {}).get("entityType")
            tgt_base["Target User"] = tgt.get("entity", {}).get("name")
            tgt_base["Target Entity Id"] = tgt.get("entity", {}).get("id")

            field_changes = tgt.get("fieldChanges", [])
            if not field_changes:
                rows.append(tgt_base)
            else:
                for fc in field_changes:
                    row = tgt_base.copy()
                    row["Field Changed"] = fc.get("fieldName")
                    row["Field Type"] = fc.get("fieldType")

                    if "after" in fc:
                        row["After"] = fc.get("after")
                    if "before" in fc:
                        row["Before"] = fc.get("before")
                    if "added" in fc:
                        row["Added"] = ", ".join([a.get("name", str(a)) for a in fc.get("added", [])])
                    if "removed" in fc:
                        row["Removed"] = ", ".join([r.get("name", str(r)) for r in fc.get("removed", [])])
                    rows.append(row)
    return rows

# ----------------------------------------------------------------------
# Streamlit UI
# ----------------------------------------------------------------------

st.title("Domino Audit Trail Exporter with Full Metadata")
st.warning("⚠️ This is not an official Domino app. Expand the section below to read more.")

st.markdown("## About this app", unsafe_allow_html=True)
with st.expander("📖 Readme / Instructions"):
    st.markdown("""
    ### Domino Audit Trail Exporter

    This app allows you to export Domino Audit Trail data into JSON and CSV formats.

    **Key points:**
    - This is *not* an official Domino product.
    - It uses the official Domino Audit Trail API.
    - Data is written into a Domino Dataset that you select at runtime (no hardcoded path).
        - The dataset selector shows only the current project's datasets by default.

    **Usage:**
    1. Choose a destination Domino Dataset from the selector below.
    2. Choose start/end dates and max rows.
    3. Click **Generate Audit Trail Export**.
    4. Files will appear in the selected dataset:
       - `audit_full_metadata_YYYYMMDD.json`
       - `audit_full_metadata_friendly_YYYYMMDD.csv` (possibly split into parts if very large)

    **Notes:**
    - If your export exceeds 1M rows, the app will chunk into multiple CSV parts.
    - Metadata is flattened dynamically (so new Domino fields automatically appear).
    - Human-readable timestamps are included alongside raw metadata.

    **Support:**
    - For questions, please check your local Domino administrator.
    - This app is provided as-is, without official support.
    """)

project_owner = os.environ.get("DOMINO_PROJECT_OWNER")
project_name = os.environ.get("DOMINO_PROJECT_NAME")
if project_owner and project_name:
    st.caption(f"Project context: {project_owner}/{project_name}")

st.markdown("### Configure your export")

host_col, ds_col = st.columns(2)
with host_col:
    # Prefer browser origin when running as a Domino App; fall back to env
    browser_origin = get_browser_origin()
    detected_host = normalize_domino_host(browser_origin)
    fallback_host = get_default_domino_host()
    if detected_host:
        domino_host_input = detected_host
        st.text_input("Domino Host", value=domino_host_input, disabled=True, help="Detected from the current App URL.")
    else:
        domino_host_input = st.text_input(
            "Domino Host",
            value=fallback_host or "",
            help="Auto-detected from environment; override if needed (e.g., https://your.domino.tech)",
        )
        _h = (domino_host_input or "").lower()
        if "nucleus-frontend" in _h or "domino-platform" in _h:
            st.warning("The host looks like an internal service name. Use your external Domino URL (e.g., https://<your>.domino.tech).")
    api_key_input = st.text_input(
        "Domino User API Key",
        value=API_KEY or "",
        type="password",
        help="Provide your Domino user API key if not injected into the environment.",
    )
    # Dataset selector directly under API key
    datasets = list_mounted_datasets()
    # Deduplicate labels while preserving first path; prefer local/* entries
    temp_map = {}
    for label, path in datasets:
        # If the label already exists, prefer the one under /domino/datasets/local
        if label in temp_map:
            existing = temp_map[label]
            if existing.startswith("/domino/datasets/local/"):
                continue
            if path.startswith("/domino/datasets/local/"):
                temp_map[label] = path
        else:
            temp_map[label] = path
    ds_label_to_path = temp_map
    ds_labels_all = list(ds_label_to_path.keys())
    filtered_labels = [lbl for lbl in ds_labels_all if lbl.startswith("local/")]
    if not filtered_labels:
        filtered_labels = ds_labels_all
    selected_dataset_label = None
    if filtered_labels:
        # Prefer local/* if present
        default_index = 0
        for i, lbl in enumerate(filtered_labels):
            if lbl.startswith("local/"):
                default_index = i
                break
        selected_dataset_label = st.selectbox(
            "Select a Domino Dataset to save the extract to",
            filtered_labels,
            index=default_index,
        )
    else:
        st.info("No writable datasets detected under /domino/datasets.")
        selected_dataset_label = None

    # Swagger link below dataset selector
    # Swagger button removed per request

with ds_col:
    # Intentionally left blank in this revision to place dataset selector under API key
    pass

# Resolve dataset directory early for reuse (explore/export)
effective_dataset_dir = ds_label_to_path.get(selected_dataset_label) if 'ds_label_to_path' in globals() and selected_dataset_label else None
if effective_dataset_dir:
    st.caption(f"Destination dataset path: {effective_dataset_dir}")

tabs = st.tabs(["Export", "Explore"])

with tabs[0]:
    date_col1, date_col2 = st.columns(2)
    with date_col1:
        start_date = st.date_input("Start Date", value=datetime.date.today() - datetime.timedelta(days=30))
    with date_col2:
        end_date = st.date_input("End Date", value=datetime.date.today())

    max_rows = st.number_input("Maximum number of rows", value=1_000_000, step=100_000, min_value=1000)

    if st.button("Generate Audit Trail Export"):
        st.info("Starting export... please be patient. Large extracts may take several minutes.")

        progress = st.progress(0)
        status_text = st.empty()

        try:
            # Resolve host and dataset directory
            domino_host = normalize_domino_host(domino_host_input or get_default_domino_host())
            if not domino_host:
                st.error("Domino Host is required. Please enter your deployment URL (e.g., https://your.domino.tech).")
                st.stop()
            dataset_dir = effective_dataset_dir

            if not dataset_dir:
                st.error("No destination dataset selected or provided.")
                st.stop()

            if not os.path.exists(dataset_dir):
                st.error(f"Destination dataset path not found: {dataset_dir}")
                st.stop()
            if not os.access(dataset_dir, os.W_OK):
                st.error(f"Destination dataset path is not writable: {dataset_dir}")
                st.stop()

            # Resolve API key
            effective_api_key = api_key_input or API_KEY
            if not effective_api_key:
                st.error("Missing Domino User API Key. Please provide it above.")
                st.stop()

            # Fetch in batches with progress
            events = []
            offset = 0
            PAGE_SIZE = 1000
            while len(events) < max_rows:
                try:
                    batch = fetch_audit_events(domino_host=domino_host, api_key=effective_api_key, start_date=start_date, end_date=end_date, max_rows=PAGE_SIZE, offset=offset)
                except requests.HTTPError as http_err:
                    if http_err.response is not None and http_err.response.status_code == 401:
                        st.error("Unauthorized (401). Verify your Domino User API Key and that it has permission to read the Audit Trail API on this deployment.")
                    else:
                        st.error(f"HTTP error while calling Audit Trail API: {http_err}")
                    st.stop()
                if not batch:
                    break
                events.extend(batch)
                offset += PAGE_SIZE

                # Update progress bar
                pct_complete = min(len(events) / max_rows, 1.0)
                progress.progress(pct_complete)
                status_text.text(f"Fetched {len(events)} events...")

                if len(events) >= max_rows:
                    break

            if not events:
                st.warning("No audit events found for the given date range.")
                st.stop()

            # Summarize in final success message later

            # Save raw JSON
            json_path = os.path.join(dataset_dir, f"audit_full_metadata_{TODAY}.json")
            with open(json_path, "w") as f:
                json.dump(events, f, indent=2)

            # Flatten events
            # Prepare tabular export
            rows = flatten_events(events)
            df = pd.DataFrame(rows)

            # Sort reverse-chronologically by Date & Time
            if "Date & Time" in df.columns:
                sort_ts = pd.to_datetime(df["Date & Time"], errors="coerce", utc=True)
                df = df.assign(__sort_ts=sort_ts).sort_values("__sort_ts", ascending=False).drop(columns=["__sort_ts"]).reset_index(drop=True)

            # Save Parquet partitioned by day for scalable exploration
            try:
                parquet_root = os.path.join(dataset_dir, "parquet")
                os.makedirs(parquet_root, exist_ok=True)
                # Extract yyyy-mm-dd from Date & Time for partitioning
                if "Date & Time" in df.columns:
                    df["_date"] = pd.to_datetime(df["Date & Time"], errors="coerce").dt.date.astype(str)
                else:
                    df["_date"] = TODAY  # fallback
                for part_date, part_df in df.groupby("_date"):
                    day_dir = os.path.join(parquet_root, f"date={part_date.replace('-', '')}")
                    os.makedirs(day_dir, exist_ok=True)
                    pq_path = os.path.join(day_dir, f"audit_full_metadata_{TODAY}.parquet")
                    part_df.drop(columns=["_date"], errors="ignore").to_parquet(pq_path, index=False)
            except Exception as e:
                st.warning(f"Parquet write skipped due to error: {e}")

            # Save CSV(s) and provide download buttons
            if len(df) > max_rows:
                chunks = (len(df) // max_rows) + 1
                for i in range(chunks):
                    chunk_df = df.iloc[i*max_rows:(i+1)*max_rows]
                    csv_path = os.path.join(dataset_dir, f"audit_full_metadata_friendly_{TODAY}_part{i+1}.csv")
                    chunk_df.to_csv(csv_path, index=False)

                    with open(csv_path, "rb") as f:
                        st.download_button(
                            f"Download CSV Part {i+1}",
                            f,
                            file_name=os.path.basename(csv_path),
                            mime="text/csv"
                        )
                st.success(f"Export complete ({len(events)} events). Saved JSON, Parquet, and {chunks} CSV parts to: {dataset_dir}")
            else:
                csv_path = os.path.join(dataset_dir, f"audit_full_metadata_friendly_{TODAY}.csv")
                df.to_csv(csv_path, index=False)
                st.success(f"Export complete ({len(events)} events). Saved JSON, Parquet, and CSV to: {dataset_dir}")

                with open(csv_path, "rb") as f:
                    st.download_button(
                        "Download newest-first CSV",
                        f,
                        file_name=os.path.basename(csv_path),
                        mime="text/csv"
                    )

                # Compact context line
                if project_owner and project_name:
                    st.caption(f"Dataset: {dataset_dir} — Project: {project_owner}/{project_name}")
                else:
                    st.caption(f"Dataset: {dataset_dir}")

        except Exception as e:
            st.error(f"An error occurred: {e}")

with tabs[1]:
    st.markdown("#### Explore")
    st.caption("Use after running an export on the Export tab. Parquet files are read directly from the selected dataset.")
    if not effective_dataset_dir or not os.path.exists(effective_dataset_dir):
        st.info("Select a valid dataset path above to explore previously saved Parquet files.")
    else:
        parquet_glob = os.path.join(effective_dataset_dir, "parquet", "**", "*.parquet")
        import glob
        has_parquet = bool(glob.glob(parquet_glob, recursive=True))
        if not has_parquet:
            st.info("No Parquet files found yet. Run an export to generate Parquet under dataset/parquet/.")
        else:
            st.caption(f"Querying: {parquet_glob}")

            # Filter controls
            fcol1, fcol2, fcol3 = st.columns(3)
            with fcol1:
                explore_start = st.date_input("Explore start date", value=datetime.date.today() - datetime.timedelta(days=7), key="explore_start")
            with fcol2:
                explore_end = st.date_input("Explore end date", value=datetime.date.today(), key="explore_end")
            with fcol3:
                preview_limit = st.number_input("Preview limit", value=5000, min_value=100, max_value=50000, step=100)

            # Build DuckDB query (optional dependency)
            duckdb_available = True
            try:
                import duckdb  # type: ignore
            except Exception:
                duckdb_available = False

            if not duckdb_available:
                st.error("DuckDB is not installed in this environment. Install requirements.txt (includes duckdb, pyarrow) or run: pip install duckdb pyarrow -q")
            else:
                con = duckdb.connect(database=":memory:")

            where_clauses = [
                "strptime(\"Date & Time\", '%Y-%m-%d %H:%M:%S') IS NOT NULL",
                "strptime(\"Date & Time\", '%Y-%m-%d %H:%M:%S') BETWEEN ? AND ?",
            ]
            params = [
                f"{explore_start} 00:00:00",
                f"{explore_end} 23:59:59",
            ]

            where_sql = " AND ".join(where_clauses)
            # Use union_by_name to reconcile schema changes across daily partitions
            base_from = f"read_parquet('{parquet_glob}', union_by_name=true)"

            query_preview = f"""
                SELECT *
                FROM {base_from}
                WHERE {where_sql}
                ORDER BY strptime(\"Date & Time\", '%Y-%m-%d %H:%M:%S') DESC
                LIMIT {int(preview_limit)}
            """

            with st.spinner("Running preview query..."):
                try:
                    df_preview = con.execute(query_preview, params).df()
                    st.dataframe(df_preview, use_container_width=True, height=420)
                except Exception as e:
                    st.error(f"Preview query failed: {e}")
                    st.info("Tip: This can happen if different Parquet files have slightly different schemas. We now enable union_by_name to reconcile columns across files.")

            # Rollups
            rcol1, rcol2 = st.columns(2)
            with rcol1:
                q_events = f"SELECT \"Event\", COUNT(*) AS n FROM {base_from} WHERE {where_sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
                try:
                    st.markdown("##### Top events")
                    st.dataframe(con.execute(q_events, params).df(), use_container_width=True, height=300)
                except Exception as e:
                    st.warning(f"Event rollup failed: {e}")
            with rcol2:
                q_actors = f"SELECT \"User Name\" AS actor, COUNT(*) AS n FROM {base_from} WHERE {where_sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
                try:
                    st.markdown("##### Top actors")
                    st.dataframe(con.execute(q_actors, params).df(), use_container_width=True, height=300)
                except Exception as e:
                    st.warning(f"Actor rollup failed: {e}")

            # Export filtered subset
            st.markdown("#### Export filtered subset")
            export_sub_col1, export_sub_col2 = st.columns(2)
            ts_suffix = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            subset_dir = os.path.join(effective_dataset_dir, "explore_exports")
            os.makedirs(subset_dir, exist_ok=True)

            if export_sub_col1.button("Save subset to CSV"):
                csv_out = os.path.join(subset_dir, f"audit_subset_{ts_suffix}.csv")
                try:
                    con.execute(f"COPY (SELECT * FROM {base_from} WHERE {where_sql}) TO ? WITH (FORMAT CSV, HEADER TRUE)", params + [csv_out])
                    st.success(f"Saved CSV subset to: {csv_out}")
                except Exception as e:
                    st.error(f"Subset CSV export failed: {e}")

            if export_sub_col2.button("Save subset to Parquet"):
                pq_out = os.path.join(subset_dir, f"audit_subset_{ts_suffix}.parquet")
                try:
                    con.execute(f"COPY (SELECT * FROM {base_from} WHERE {where_sql}) TO ? (FORMAT PARQUET)", params + [pq_out])
                    st.success(f"Saved Parquet subset to: {pq_out}")
                except Exception as e:
                    st.error(f"Subset Parquet export failed: {e}")

    # Schedule tab removed per request

# ----------------------------------------------------------------------
# Self-bootstrap for Domino
# ----------------------------------------------------------------------
if __name__ == "__main__":
    import subprocess
    import sys
    port = os.environ.get("DOMINO_APP_PORT", "8888")
    subprocess.run([
        "streamlit", "run", sys.argv[0],
        "--server.port", port,
        "--server.address", "0.0.0.0"
    ])
