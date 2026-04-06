#!/usr/bin/env python3
"""Domino Audit Trail Exporter — FastAPI backend."""

import os
import json
import time
import logging
import datetime
from urllib.parse import urlparse

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

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


KEYCLOAK_PROBE_CANDIDATES = [
    "http://keycloak-http.domino-platform:80",
    "http://keycloak-http.domino-platform.svc.cluster.local:80",
    "http://keycloak-http:80",
]

# Keycloak 17+ (Quarkus) removed the /auth/ prefix; try both
KEYCLOAK_PATH_VARIANTS = ["/auth/", "/"]


def _probe_keycloak_host(candidates=None, timeout=3):
    """Try to find a reachable Keycloak host. Returns (host, path_prefix) or (None, None)."""
    candidates = candidates or KEYCLOAK_PROBE_CANDIDATES
    for candidate in candidates:
        for path in KEYCLOAK_PATH_VARIANTS:
            url = candidate.rstrip("/") + path
            try:
                r = requests.get(url, timeout=timeout, verify=False)
                logger.info("Keycloak probe %s -> status %s", url, r.status_code)
                if r.status_code < 400:
                    return candidate, path
            except Exception as e:
                logger.info("Keycloak probe %s -> failed: %s", url, e)
    return None, None


def _get_keycloak_admin():
    """Create a KeycloakAdmin client using env vars with auto-detection fallback.
    Returns (admin, realm)."""
    from keycloak import KeycloakAdmin as KCAdmin

    host = os.environ.get("KEYCLOAK_HOST", "").strip()
    username = os.environ.get("KEYCLOAK_USERNAME", "keycloak").strip()
    password = os.environ.get("KEYCLOAK_PASSWORD", "").strip()
    realm = os.environ.get("KEYCLOAK_REALM", "DominoRealm").strip()

    logger.info("Keycloak config: host=%s, username=%s, password=%s, realm=%s",
                host or "(auto-detect)", username, "set" if password else "NOT SET", realm)

    # Auto-detect Keycloak host — try internal service URLs first, then
    # fall back to the external Domino host (which also proxies /auth/)
    detected_path = "/auth/"
    if not host:
        # Build candidate list: internal k8s services + external Domino URL
        candidates = list(KEYCLOAK_PROBE_CANDIDATES)
        domino_host = get_default_domino_host()
        if domino_host:
            candidates.append(domino_host)
        host, detected_path = _probe_keycloak_host(candidates=candidates)
        if host:
            logger.info("Keycloak auto-detected at %s (path: %s)", host, detected_path)
        else:
            logger.warning("Keycloak auto-detection failed — none of the probe URLs responded")

    if not host or not password:
        logger.warning("Keycloak not configured: host=%s, password=%s", host or "NONE", "set" if password else "NOT SET")
        return None, realm

    server_url = host if host.startswith("http") else f"http://{host}"
    server_url = server_url.rstrip("/") + (detected_path or "/auth/")

    # Get token manually via raw HTTP POST — the python-keycloak library's
    # built-in auth sends requests differently and fails on some deployments
    # even when the token endpoint works fine with direct requests.
    token_data = None
    token_error = None
    for auth_realm in ["master", realm]:
        token_url = f"{server_url}realms/{auth_realm}/protocol/openid-connect/token"
        logger.info("Requesting token from %s as user '%s'", token_url, username)
        try:
            r = requests.post(token_url, data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": username,
                "password": password,
            }, timeout=10, verify=False)
            if r.status_code == 200:
                token_data = r.json()
                logger.info("Got token from realm '%s' (expires_in=%s)",
                             auth_realm, token_data.get("expires_in"))
                break
            else:
                token_error = f"realm='{auth_realm}': {r.status_code} {r.text[:200]}"
                logger.info("Token request failed for %s", token_error)
        except Exception as e:
            token_error = f"realm='{auth_realm}': {e}"
            logger.info("Token request error: %s", token_error)

    if not token_data:
        raise Exception(f"Could not get token — {token_error}")

    # Create KeycloakAdmin with the manually obtained token
    try:
        admin = KCAdmin(
            server_url=server_url,
            token=token_data,
            realm_name=realm,
            verify=False,
        )
        # Verify access by fetching one user
        admin.get_users({"max": 1})
        logger.info("Keycloak admin connection successful with manual token")
        return admin, realm
    except Exception as e:
        logger.error("KeycloakAdmin with manual token failed: %s", e)
        raise


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

    # Deduplicate events – Keycloak can return the same event more than once
    # (e.g. multiple client-level records for a single user login).
    seen = set()
    deduped = []
    for evt in all_events[:max_events]:
        key = (
            evt.get("time"),
            evt.get("userId", ""),
            evt.get("type", ""),
            evt.get("sessionId", ""),
            evt.get("ipAddress", ""),
        )
        if key not in seen:
            seen.add(key)
            deduped.append(evt)

    return deduped, user_map, None


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
    """Check if Keycloak is reachable (env vars or auto-detected host + password)."""
    password = os.environ.get("KEYCLOAK_PASSWORD", "")
    if not password:
        logger.info("keycloak_available: KEYCLOAK_PASSWORD not set")
        return False

    host = os.environ.get("KEYCLOAK_HOST", "")
    if host:
        logger.info("keycloak_available: explicit host=%s, password=set -> True", host)
        return True

    # Try auto-detect using the same candidates as _get_keycloak_admin
    candidates = list(KEYCLOAK_PROBE_CANDIDATES)
    domino_host = get_default_domino_host()
    if domino_host:
        candidates.append(domino_host)
    detected_host, detected_path = _probe_keycloak_host(candidates=candidates)
    if detected_host:
        logger.info("keycloak_available: auto-detected host=%s (path=%s) -> True", detected_host, detected_path)
        return True

    logger.info("keycloak_available: auto-detection failed, no reachable host")
    return False


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.get("/api/config")
def get_config():
    """Return detected host and project context."""
    return {
        "dominoHost": get_default_domino_host(),
        "projectOwner": os.environ.get("DOMINO_PROJECT_OWNER", ""),
        "projectName": os.environ.get("DOMINO_PROJECT_NAME", ""),
        "hasApiKey": bool(os.environ.get("DOMINO_USER_API_KEY")),
        "hasKeycloak": keycloak_available(),
    }


