#!/usr/bin/env python3
"""Domino Audit Trail Exporter — FastAPI backend."""

import os
import json
import time
import glob
import datetime
from urllib.parse import urlparse

import requests
import pandas as pd
from io import BytesIO
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response

app = FastAPI()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_DATASETS_ROOT = "/domino/datasets"
PAGE_SIZE = 1000

# ---------------------------------------------------------------------------
# Host detection helpers
# ---------------------------------------------------------------------------

def _looks_internal(host: str) -> bool:
    h = host.lower()
    return "nucleus-frontend" in h or "domino-platform" in h


def get_default_domino_host() -> str:
    raw_candidates = [
        os.environ.get("DOMINO_API_HOST"),
        os.environ.get("DOMINO_URL"),
        os.environ.get("DOMINO_HOST"),
        os.environ.get("DOMINO_DNS_NAME"),
        os.environ.get("DOMINO_DOMAIN"),
        os.environ.get("DOMINO_RUN_PUBLIC_URL"),
        os.environ.get("DOMINO_APP_URL"),
        os.environ.get("DOMINO_RUN_URL"),
    ]
    candidates = []
    for c in raw_candidates:
        if not c:
            continue
        c = c.strip()
        if c.startswith("http://") or c.startswith("https://"):
            try:
                parsed = urlparse(c)
                if parsed.scheme and parsed.netloc:
                    candidates.append(f"{parsed.scheme}://{parsed.netloc}")
                    continue
            except Exception:
                pass
        candidates.append(c)

    for c in candidates:
        if not c:
            continue
        if _looks_internal(c):
            continue
        if c.startswith("http://") or c.startswith("https://"):
            return c.rstrip("/")
        return f"https://{c.strip().rstrip('/')}"
    return ""


def normalize_domino_host(value: str) -> str:
    if not value:
        return ""
    v = value.strip()
    if v.startswith("//"):
        v = "https:" + v
    if not (v.startswith("http://") or v.startswith("https://")):
        v = "https://" + v
    try:
        p = urlparse(v)
        if p.scheme and p.netloc:
            netloc = p.netloc
            if netloc.startswith("apps."):
                netloc = netloc[5:]
            return f"{p.scheme}://{netloc}"
    except Exception:
        pass
    return v.rstrip("/")


# ---------------------------------------------------------------------------
# Dataset helpers
# ---------------------------------------------------------------------------

def list_mounted_datasets(root_dir=DEFAULT_DATASETS_ROOT, require_writable=True):
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
                results.append({"label": label, "path": ds_path})
    except Exception:
        return []
    return results


# ---------------------------------------------------------------------------
# Audit Trail API helpers
# ---------------------------------------------------------------------------

def fetch_audit_events(domino_host, api_key, start_date=None, end_date=None,
                       max_rows=1_000_000, offset=0, page_size=PAGE_SIZE):
    all_events = []
    while len(all_events) < max_rows:
        params = {"limit": page_size, "offset": offset}
        if start_date:
            start_ms = int(datetime.datetime.combine(
                start_date, datetime.time.min
            ).timestamp() * 1000)
            params["startTimestamp"] = start_ms
        if end_date:
            end_ms = int(datetime.datetime.combine(
                end_date, datetime.time.max
            ).timestamp() * 1000)
            params["endTimestamp"] = end_ms
        endpoint = f"{domino_host}/api/audittrail/v1/auditevents"
        headers = {
            "Content-Type": "application/json",
            "X-Domino-Api-Key": api_key,
        }
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
    rows = []
    for evt in events:
        ts = evt.get("timestamp")
        date_str = None
        if ts:
            try:
                date_str = datetime.datetime.utcfromtimestamp(
                    ts / 1000
                ).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                date_str = ts

        base = {
            "Date & Time": date_str,
            "User Name": (evt.get("actor") or {}).get("name"),
            "User First Name": (evt.get("actor") or {}).get("firstName"),
            "User Last Name": (evt.get("actor") or {}).get("lastName"),
            "Event": (evt.get("action") or {}).get("eventName"),
            "Project": (evt.get("in") or {}).get("name"),
        }

        using = (evt.get("action") or {}).get("using", [])
        if using:
            sources = [u.get("id") for u in using if "id" in u]
            base["Event Source"] = ", ".join(sources)

        affecting = evt.get("affecting", [])
        type_counters = {}
        for a in affecting:
            etype = a.get("entityType", "entity")
            name = a.get("name", "")
            type_counters.setdefault(etype, 0)
            type_counters[etype] += 1
            base[f"{etype}_{type_counters[etype]}"] = name

        for k, v in (evt.get("metadata") or {}).items():
            base[f"Meta: {k}"] = v

        targets = evt.get("targets", [])
        if not targets:
            rows.append(base)
            continue

        for tgt in targets:
            tgt_base = base.copy()
            tgt_base["Target Entity Type"] = (tgt.get("entity") or {}).get("entityType")
            tgt_base["Target User"] = (tgt.get("entity") or {}).get("name")
            tgt_base["Target Entity Id"] = (tgt.get("entity") or {}).get("id")

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
                        row["Added"] = ", ".join(
                            [a.get("name", str(a)) for a in fc.get("added", [])]
                        )
                    if "removed" in fc:
                        row["Removed"] = ", ".join(
                            [r.get("name", str(r)) for r in fc.get("removed", [])]
                        )
                    rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Keycloak Login/Logout Event helpers
