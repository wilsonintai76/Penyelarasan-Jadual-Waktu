import io
import json
import os
import requests
import pandas as pd
from nicegui import ui, events

# Fail konfigurasi tempatan supaya kunci API Cloudflare tidak perlu ditaip berulang kali
CONFIG_FILE = "cloudflare_config.json"

# State aplikasi
app_state = {
    "records": [],
    "account_id": "",
    "namespace_id": "",
    "api_token": "",
    "kv_key": "jadual_induk_jkm"
}


def load_saved_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                app_state["account_id"] = data.get("account_id", "")
                app_state["namespace_id"] = data.get("namespace_id", "")
                app_state["api_token"] = data.get("api_token", "")
                app_state["kv_key"] = data.get("kv_key", "jadual_induk_jkm")
        except Exception:
            pass


def save_config():
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "account_id": app_state["account_id"],
                "namespace_id": app_state["namespace_id"],
                "api_token": app_state["api_token"],
                "kv_key": app_state["kv_key"],
            },
            f,
            indent=2,
        )
    ui.notify("Tetapan API Cloudflare disimpan secara tempatan.", type="positive")


def parse_pdf_timetable(file_bytes: bytes) -> list[dict]:
    """
    Templat pengekstrakan PDF menggunakan pdfplumber.
    Nota: Struktur jadual PDF JW Induk boleh disesuaikan mengikut format jadual
    yang dijana oleh unit jadual waktu Politeknik.
    """
    try:
        import pdfplumber
    except ImportError:
        ui.notify("Sila pasang pdfplumber: pip install pdfplumber", type="negative")
        return []

    extracted = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    # Contoh penapisan baris jadual berstruktur (sesuaikan indeks lajur mengikut PDF sebenar)
                    if not row or len(row) < 8:
                        continue
                    cohort = (row[0] or "").strip()
                    code = (row[1] or "").strip()
                    if not cohort or not code or cohort.upper() == "COHORT":
                        continue
                    extracted.append({
                        "Cohort": cohort,
                        "Course_Code": code,
                        "Course_Name": (row[2] or "").strip(),
                        "Credit": int(float(row[3])) if str(row[3]).strip().isdigit() else 3,
                        "Day": (row[4] or "").strip(),
                        "Start_Time": (row[5] or "").strip(),
                        "End_Time": (row[6] or "").strip(),
                        "Venue": (row[7] or "").strip(),
                        "Lecturer": (row[8] or "").strip() if len(row) > 8 else "-",
                        "Status": "D",
                    })
    return extracted


def handle_file_upload(e: events.UploadEventArguments, table_widget, status_label):
    filename = e.name.lower()
    content = e.content.read()

    try:
        records = []
        if filename.endswith(".json"):
            records = json.loads(content.decode("utf-8"))
        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content)).fillna("")
            records = df.to_dict(orient="records")
        elif filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content)).fillna("")
            records = df.to_dict(orient="records")
        elif filename.endswith(".pdf"):
            records = parse_pdf_timetable(content)
        else:
            ui.notify("Format fail tidak disokong. Gunakan PDF, Excel, CSV, atau JSON.", type="warning")
            return

        # Pastikan medan Credit dalam bentuk integer
        for r in records:
            if "Credit" in r:
                try:
                    r["Credit"] = int(float(r["Credit"]))
                except (ValueError, TypeError):
                    r["Credit"] = 0

        app_state["records"] = records
        table_widget.rows = records
        table_widget.update()

        cohorts = sorted({r.get("Cohort", "") for r in records if r.get("Cohort")})
        status_label.text = (
            f"Berjaya dimuatkan: {len(records)} slot kuliah merentasi {len(cohorts)} kelas "
            f"({', '.join(cohorts[:6])}{'...' if len(cohorts) > 6 else ''})"
        )
        ui.notify(f"{len(records)} rekod jadual berjaya diekstrak!", type="positive")

    except Exception as ex:
        ui.notify(f"Ralat membaca fail: {ex}", type="negative")


def push_to_cloudflare_kv():
    if not app_state["records"]:
        ui.notify("Tiada data jadual untuk dihantar. Sila muat naik fail dahulu.", type="warning")
        return

    acc_id = app_state["account_id"].strip()
    ns_id = app_state["namespace_id"].strip()
    token = app_state["api_token"].strip()
    key = app_state["kv_key"].strip() or "jadual_induk_jkm"

    if not acc_id or not ns_id or not token:
        ui.notify("Sila lengkapkan Account ID, Namespace ID, dan API Token Cloudflare.", type="warning")
        return

    url = f"https://api.cloudflare.com/client/v4/accounts/{acc_id}/storage/kv/namespaces/{ns_id}/values/{key}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        payload = json.dumps(app_state["records"], ensure_ascii=False)
        resp = requests.put(url, headers=headers, data=payload.encode("utf-8"), timeout=15)
        result = resp.json()

        if resp.status_code == 200 and result.get("success"):
            save_config()
            ui.notify(
                f"BERJAYA! {len(app_state['records'])} rekod jadual telah dikemas kini terus ke Cloudflare KV.",
                type="positive",
            )
        else:
            errors = result.get("errors", [{"message": resp.text}])
            ui.notify(f"Gagal muat naik ke Cloudflare: {errors}", type="negative")

    except Exception as ex:
        ui.notify(f"Ralat sambungan rangkaian: {ex}", type="negative")