@app.get("/api/keycloak-status")
def keycloak_status():
    """Diagnostic endpoint — tests Keycloak connectivity step by step."""
    status = {
        "passwordSet": bool(os.environ.get("KEYCLOAK_PASSWORD")),
        "hostExplicit": os.environ.get("KEYCLOAK_HOST", "") or None,
        "hostAutoDetected": None,
        "pathVariant": None,
        "reachable": False,
        "authSuccess": False,
        "realmAccessible": False,
        "userCount": None,
        "eventSample": None,
        "error": None,
    }

    if not status["passwordSet"]:
        status["error"] = (
            "KEYCLOAK_PASSWORD environment variable is not set. "
            "Set it in Domino Account Settings → User Environment Variables, "
            "then restart this app."
        )
        return status

    # Step 1: find reachable host
    host = os.environ.get("KEYCLOAK_HOST", "")
    path_variant = "/auth/"
    if host:
        status["hostExplicit"] = host
    else:
        detected, detected_path = _probe_keycloak_host()
        if detected:
            host = detected
            path_variant = detected_path
            status["hostAutoDetected"] = detected
            status["pathVariant"] = detected_path
        else:
            status["error"] = (
                "Keycloak host auto-detection failed. None of the internal service URLs responded: "
                + ", ".join(KEYCLOAK_PROBE_CANDIDATES)
                + ". If Keycloak uses a custom service name, set KEYCLOAK_HOST explicitly."
            )
            return status

    status["reachable"] = True

    # Step 1b: raw token test to show exactly what the token endpoint returns
    password = os.environ.get("KEYCLOAK_PASSWORD", "")
    username = os.environ.get("KEYCLOAK_USERNAME", "keycloak")
    server_url = (host if host.startswith("http") else f"http://{host}").rstrip("/")
    server_url += path_variant or "/auth/"
    token_url = f"{server_url}realms/master/protocol/openid-connect/token"
    raw_token_tests = []
    for client_id in ["admin-cli", "security-admin-console"]:
        try:
            r = requests.post(token_url, data={
                "grant_type": "password",
                "client_id": client_id,
                "username": username,
                "password": password,
            }, timeout=5, verify=False)
            raw_token_tests.append({
                "client_id": client_id,
                "status": r.status_code,
                "response": r.text[:300],
            })
        except Exception as e:
            raw_token_tests.append({
                "client_id": client_id,
                "status": "error",
                "response": str(e)[:300],
            })
    status["tokenTests"] = raw_token_tests

    # Step 2: test auth + realm access (_get_keycloak_admin tries multiple strategies)
    try:
        admin, realm = _get_keycloak_admin()
        if admin is None:
            status["error"] = "Admin connection returned None — check host and password."
            return status
        status["authSuccess"] = True
        status["realmAccessible"] = True
    except Exception as e:
        status["error"] = f"Authentication/realm access failed: {e}"
        return status

    # Step 3: count users to verify depth of access
    try:
        users = admin.get_users({"max": 5})
        status["userCount"] = len(users)
    except Exception as e:
        status["error"] = f"User query in realm '{realm}' failed: {e}"
        return status

    # Step 4: test event query
    try:
        events = admin.get_events({"max": 1, "type": ["LOGIN"]})
        status["eventSample"] = len(events)
    except Exception as e:
        status["error"] = f"Event query failed (auth works, but events API error): {e}"
        return status

    return status