# ---------------------------------------------------------------------------

KEYCLOAK_EVENT_TYPES = [
    "LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR",
    "CODE_TO_TOKEN", "CODE_TO_TOKEN_ERROR",
    "CLIENT_LOGIN", "CLIENT_LOGIN_ERROR",
]

LOGIN_EVENT_TYPES = ["LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR"]


def _get_keycloak_admin():
    """Create a KeycloakAdmin client using env vars. Returns (admin, realm)."""
    from keycloak import KeycloakAdmin as KCAdmin

    host = os.environ.get("KEYCLOAK_HOST", "")
    username = os.environ.get("KEYCLOAK_USERNAME", "keycloak")
    password = os.environ.get("KEYCLOAK_PASSWORD", "")
    realm = os.environ.get("KEYCLOAK_REALM", "DominoRealm")

    if not host or not password:
        return None, realm

    server_url = host if host.startswith("http") else f"http://{host}"
    if not server_url.endswith("/auth/"):
        server_url = server_url.rstrip("/") + "/auth/"

    admin = KCAdmin(
        server_url=server_url,
        username=username,
        password=password,
        realm_name="master",
        verify=True,
    )
    return admin, realm


def _build_keycloak_user_map(admin, realm):
    """Build userId -> {username, email, firstName, lastName} lookup."""
    admin.connection.realm_name = realm
    users = admin.get_users({})
    user_map = {}
    for u in users:
        user_map[u.get("id", "")] = {
            "username": u.get("username", ""),
            "email": u.get("email", ""),
            "firstName": u.get("firstName", ""),
            "lastName": u.get("lastName", ""),
        }
    return user_map


def fetch_keycloak_login_events(
    start_date=None, end_date=None, event_types=None, max_events=100_000
):
    """Fetch login/logout events from Keycloak. Returns (events, user_map, error_msg)."""
    admin, realm = _get_keycloak_admin()
    if admin is None:
        return [], {}, "Keycloak not configured. Set KEYCLOAK_HOST and KEYCLOAK_PASSWORD."

    if event_types is None:
        event_types = LOGIN_EVENT_TYPES

    try:
        user_map = _build_keycloak_user_map(admin, realm)
    except Exception as e:
        return [], {}, f"Failed to fetch Keycloak users: {e}"

    admin.connection.realm_name = realm

    all_events = []
    page_size = 500
    first = 0

    while len(all_events) < max_events:
        params = {
            "type": event_types,
            "first": first,
            "max": page_size,
        }
        if start_date:
            params["dateFrom"] = start_date.isoformat()
        if end_date:
            params["dateTo"] = end_date.isoformat()

        try:
            events = admin.get_events(params)
        except Exception as e:
            if not all_events:
                return [], user_map, f"Keycloak events query failed: {e}"
            break

        if not events:
            break

        all_events.extend(events)
        first += page_size

        if len(events) < page_size:
            break

    return all_events[:max_events], user_map, None