# -----------------------------------------------------------------
# ANTARA MUKA PENGGUNA DESKTOP (NICEGUI)
# -----------------------------------------------------------------
load_saved_config()

with ui.column().classes("w-full max-w-6xl mx-auto p-6 gap-5"):
    # Header
    with ui.row().classes("w-full items-center justify-between bg-slate-900 text-white p-5 rounded-2xl shadow"):
        with ui.column().classes("gap-0.5"):
            ui.label("Penyelaras Jadual Induk JKM (Desktop Admin)").classes("text-xl font-bold")
            ui.label("Ekstrak PDF / Excel / JSON JW Induk & Hantar Terus ke Cloudflare KV").classes(
                "text-xs text-blue-300"
            )
        ui.badge("Politeknik Kuching Sarawak", color="blue")

    # Kad 1: Tetapan Sambungan Cloudflare KV
    with ui.expansion("1. Tetapan API Cloudflare KV (Disimpan Tempatan)", icon="cloud_upload").classes(
        "w-full bg-white border rounded-xl shadow-sm"
    ):
        with ui.grid(columns=2).classes("w-full gap-3 p-2"):
            ui.input("Cloudflare Account ID").bind_value(app_state, "account_id").props("outlined dense")
            ui.input("KV Namespace ID").bind_value(app_state, "namespace_id").props("outlined dense")
            ui.input("Cloudflare API Token (KV Edit)", password=True, password_toggle_button=True).bind_value(
                app_state, "api_token"
            ).props("outlined dense")
            ui.input("Nama Kunci (KV Key)").bind_value(app_state, "kv_key").props("outlined dense")
        ui.button("Simpan Tetapan API", icon="save", on_click=save_config).classes("mt-2")

    # Kad 2: Muat Naik & Ekstrak Fail JW Induk
    with ui.card().classes("w-full p-5 rounded-xl border shadow-sm gap-3"):
        ui.label("2. Muat Naik Fail Jadual Waktu Induk (PDF / Excel / CSV / JSON)").classes("font-bold text-base")
        status_lbl = ui.label("Belum ada fail dimuat naik.").classes("text-xs text-slate-600")

        columns = [
            {"name": "Cohort", "label": "Seksyen", "field": "Cohort", "sortable": True, "align": "left"},
            {"name": "Course_Code", "label": "Kod Kursus", "field": "Course_Code", "sortable": True, "align": "left"},
            {"name": "Course_Name", "label": "Nama Kursus", "field": "Course_Name", "align": "left"},
            {"name": "Credit", "label": "Kredit", "field": "Credit", "align": "center"},
            {"name": "Day", "label": "Hari", "field": "Day", "sortable": True, "align": "center"},
            {"name": "Start_Time", "label": "Mula", "field": "Start_Time", "align": "center"},
            {"name": "End_Time", "label": "Tamat", "field": "End_Time", "align": "center"},
            {"name": "Venue", "label": "Bilik", "field": "Venue", "align": "left"},
            {"name": "Lecturer", "label": "Pensyarah", "field": "Lecturer", "align": "left"},
        ]

        preview_table = ui.table(
            columns=columns,
            rows=[],
            row_key="Course_Code",
            pagination=10,
        ).classes("w-full")

        ui.upload(
            label="Pilih atau Seret Fail JW Induk (.pdf, .xlsx, .csv, .json)",
            auto_upload=True,
            on_upload=lambda e: handle_file_upload(e, preview_table, status_lbl),
        ).props("accept='.pdf,.xlsx,.xls,.csv,.json' flat bordered").classes("w-full")

    # Kad 3: Tindakan Hantar ke Cloudflare
    with ui.row().classes("w-full justify-end items-center gap-3"):
        ui.button(
            "Eksport Salinan JSON Tempatan",
            icon="download",
            on_click=lambda: ui.download(
                json.dumps(app_state["records"], indent=2, ensure_ascii=False).encode("utf-8"),
                "jadual_induk_jkm.json",
            )
            if app_state["records"]
            else ui.notify("Tiada data untuk dieksport.", type="warning"),
        ).props("outline")

        ui.button(
            "Hantar & Kemas Kini ke Cloudflare KV",
            icon="rocket_launch",
            on_click=push_to_cloudflare_kv,
        ).classes("bg-emerald-600 text-white font-bold px-5 py-2")

# Jalankan sebagai tetingkap aplikasi desktop natif
ui.run(title="Admin Jadual Induk JKM - Cloudflare", native=True, window_size=(1100, 780), reload=False)