# ---------------------------------------------------------------------------
# Keycloak Event Config Management
# ---------------------------------------------------------------------------

RECOMMENDED_EVENT_TYPES = [
    "LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR",
    "CODE_TO_TOKEN", "CODE_TO_TOKEN_ERROR",
    "REGISTER", "REGISTER_ERROR",
]

DEFAULT_EVENTS_EXPIRATION = 7_776_000  # 90 days in seconds


def _get_keycloak_token_and_url():
    """Get a raw access token and the server URL for direct REST API calls."""
    host = os.environ.get("KEYCLOAK_HOST", "").strip()
    username = os.environ.get("KEYCLOAK_USERNAME", "keycloak").strip()
    password = os.environ.get("KEYCLOAK_PASSWORD", "").strip()
    realm = os.environ.get("KEYCLOAK_REALM", "DominoRealm").strip()

    if not password:
        return None, None, realm, "KEYCLOAK_PASSWORD not set"

    detected_path = "/auth/"
    if not host:
        candidates = list(KEYCLOAK_PROBE_CANDIDATES)
        domino_host = get_default_domino_host()
        if domino_host:
            candidates.append(domino_host)
        host, detected_path = _probe_keycloak_host(candidates=candidates)

    if not host:
        return None, None, realm, "Keycloak host not found"

    server_url = (host if host.startswith("http") else f"http://{host}").rstrip("/")
    server_url += detected_path or "/auth/"

    # Get token
    token_url = f"{server_url}realms/master/protocol/openid-connect/token"
    try:
        r = requests.post(token_url, data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": username,
            "password": password,
        }, timeout=10, verify=False)
        if r.status_code == 200:
            token = r.json()["access_token"]
            return token, server_url, realm, None
        return None, server_url, realm, f"Token request failed: {r.status_code}"
    except Exception as e:
        return None, server_url, realm, f"Token request error: {e}"


@app.get("/api/keycloak-events-config")
def get_keycloak_events_config():
    """Get the current Keycloak event configuration for the target realm."""
    token, server_url, realm, error = _get_keycloak_token_and_url()
    if error:
        raise HTTPException(502, error)

    url = f"{server_url}admin/realms/{realm}/events/config"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, verify=False, timeout=10)
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Failed to get event config: {r.text[:300]}")

    config = r.json()

    # Build a direct link to the Keycloak admin console Events page
    # Try external Domino host first (user-accessible), fall back to internal
    domino_host = get_default_domino_host()
    if domino_host:
        console_url = f"{domino_host}/auth/admin/master/console/#{realm}/realm-settings/events"
    else:
        console_url = None

    return {
        "eventsEnabled": config.get("eventsEnabled", False),
        "eventsExpiration": config.get("eventsExpiration", 0),
        "enabledEventTypes": config.get("enabledEventTypes", []),
        "eventsListeners": config.get("eventsListeners", []),
        "adminEventsEnabled": config.get("adminEventsEnabled", False),
        "adminEventsDetailsEnabled": config.get("adminEventsDetailsEnabled", False),
        "consoleUrl": console_url,
        "realm": realm,
    }


@app.post("/api/keycloak-events-config/enable")
def enable_keycloak_events():
    """Enable Keycloak event storage with recommended settings for 21 CFR Part 11."""
    token, server_url, realm, error = _get_keycloak_token_and_url()
    if error:
        raise HTTPException(502, error)

    # First get current config to preserve existing listeners
    url = f"{server_url}admin/realms/{realm}/events/config"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, verify=False, timeout=10)
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Failed to read current config: {r.text[:300]}")

    current = r.json()
    listeners = current.get("eventsListeners", ["jboss-logging"])

    # Merge current event types with recommended ones
    current_types = set(current.get("enabledEventTypes", []))
    recommended_types = set(RECOMMENDED_EVENT_TYPES)
    merged_types = sorted(current_types | recommended_types)

    new_config = {
        "eventsEnabled": True,
        "eventsExpiration": DEFAULT_EVENTS_EXPIRATION,
        "enabledEventTypes": merged_types,
        "eventsListeners": listeners,
        "adminEventsEnabled": current.get("adminEventsEnabled", False),
        "adminEventsDetailsEnabled": current.get("adminEventsDetailsEnabled", False),
    }

    r = requests.put(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=new_config,
        verify=False,
        timeout=10,
    )
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, f"Failed to update event config: {r.text[:300]}")

    logger.info("Keycloak event storage enabled for realm '%s': types=%s, expiration=%ds",
                realm, merged_types, DEFAULT_EVENTS_EXPIRATION)

    return {
        "status": "ok",
        "message": f"Event storage enabled for {realm} with {len(merged_types)} event types and 90-day retention.",
        "config": new_config,
    }