def flatten_keycloak_events(events, user_map=None):
    """Flatten Keycloak events into the same row shape as audit trail events."""
    rows = []
    for evt in events:
        ts = evt.get("time")
        date_str = None
        if ts:
            try:
                date_str = datetime.datetime.utcfromtimestamp(
                    ts / 1000
                ).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                date_str = str(ts)

        user_id = evt.get("userId", "")
        user_info = (user_map or {}).get(user_id, {})
        username = (
            user_info.get("username")
            or (evt.get("details") or {}).get("username", "")
        )

        event_type = evt.get("type", "")
        is_error = event_type.endswith("_ERROR")

        row = {
            "Date & Time": date_str,
            "User Name": username,
            "User First Name": user_info.get("firstName", ""),
            "User Last Name": user_info.get("lastName", ""),
            "Event": event_type,
            "Event Source": "Keycloak",
            "Project": None,
            "Meta: ipAddress": evt.get("ipAddress", ""),
            "Meta: sessionId": evt.get("sessionId", ""),
            "Meta: clientId": evt.get("clientId", ""),
            "Meta: keycloakUserId": user_id,
            "Meta: email": user_info.get("email", ""),
            "Meta: outcome": "FAILURE" if is_error else "SUCCESS",
        }

        if is_error and evt.get("error"):
            row["Meta: errorReason"] = evt["error"]

        details = evt.get("details") or {}
        for k, v in details.items():
            if k != "username":
                row[f"Meta: {k}"] = v

        rows.append(row)

    return rows


def keycloak_available():
    """Check if Keycloak env vars are configured."""
    return bool(
        os.environ.get("KEYCLOAK_HOST")
        and os.environ.get("KEYCLOAK_PASSWORD")
    )


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.get("/api/config")
def get_config():
    """Return detected host, datasets, and project context."""
    datasets = list_mounted_datasets()
    # Deduplicate, prefer local/*
    temp_map = {}
    for ds in datasets:
        label, path = ds["label"], ds["path"]
        if label in temp_map:
            existing = temp_map[label]
            if existing.startswith("/domino/datasets/local/"):
                continue
            if path.startswith("/domino/datasets/local/"):
                temp_map[label] = path
        else:
            temp_map[label] = path

    ds_list = [{"label": k, "path": v} for k, v in temp_map.items()]
    filtered = [d for d in ds_list if d["label"].startswith("local/")]
    if not filtered:
        filtered = ds_list

    return {
        "dominoHost": get_default_domino_host(),
        "datasets": filtered,
        "projectOwner": os.environ.get("DOMINO_PROJECT_OWNER", ""),
        "projectName": os.environ.get("DOMINO_PROJECT_NAME", ""),
        "hasApiKey": bool(os.environ.get("DOMINO_USER_API_KEY")),
        "hasKeycloak": keycloak_available(),
    }


@app.post("/api/export")
def run_export(request_body: dict):
    """Run the audit trail export and stream progress via SSE."""
    domino_host = normalize_domino_host(
        request_body.get("dominoHost") or get_default_domino_host()
    )
    if not domino_host:
        raise HTTPException(400, "Domino Host is required.")

    api_key = request_body.get("apiKey") or os.environ.get("DOMINO_USER_API_KEY")
    if not api_key:
        raise HTTPException(400, "Missing Domino User API Key.")

    dataset_path = request_body.get("datasetPath", "")
    start_date_str = request_body.get("startDate")
    end_date_str = request_body.get("endDate")
    max_rows = int(request_body.get("maxRows", 1_000_000))

    start_date = (
        datetime.date.fromisoformat(start_date_str) if start_date_str else
        datetime.date.today() - datetime.timedelta(days=30)
    )
    end_date = (
        datetime.date.fromisoformat(end_date_str) if end_date_str else
        datetime.date.today()
    )

    today = datetime.datetime.utcnow().strftime("%Y%m%d")

    # Fetch events
    try:
        events = fetch_audit_events(
            domino_host=domino_host,
            api_key=api_key,
            start_date=start_date,
            end_date=end_date,
            max_rows=max_rows,
        )
    except requests.HTTPError as http_err:
        if http_err.response is not None and http_err.response.status_code == 401:
            raise HTTPException(
                401,
                "Unauthorized. Verify your API key has audit trail access."
            )
        raise HTTPException(502, f"API error: {http_err}")

    if not events:
        return {"status": "empty", "message": "No audit events found for the given date range.", "eventCount": 0}

    rows = flatten_events(events)
    df = pd.DataFrame(rows)

    if "Date & Time" in df.columns:
        sort_ts = pd.to_datetime(df["Date & Time"], errors="coerce", utc=True)
        df = (
            df.assign(__sort_ts=sort_ts)
            .sort_values("__sort_ts", ascending=False)
            .drop(columns=["__sort_ts"])
            .reset_index(drop=True)
        )

    files_saved = []

    # Save to dataset if path provided and writable
    if dataset_path and os.path.isdir(dataset_path) and os.access(dataset_path, os.W_OK):
        # JSON
        json_path = os.path.join(dataset_path, f"audit_full_metadata_{today}.json")
        with open(json_path, "w") as f:
            json.dump(events, f, indent=2)
        files_saved.append(json_path)

        # Parquet
        try:
            parquet_root = os.path.join(dataset_path, "parquet")
            os.makedirs(parquet_root, exist_ok=True)
            if "Date & Time" in df.columns:
                df["_date"] = pd.to_datetime(
                    df["Date & Time"], errors="coerce"
                ).dt.date.astype(str)
            else:
                df["_date"] = today
            for part_date, part_df in df.groupby("_date"):
                day_dir = os.path.join(
                    parquet_root, f"date={part_date.replace('-', '')}"
                )
                os.makedirs(day_dir, exist_ok=True)
                pq_path = os.path.join(
                    day_dir, f"audit_full_metadata_{today}.parquet"
                )
                part_df.drop(columns=["_date"], errors="ignore").to_parquet(
                    pq_path, index=False
                )
            files_saved.append(parquet_root)
        except Exception as e:
            print(f"Parquet write skipped: {e}")

        # CSV
        csv_path = os.path.join(
            dataset_path, f"audit_full_metadata_friendly_{today}.csv"
        )
        df_out = df.drop(columns=["_date"], errors="ignore")
        df_out.to_csv(csv_path, index=False)
        files_saved.append(csv_path)

    # Always return CSV data for browser download
    csv_data = df.drop(columns=["_date"], errors="ignore").to_csv(index=False)

    return {
        "status": "ok",
        "eventCount": len(events),
        "rowCount": len(df),
        "filesSaved": files_saved,
        "csvData": csv_data,
        "previewRows": json.loads(
            df.drop(columns=["_date"], errors="ignore").head(200).to_json(
                orient="records"
            )
        ),
        "columns": list(df.drop(columns=["_date"], errors="ignore").columns),
    }


# ---------------------------------------------------------------------------
# PDF generation — 21 CFR Part 11 style flat audit log
# ---------------------------------------------------------------------------

_PDF_CORE_COLS = ["Date & Time", "User Name", "Event", "Project", "Target"]


def _derive_target(row):
    """Best-effort target string from Target Entity Type / Target User / affecting cols."""
    parts = []
    if row.get("Target Entity Type"):
        parts.append(str(row["Target Entity Type"]))
    if row.get("Target User"):
        parts.append(str(row["Target User"]))
    if not parts:
        # Fall back to any affecting_* columns
        for k, v in row.items():
            if k.startswith(("environment_", "hardwareTier_", "dataset_", "model_")) and v:
                parts.append(str(v))
                break
    return " / ".join(parts) if parts else ""


def generate_audit_pdf(rows, columns, meta=None):
    """Generate a 21 CFR Part 11 style audit trail PDF.

    Returns PDF bytes.  Uses landscape A4, fixed 6-column layout:
    Date & Time | User | Event | Project | Target | Detail
    """
    from fpdf import FPDF

    meta = meta or {}

    class AuditPDF(FPDF):
        def header(self):
            self.set_font("Helvetica", "B", 10)
            self.cell(0, 6, "Domino Audit Trail Report", new_x="LMARGIN", new_y="NEXT")
            self.set_font("Helvetica", "", 7)
            gen = meta.get("generated", datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"))
            self.cell(0, 4, f"Generated: {gen}    Records: {meta.get('records', len(rows))}    "
                      f"Date range: {meta.get('dateRange', 'N/A')}    "
                      f"System: {meta.get('system', 'Domino')}", new_x="LMARGIN", new_y="NEXT")
            self.ln(2)

        def footer(self):
            self.set_y(-12)
            self.set_font("Helvetica", "I", 7)
            self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", align="C")

    pdf = AuditPDF(orientation="L", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Column widths for landscape A4 (297mm usable ~277mm with margins)
    col_widths = [38, 28, 40, 30, 35, 106]  # total = 277
    col_headers = ["Date & Time", "User", "Event", "Project", "Target", "Detail"]

    # Table header
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_fill_color(250, 250, 250)
    pdf.set_draw_color(200, 200, 200)
    for i, hdr in enumerate(col_headers):
        pdf.cell(col_widths[i], 6, hdr, border=1, fill=True)
    pdf.ln()

    # Table rows
    pdf.set_font("Helvetica", "", 6.5)
    core_set = set(_PDF_CORE_COLS + ["Target Entity Type", "Target User", "Target Entity Id",
                                      "User First Name", "User Last Name", "Event Source",
                                      "Field Changed", "Field Type", "Before", "After",
                                      "Added", "Removed"])

    for row in rows:
        dt = str(row.get("Date & Time") or "")
        user = str(row.get("User Name") or "")
        event = str(row.get("Event") or "")
        project = str(row.get("Project") or "")
        target = _derive_target(row)

        # Build detail from field changes + metadata
        detail_parts = []
        if row.get("Field Changed"):
            fc = str(row["Field Changed"])
            before = row.get("Before", "")
            after = row.get("After", "")
            added = row.get("Added", "")
            removed = row.get("Removed", "")
            if before or after:
                fc += f' "{before}" -> "{after}"'
            if added:
                fc += f" +[{added}]"
            if removed:
                fc += f" -[{removed}]"
            detail_parts.append(fc)

        # Append metadata fields
        for k, v in row.items():
            if k.startswith("Meta: ") and v is not None and str(v) != "":
                detail_parts.append(f"{k[6:]}: {str(v)[:120]}")

        # Any remaining non-core fields
        for k, v in row.items():
            if k not in core_set and not k.startswith("Meta: ") and v is not None and str(v) != "":
                detail_parts.append(f"{k}: {str(v)[:120]}")

        detail = "; ".join(detail_parts)

        vals = [dt[:19], user[:30], event[:45], project[:30], target[:40], detail]

        # Calculate row height based on detail length
        detail_lines = pdf.multi_cell(col_widths[5], 4, detail, dry_run=True, output="LINES")
        row_h = max(6, len(detail_lines) * 4)

        # Check if we need a new page
        if pdf.get_y() + row_h > pdf.h - 15:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 7)
            pdf.set_fill_color(250, 250, 250)
            for i, hdr in enumerate(col_headers):
                pdf.cell(col_widths[i], 6, hdr, border=1, fill=True)
            pdf.ln()
            pdf.set_font("Helvetica", "", 6.5)

        y_start = pdf.get_y()
        x_start = pdf.get_x()

        # Fixed-height cells for first 5 columns
        for i in range(5):
            pdf.set_xy(x_start + sum(col_widths[:i]), y_start)
            pdf.cell(col_widths[i], row_h, vals[i], border=1)

        # Multi-cell for detail column
        pdf.set_xy(x_start + sum(col_widths[:5]), y_start)
        pdf.multi_cell(col_widths[5], 4, detail, border=1)

        # Ensure we're at the right Y position
        pdf.set_y(y_start + row_h)

    # End-of-report marker
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(0, 6, "--- End of Report ---", align="C")

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()


@app.post("/api/export-pdf")
def export_pdf(request_body: dict):
    """Generate a 21 CFR Part 11 compliant PDF audit trail report."""
    rows = request_body.get("rows", [])
    columns = request_body.get("columns", [])
    meta = request_body.get("meta", {})

    if not rows:
        raise HTTPException(400, "No rows to export.")

    try:
        pdf_bytes = generate_audit_pdf(rows, columns, meta)
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")

    today = datetime.datetime.utcnow().strftime("%Y%m%d")
    filename = f"audit_trail_report_{today}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/login-events")