@app.post("/api/export")
def run_export(request_body: dict):
    """Run the audit trail export — returns data for browser download."""
    domino_host = normalize_domino_host(
        request_body.get("dominoHost") or get_default_domino_host()
    )
    if not domino_host:
        raise HTTPException(400, "Domino Host is required.")

    api_key = request_body.get("apiKey") or os.environ.get("DOMINO_USER_API_KEY")
    if not api_key:
        raise HTTPException(400, "Missing Domino User API Key.")

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
        return {"status": "empty", "message": "No audit events found for the given date range."}

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

    csv_data = df.to_csv(index=False)

    return {
        "status": "ok",
        "rowCount": len(df),
        "csvData": csv_data,
        "rows": json.loads(df.to_json(orient="records")),
        "columns": list(df.columns),
    }


# ---------------------------------------------------------------------------
# PDF generation — 21 CFR Part 11 style flat audit log
# ---------------------------------------------------------------------------

_PDF_FRIENDLY_LABELS = {
    "Date & Time": "Date & Time",
    "User Name": "User Name",
    "Event": "Event",
    "Project": "Project Name",
    "Target User": "Target Name",
    "Target Entity Type": "Target Type",
    "Before": "Before Value",
    "After": "After Value",
    "Field Changed": "Field Changed",
    "Field Type": "Field Type",
    "User First Name": "First Name",
    "User Last Name": "Last Name",
    "Added": "Added",
    "Removed": "Removed",
}


def generate_audit_pdf(rows, selected_columns, meta=None):
    """Generate a 21 CFR Part 11 style audit trail PDF.

    Returns PDF bytes.  Uses landscape A4 with user-selected columns (up to 6).
    Column widths are distributed proportionally based on content.
    """
    from fpdf import FPDF

    meta = meta or {}
    if not selected_columns:
        selected_columns = ["Date & Time", "User Name", "Event", "Project"]
    selected_columns = selected_columns[:6]
    n_cols = len(selected_columns)

    # Distribute 277mm (landscape A4 minus margins) across columns
    total_w = 277
    # Give Date & Time a fixed width, distribute rest evenly
    col_widths = []
    for col in selected_columns:
        if col in ("Date & Time",):
            col_widths.append(38)
        elif col in ("Event",):
            col_widths.append(min(45, total_w // n_cols))
        else:
            col_widths.append(0)  # placeholder
    fixed = sum(col_widths)
    flex_count = col_widths.count(0)
    flex_w = (total_w - fixed) // flex_count if flex_count else 0
    col_widths = [w if w > 0 else flex_w for w in col_widths]
    # Distribute any remainder to last column
    col_widths[-1] += total_w - sum(col_widths)

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

    col_labels = [_PDF_FRIENDLY_LABELS.get(c, c) for c in selected_columns]

    def _print_header_row():
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_fill_color(250, 250, 250)
        pdf.set_draw_color(200, 200, 200)
        for i, hdr in enumerate(col_labels):
            pdf.cell(col_widths[i], 6, hdr, border=1, fill=True)
        pdf.ln()

    _print_header_row()

    # Table rows
    pdf.set_font("Helvetica", "", 6.5)

    for row in rows:
        vals = []
        for col in selected_columns:
            v = str(row.get(col) or "")
            # Truncate very long values
            if len(v) > 200:
                v = v[:197] + "..."
            vals.append(v)

        # Calculate row height based on the widest multi-cell content
        max_lines = 1
        for i, v in enumerate(vals):
            lines = pdf.multi_cell(col_widths[i], 4, v, dry_run=True, output="LINES")
            max_lines = max(max_lines, len(lines))
        row_h = max(6, max_lines * 4)

        # Check if we need a new page
        if pdf.get_y() + row_h > pdf.h - 15:
            pdf.add_page()
            _print_header_row()
            pdf.set_font("Helvetica", "", 6.5)

        y_start = pdf.get_y()
        x_start = pdf.get_x()

        # Render each cell with multi_cell for proper wrapping
        for i, v in enumerate(vals):
            pdf.set_xy(x_start + sum(col_widths[:i]), y_start)
            if i < n_cols - 1:
                # For non-last columns, use cell with fixed height
                pdf.cell(col_widths[i], row_h, vals[i][:int(col_widths[i] / 1.8)], border=1)
            else:
                # Last column gets multi_cell for wrapping
                pdf.multi_cell(col_widths[i], 4, v, border=1)

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
    selected_columns = request_body.get("selectedColumns", [])
    meta = request_body.get("meta", {})

    if not rows:
        raise HTTPException(400, "No rows to export.")

    try:
        pdf_bytes = generate_audit_pdf(rows, selected_columns, meta)
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


# ---------------------------------------------------------------------------
# Static files & SPA fallback
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    return HTMLResponse(open("static/index.html").read())