def get_login_events(request_body: dict):
    """Fetch login/logout events from Keycloak for 21 CFR Part 11 compliance."""
    start_date_str = request_body.get("startDate")
    end_date_str = request_body.get("endDate")
    event_types = request_body.get("eventTypes", LOGIN_EVENT_TYPES)
    max_events = int(request_body.get("maxEvents", 100_000))
    include_all_auth = request_body.get("includeAllAuth", False)

    start_date = (
        datetime.date.fromisoformat(start_date_str) if start_date_str else
        datetime.date.today() - datetime.timedelta(days=30)
    )
    end_date = (
        datetime.date.fromisoformat(end_date_str) if end_date_str else
        datetime.date.today()
    )

    if include_all_auth:
        event_types = KEYCLOAK_EVENT_TYPES

    raw_events, user_map, error_msg = fetch_keycloak_login_events(
        start_date=start_date,
        end_date=end_date,
        event_types=event_types,
        max_events=max_events,
    )

    if error_msg and not raw_events:
        raise HTTPException(502, error_msg)

    if not raw_events:
        return {
            "status": "empty",
            "message": "No login events found for the given date range.",
            "eventCount": 0,
            "rows": [],
            "columns": [],
        }

    rows = flatten_keycloak_events(raw_events, user_map)
    df = pd.DataFrame(rows)

    if "Date & Time" in df.columns:
        sort_ts = pd.to_datetime(df["Date & Time"], errors="coerce", utc=True)
        df = (
            df.assign(__sort_ts=sort_ts)
            .sort_values("__sort_ts", ascending=False)
            .drop(columns=["__sort_ts"])
            .reset_index(drop=True)
        )

    # Rollups
    event_counts = df["Event"].value_counts().head(20)
    event_rollup = [{"Event": k, "count": int(v)} for k, v in event_counts.items()]

    user_counts = df["User Name"].value_counts().head(20)
    actor_rollup = [{"actor": k, "count": int(v)} for k, v in user_counts.items()]

    # Outcome rollup (success vs failure)
    outcome_col = "Meta: outcome"
    outcome_rollup = []
    if outcome_col in df.columns:
        oc = df[outcome_col].value_counts()
        outcome_rollup = [{"outcome": k, "count": int(v)} for k, v in oc.items()]

    # Hourly distribution
    hourly_rollup = []
    if "Date & Time" in df.columns:
        hours = pd.to_datetime(df["Date & Time"], errors="coerce").dt.hour
        hc = hours.value_counts().sort_index()
        hourly_rollup = [{"hour": int(k), "count": int(v)} for k, v in hc.items()]

    csv_data = df.to_csv(index=False)
    preview = json.loads(df.head(500).to_json(orient="records"))

    return {
        "status": "ok",
        "eventCount": len(raw_events),
        "rowCount": len(df),
        "rows": preview,
        "columns": list(df.columns),
        "csvData": csv_data,
        "eventRollup": event_rollup,
        "actorRollup": actor_rollup,
        "outcomeRollup": outcome_rollup,
        "hourlyRollup": hourly_rollup,
        "warning": error_msg,
    }


@app.post("/api/explore")
def explore_data(request_body: dict):
    """Query previously exported Parquet files."""
    dataset_path = request_body.get("datasetPath", "")
    start_date = request_body.get("startDate", "")
    end_date = request_body.get("endDate", "")
    limit = int(request_body.get("limit", 5000))

    parquet_dir = os.path.join(dataset_path, "parquet") if dataset_path else ""
    if not parquet_dir or not os.path.isdir(parquet_dir):
        return {"status": "empty", "message": "No parquet directory found.", "rows": [], "columns": []}

    parquet_glob = os.path.join(parquet_dir, "**", "*.parquet")
    files = glob.glob(parquet_glob, recursive=True)
    if not files:
        return {"status": "empty", "message": "No Parquet files found. Run an export first.", "rows": [], "columns": []}

    try:
        import duckdb
        con = duckdb.connect(database=":memory:")
        base_from = f"read_parquet('{parquet_glob}', union_by_name=true)"

        where_clauses = [
            "strptime(\"Date & Time\", '%Y-%m-%d %H:%M:%S') IS NOT NULL",
        ]
        params = []
        if start_date and end_date:
            where_clauses.append(
                "strptime(\"Date & Time\", '%Y-%m-%d %H:%M:%S') BETWEEN ? AND ?"
            )
            params = [f"{start_date} 00:00:00", f"{end_date} 23:59:59"]

        where_sql = " AND ".join(where_clauses)

        # Preview
        query = f"""
            SELECT * FROM {base_from}
            WHERE {where_sql}
            ORDER BY strptime("Date & Time", '%Y-%m-%d %H:%M:%S') DESC
            LIMIT {int(limit)}
        """
        df = con.execute(query, params).df()

        # Event rollup
        q_events = f'SELECT "Event", COUNT(*) AS count FROM {base_from} WHERE {where_sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 20'
        df_events = con.execute(q_events, params).df()

        # Actor rollup
        q_actors = f'SELECT "User Name" AS actor, COUNT(*) AS count FROM {base_from} WHERE {where_sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 20'
        df_actors = con.execute(q_actors, params).df()

        return {
            "status": "ok",
            "rows": json.loads(df.to_json(orient="records")),
            "columns": list(df.columns),
            "totalRows": len(df),
            "eventRollup": json.loads(df_events.to_json(orient="records")),
            "actorRollup": json.loads(df_actors.to_json(orient="records")),
        }
    except ImportError:
        raise HTTPException(500, "DuckDB not installed. Add duckdb to requirements.txt.")
    except Exception as e:
        raise HTTPException(500, f"Query failed: {e}")


# ---------------------------------------------------------------------------
# Static files & SPA fallback
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    return HTMLResponse(open("static/index.html").read())
