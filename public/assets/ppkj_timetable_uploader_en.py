import asyncio
import base64
import importlib
import io
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from nicegui import ui

# ==============================================================================
# CONFIGURATION & LOCAL STORAGE PATHS
# ==============================================================================
APP_DIR = Path(__file__).resolve().parent
CONFIG_FILE = APP_DIR / "cf_timetable_config.json"
CATALOG_FILE = APP_DIR / "course_catalog.json"

GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
]

VISION_MODELS = [
    "@cf/meta/llama-4-scout-17b-16e-instruct",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/mistralai/mistral-small-3.1-24b-instruct",
    "@cf/meta/llama-3.2-11b-vision-instruct",
]

ENGINE_MODES = [
    "Auto: Gemini Vision -> Workers AI -> 100% Offline",
    "Gemini Vision API Only",
    "Cloudflare Workers AI Only",
    "100% Offline Local Engine Only",
]

ORIENTATION_MODES = [
    "Auto-Detect Upright (Recommended)",
    "Rotate 90° Clockwise",
    "Rotate 90° Counter-Clockwise",
    "No Rotation (0°)",
]

DEFAULT_CONFIG: Dict[str, Any] = {
    "cf_account_id": "",
    "cf_kv_namespace_id": "",
    "cf_api_token": "",
    "cf_kv_key": "jadual_induk_jkm",
    "gemini_api_key": "",
    "gemini_model": GEMINI_MODELS[0],
    "cf_vision_model": VISION_MODELS[0],
    "engine_mode": ENGINE_MODES[0],
    "orientation_mode": ORIENTATION_MODES[0],
}

DAY_MAP = {
    "MON": "Isnin",
    "MONDAY": "Isnin",
    "ISNIN": "Isnin",
    "TUE": "Selasa",
    "TUESDAY": "Selasa",
    "SELASA": "Selasa",
    "WED": "Rabu",
    "WEDNESDAY": "Rabu",
    "RABU": "Rabu",
    "THU": "Khamis",
    "THURSDAY": "Khamis",
    "KHAMIS": "Khamis",
    "FRI": "Jumaat",
    "FRIDAY": "Jumaat",
    "JUMAAT": "Jumaat",
    "SAT": "Sabtu",
    "SATURDAY": "Sabtu",
    "SABTU": "Sabtu",
    "SUN": "Ahad",
    "SUNDAY": "Ahad",
    "AHAD": "Ahad",
}

STANDARD_HOURS = [
    "08:00", "09:00", "10:00", "11:00", "12:00",
    "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
]

OFFLINE_FALLBACK_CATALOG: Dict[str, str] = {
    "DJJ10013": "Engineering Drawing",
    "DJJ10042": "Workshop Technology",
    "DJJ10243": "Statics & Dynamics",
    "DJJ20053": "Electrical Technology",
    "DJJ20063": "Thermodynamics",
    "DJJ20073": "Fluid Mechanics",
    "DJJ20083": "Materials Science",
    "DJJ30093": "Mechanics of Machines",
    "DJJ30103": "Manufacturing Processes",
    "DJJ30113": "Computer Aided Design",
    "DJJ30323": "Strength of Materials",
    "DJJ40123": "Pneumatics & Hydraulics",
    "DJJ40133": "Engineering Design",
    "DJJ40142": "Project 1",
    "DJJ50153": "Industrial Automation",
    "DJJ50164": "Project 2",
    "DBM10013": "Engineering Mathematics 1",
    "DBM20023": "Engineering Mathematics 2",
    "DBM30033": "Engineering Mathematics 3",
    "DBM30183": "Engineering Statistics",
    "DBS10012": "Engineering Science",
    "DBS10042": "Applied Science",
    "DUE10012": "Communicative English 1",
    "DUE30022": "Communicative English 2",
    "DUE30072": "Communicative English 3",
    "MPU21032": "Penghayatan Etika dan Peradaban",
    "MPU21082": "Kursus Integriti dan Antirasuah",
    "MPU22012": "Entrepreneurship",
    "MPU23012": "Pengajian Malaysia",
    "MPU24011": "Sukan",
    "MPU24021": "Kokurikulum",
}

_RAPIDOCR_INSTANCE: Any = None


# ==============================================================================
# CONFIG & COURSE CATALOG HELPERS
# ==============================================================================
def load_config() -> Dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                cfg.update(saved)
        except Exception:
            pass
    if cfg.get("gemini_model") not in GEMINI_MODELS:
        cfg["gemini_model"] = GEMINI_MODELS[0]
    if cfg.get("cf_vision_model") not in VISION_MODELS:
        cfg["cf_vision_model"] = VISION_MODELS[0]
    if cfg.get("engine_mode") not in ENGINE_MODES:
        cfg["engine_mode"] = ENGINE_MODES[0]
    return cfg


def save_config(cfg: Dict[str, Any]) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def load_course_catalog() -> Dict[str, str]:
    if CATALOG_FILE.exists():
        try:
            data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {str(k).strip().upper(): str(v).strip() for k, v in data.items()}
        except Exception:
            pass
    return {}


def save_course_catalog(catalog: Dict[str, str]) -> None:
    sorted_cat = dict(sorted(catalog.items(), key=lambda x: x[0]))
    CATALOG_FILE.write_text(json.dumps(sorted_cat, indent=2, ensure_ascii=False), encoding="utf-8")


def infer_credits_from_code(course_code: str) -> int:
    code = re.sub(r"[^A-Z0-9]", "", str(course_code or "").upper())
    if code and code[-1].isdigit():
        val = int(code[-1])
        return val if 1 <= val <= 8 else 3
    return 3


def normalize_day(day_val: Any) -> str:
    raw = str(day_val or "").strip().upper()
    return DAY_MAP.get(raw, str(day_val or "").strip().title() or "Isnin")


def normalize_time(t_val: Any) -> str:
    s = str(t_val or "").strip().replace(".", ":")
    m = re.search(r"(\d{1,2}):(\d{2})", s)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2))
        return f"{hh:02d}:{mm:02d}"
    return s


def clean_ocr_course_code(raw_code: str) -> str:
    c = re.sub(r"[^A-Z0-9]", "", str(raw_code or "").upper())
    c = re.sub(r"^01[1I/]", "DJJ", c)
    c = re.sub(r"^08M", "DBM", c)
    c = re.sub(r"^851", "DBS1", c)
    c = re.sub(r"^0UE", "DUE", c)
    return c


def normalize_cohort_label(raw_cohort: str) -> str:
    s = str(raw_cohort or "").strip().upper().replace(" ", "")
    s = re.sub(r"-5(\d)$", r"-S\1", s)
    s = re.sub(r"^([A-Z]{2,4}\d)S(\d)$", r"\1-S\2", s)
    return s


def normalize_schedule_rows(rows: List[Dict[str, Any]], catalog: Dict[str, str]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for idx, r in enumerate(rows):
        cohort = normalize_cohort_label(r.get("Cohort") or r.get("cohort") or r.get("Section") or "")
        code = clean_ocr_course_code(r.get("Course_Code") or r.get("course_code") or r.get("Code") or "")
        if not code or "TUANGAN" in code:
            continue
        c_name = str(r.get("Course_Name") or r.get("course_name") or "").strip()
        if not c_name:
            c_name = catalog.get(code) or OFFLINE_FALLBACK_CATALOG.get(code) or f"Course {code}"
        try:
            credits = int(r.get("Credit") or r.get("Credits") or r.get("credits") or infer_credits_from_code(code))
        except Exception:
            credits = infer_credits_from_code(code)

        day = normalize_day(r.get("Day") or r.get("day"))
        start_t = normalize_time(r.get("Start_Time") or r.get("start_time") or r.get("Start"))
        end_t = normalize_time(r.get("End_Time") or r.get("end_time") or r.get("End"))
        venue = str(r.get("Venue") or r.get("venue") or r.get("Room") or "-").strip().upper()
        lecturer = str(r.get("Lecturer") or r.get("lecturer") or "-").strip().upper()

        cleaned.append({
            "id": idx + 1,
            "Cohort": cohort or "GENERAL",
            "Course_Code": code,
            "Course_Name": c_name,
            "Credit": credits,
            "Day": day,
            "Start_Time": start_t,
            "End_Time": end_t,
            "Venue": venue,
            "Lecturer": lecturer,
        })
    return cleaned


# ==============================================================================
# OFFLINE PACKAGE AUTO-INSTALLER
# ==============================================================================
CORE_OFFLINE_PACKAGES = [
    ("pdfplumber", "pdfplumber"),
    ("pypdfium2", "pypdfium2"),
    ("cv2", "opencv-python-headless"),
    ("PIL", "Pillow"),
    ("numpy", "numpy"),
]


def _has_rapidocr() -> bool:
    for mod in ("rapidocr_onnxruntime", "rapidocr"):
        try:
            importlib.import_module(mod)
            return True
        except ImportError:
            continue
    return False


def get_offline_package_status() -> Tuple[bool, List[str], str]:
    missing: List[str] = []
    for mod_name, pip_name in CORE_OFFLINE_PACKAGES:
        try:
            importlib.import_module(mod_name)
        except ImportError:
            missing.append(pip_name)
    if not _has_rapidocr():
        missing.append("rapidocr-onnxruntime")
    if not missing:
        return True, [], "Offline Engine Ready: pdfplumber, pypdfium2, OpenCV & RapidOCR installed."
    return False, missing, f"Missing offline packages: {', '.join(missing)}"


def install_missing_packages_sync(packages: List[str]) -> Tuple[bool, str]:
    if not packages:
        return True, "All offline packages are already installed."
    core_to_install = [p for p in packages if not p.startswith("rapidocr")]
    need_ocr = any(p.startswith("rapidocr") for p in packages)
    errors: List[str] = []

    if core_to_install:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--quiet", *core_to_install],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if proc.returncode != 0:
                errors.append((proc.stderr or proc.stdout or "pip failed").strip()[:220])
        except Exception as exc:
            errors.append(str(exc))

    if need_ocr:
        installed_ocr = False
        for pkg_name in ("rapidocr-onnxruntime", "rapidocr"):
            try:
                proc = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "--quiet", pkg_name],
                    capture_output=True,
                    text=True,
                    timeout=240,
                )
                if proc.returncode == 0:
                    installed_ocr = True
                    break
            except Exception:
                continue
        if not installed_ocr:
            errors.append("Could not auto-install rapidocr-onnxruntime")

    importlib.invalidate_caches()
    if errors:
        return False, " | ".join(errors)
    return True, "All offline PDF & RapidOCR packages installed successfully!"


def _get_rapidocr_engine() -> Any:
    global _RAPIDOCR_INSTANCE
    if _RAPIDOCR_INSTANCE is not None:
        return _RAPIDOCR_INSTANCE
    try:
        from rapidocr_onnxruntime import RapidOCR
        _RAPIDOCR_INSTANCE = RapidOCR()
        return _RAPIDOCR_INSTANCE
    except ImportError:
        pass
    try:
        from rapidocr import RapidOCR
        _RAPIDOCR_INSTANCE = RapidOCR()
        return _RAPIDOCR_INSTANCE
    except ImportError:
        return None


# ==============================================================================
# ORIENTATION DETECTION & UPRIGHT CORRECTION
# ==============================================================================
def _score_upright_text(pil_img: Any, ocr_engine: Any) -> int:
    import numpy as np
    from PIL import Image

    w, h = pil_img.size
    scale = min(1.0, 1050.0 / float(max(w, h)))
    small = pil_img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.BILINEAR)
    arr = np.array(small)
    result, _ = ocr_engine(arr)
    if not result:
        return 0
    keywords = (
        "JADUAL", "INDUK", "PROGRAM", "SESI", "ISNIN", "SELASA",
        "RABU", "KHAMIS", "JUMAAT", "PLSP", "DAD", "DKM", "DPU", "DTP",
        "DJJ", "DBM", "DUE", "MPU", "08:00", "09:00",
    )
    score = 0
    for item in result:
        box, txt = item[0], str(item[1] or "").upper()
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        bw = max(xs) - min(xs)
        bh = max(ys) - min(ys)
        if bw > bh * 1.15:
            score += 1
        for kw in keywords:
            if kw in txt:
                score += 10
    return score


def orient_pil_image_upright(pil_img: Any, orientation_mode: str = "Auto-Detect Upright (Recommended)") -> Tuple[Any, str]:
    from PIL import Image

    if orientation_mode == "No Rotation (0°)":
        return pil_img, "0° (Manual)"
    if orientation_mode == "Rotate 90° Clockwise":
        return pil_img.transpose(Image.Transpose.ROTATE_270), "90° CW (Manual)"
    if orientation_mode == "Rotate 90° Counter-Clockwise":
        return pil_img.transpose(Image.Transpose.ROTATE_90), "90° CCW (Manual)"

    ocr_engine = _get_rapidocr_engine()
    if pil_img.height > pil_img.width:
        cand_cw = pil_img.transpose(Image.Transpose.ROTATE_270)
        if ocr_engine is None:
            return cand_cw, "90° CW (Auto-Portrait->Landscape)"
        cand_ccw = pil_img.transpose(Image.Transpose.ROTATE_90)
        s_cw = _score_upright_text(cand_cw, ocr_engine)
        s_ccw = _score_upright_text(cand_ccw, ocr_engine)
        if s_ccw > s_cw:
            return cand_ccw, f"90° CCW (Auto-Detected, score {s_ccw} vs {s_cw})"
        return cand_cw, f"90° CW (Auto-Detected, score {s_cw} vs {s_ccw})"
    else:
        if ocr_engine is None:
            return pil_img, "0° Landscape"
        s_0 = _score_upright_text(pil_img, ocr_engine)
        if s_0 >= 35:
            return pil_img, f"0° Landscape (Verified, score {s_0})"
        cand_180 = pil_img.transpose(Image.Transpose.ROTATE_180)
        s_180 = _score_upright_text(cand_180, ocr_engine)
        if s_180 > s_0 + 15:
            return cand_180, f"180° Flipped (Auto-Detected, score {s_180})"
        return pil_img, f"0° Landscape (score {s_0})"


def render_pdf_pages_upright_jpeg_b64(
    pdf_bytes: bytes,
    orientation_mode: str = "Auto-Detect Upright (Recommended)",
    max_width: int = 1600,
    quality: int = 85,
) -> Tuple[List[str], List[str]]:
    try:
        import pypdfium2 as pdfium
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "pypdfium2 and Pillow are required. Click 'Check & Auto-Install Offline Packages' in Section 1."
        ) from exc

    pdf = pdfium.PdfDocument(pdf_bytes)
    images_b64: List[str] = []
    orient_notes: List[str] = []

    for page_idx in range(len(pdf)):
        page = pdf[page_idx]
        bitmap = page.render(scale=2.0)
        pil_img = bitmap.to_pil().convert("RGB")
        pil_img, note = orient_pil_image_upright(pil_img, orientation_mode)
        orient_notes.append(f"P{page_idx + 1}: {note}")

        if pil_img.width > max_width:
            ratio = max_width / float(pil_img.width)
            new_h = int(pil_img.height * ratio)
            pil_img = pil_img.resize((max_width, new_h), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=quality, optimize=True)
        images_b64.append(base64.b64encode(buf.getvalue()).decode("ascii"))

    return images_b64, orient_notes


# ==============================================================================
# SHARED JSON PARSER & PROMPT BUILDER
# ==============================================================================
def build_timetable_extraction_prompt(page_num: int, total_pages: int) -> str:
    return (
        f"Extract Malaysian Polytechnic master timetable JW Induk PLSP-02(1a), page {page_num} of {total_pages}. "
        "Top column headers are Cohorts/Sections (such as DAD1-S1, DAD2-S1, DKM3-S1, DPU2-S1, DTP1-S1). "
        "Left rows are grouped by Day (ISNIN, SELASA, RABU, KHAMIS, JUMAAT) and hourly time slots (08:00 to 18:00). "
        "A tall merged vertical box spanning multiple hourly rows is ONE class from the top row Start_Time to the bottom row End_Time. "
        "Ignore any cell labeled TUANGAN or empty cells. "
        "Return ONLY a JSON array of objects with exact keys: "
        '[{"Cohort":"DKM3-S1","Course_Code":"DJJ30323","Day":"Isnin","Start_Time":"08:00","End_Time":"10:00","Venue":"BK 21","Lecturer":"JNZL"}]'
    )


def extract_json_array_from_text(raw_text: str) -> List[Dict[str, Any]]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("Model returned an empty response string.")

    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    # Salvage any complete JSON objects if output truncated mid-array
    if start != -1:
        salvaged: List[Dict[str, Any]] = []
        for m in re.finditer(r"\{[^{}]+\}", text[start:]):
            try:
                obj = json.loads(m.group(0))
                if isinstance(obj, dict) and (obj.get("Course_Code") or obj.get("course_code")):
                    salvaged.append(obj)
            except Exception:
                continue
        if salvaged:
            return salvaged

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            for key in ("slots", "schedule", "classes", "data", "items", "rows"):
                if isinstance(obj.get(key), list):
                    return obj[key]
    except Exception:
        pass

    preview = text[:220].replace("\n", " ")
    raise ValueError(f"Could not parse JSON array from model output: '{preview}'")


# ==============================================================================
# GOOGLE GEMINI VISION API CLIENT (FAST SCANNED PDF EXTRACTOR)
# ==============================================================================
def call_gemini_vision_page(
    gemini_api_key: str,
    gemini_model: str,
    image_b64: str,
    page_num: int,
    total_pages: int,
) -> List[Dict[str, Any]]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
    headers = {
        "x-goog-api-key": gemini_api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": build_timetable_extraction_prompt(page_num, total_pages)},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": image_b64,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 16384,
            "responseMimeType": "application/json",
        },
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=90)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API HTTP {resp.status_code}: {resp.text[:260]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini returned no candidates: {str(data)[:240]}")

    parts = candidates[0].get("content", {}).get("parts") or []
    raw_text = "".join(str(p.get("text") or "") for p in parts)
    return extract_json_array_from_text(raw_text)


def enrich_catalog_with_gemini(
    gemini_api_key: str,
    gemini_model: str,
    unknown_codes: List[str],
    catalog: Dict[str, str],
) -> Dict[str, str]:
    if not unknown_codes or not gemini_api_key:
        return catalog
    prompt = (
        "Provide the official Malaysian Polytechnic (JPPKK / Politeknik) English course titles for these course codes. "
        "Return ONLY a JSON object mapping Course_Code to Course_Name. "
        f"Codes: {json.dumps(unknown_codes)}"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key, "Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        if resp.status_code == 200:
            candidates = resp.json().get("candidates") or []
            parts = candidates[0].get("content", {}).get("parts") or [] if candidates else []
            raw = "".join(str(p.get("text") or "") for p in parts)
            s = raw.find("{")
            e = raw.rfind("}")
            if s != -1 and e > s:
                mapping = json.loads(raw[s : e + 1])
                if isinstance(mapping, dict):
                    for k, v in mapping.items():
                        cu = str(k).strip().upper()
                        if cu in unknown_codes and str(v).strip():
                            catalog[cu] = str(v).strip()
    except Exception:
        pass
    return catalog


def test_gemini_credentials(gemini_api_key: str, gemini_model: str) -> Tuple[bool, str]:
    if not gemini_api_key:
        return False, "Missing Google Gemini API Key."
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key, "Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": "Reply OK"}]}],
        "generationConfig": {"maxOutputTokens": 8},
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=25)
    if resp.status_code == 200:
        return True, f"Gemini Vision API ({gemini_model}): OK"
    return False, f"Gemini API failed (HTTP {resp.status_code}): {resp.text[:220]}"


# ==============================================================================
# CLOUDFLARE WORKERS AI & KV CLIENT
# ==============================================================================
def call_cloudflare_workers_ai_vision_page(
    account_id: str,
    api_token: str,
    model: str,
    image_b64: str,
    page_num: int,
    total_pages: int,
) -> List[Dict[str, Any]]:
    prompt = build_timetable_extraction_prompt(page_num, total_pages)
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    oai_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
    oai_payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                ],
            }
        ],
        "temperature": 0.1,
        "max_tokens": 8192,
    }

    resp = requests.post(oai_url, headers=headers, json=oai_payload, timeout=180)
    if resp.status_code == 200:
        if not resp.text.strip():
            raise RuntimeError(f"Workers AI ({model}) returned HTTP 200 with an empty body.")
        data = resp.json()
        if isinstance(data, dict) and data.get("errors"):
            raise RuntimeError(f"Workers AI Error: {data.get('errors')}")
        choices = data.get("choices") or []
        if choices:
            msg_obj = choices[0].get("message") or {}
            content = msg_obj.get("content") or ""
            if not str(content).strip():
                raise RuntimeError(
                    f"Workers AI ({model}) returned empty message content. Raw response: {resp.text[:240]}"
                )
            return extract_json_array_from_text(content)

    run_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    run_payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                ],
            }
        ],
        "temperature": 0.1,
        "max_tokens": 8192,
    }
    resp2 = requests.post(run_url, headers=headers, json=run_payload, timeout=180)
    if resp2.status_code != 200:
        raise RuntimeError(f"Workers AI HTTP {resp2.status_code}: {resp2.text[:260]}")
    if not resp2.text.strip():
        raise RuntimeError(f"Workers AI ({model}) returned empty body on /ai/run.")

    data2 = resp2.json()
    if not data2.get("success", True):
        raise RuntimeError(f"Workers AI API Error: {data2.get('errors')}")
    result_obj = data2.get("result") or {}
    raw_out = result_obj.get("response") if isinstance(result_obj, dict) else str(result_obj)
    return extract_json_array_from_text(raw_out)


def enrich_catalog_with_workers_ai(
    account_id: str,
    api_token: str,
    model: str,
    unknown_codes: List[str],
    catalog: Dict[str, str],
) -> Dict[str, str]:
    if not unknown_codes or not account_id or not api_token:
        return catalog
    prompt = (
        "Provide the official Malaysian Polytechnic (JPPKK / Politeknik) English course titles for these course codes. "
        "Return ONLY a JSON object mapping Course_Code to Course_Name. "
        f"Codes: {json.dumps(unknown_codes)}"
    )
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 1024,
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=35)
        if resp.status_code == 200 and resp.text.strip():
            choices = resp.json().get("choices") or []
            raw = choices[0].get("message", {}).get("content", "") if choices else ""
            s = raw.find("{")
            e = raw.rfind("}")
            if s != -1 and e > s:
                mapping = json.loads(raw[s : e + 1])
                if isinstance(mapping, dict):
                    for k, v in mapping.items():
                        cu = str(k).strip().upper()
                        if cu in unknown_codes and str(v).strip():
                            catalog[cu] = str(v).strip()
    except Exception:
        pass
    return catalog


def test_cloudflare_credentials(account_id: str, namespace_id: str, api_token: str, model: str) -> Tuple[bool, str]:
    if not account_id or not api_token:
        return False, "Missing Account ID or API Token."
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    msgs: List[str] = []

    if namespace_id:
        kv_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys?limit=10"
        r_kv = requests.get(kv_url, headers=headers, timeout=20)
        if r_kv.status_code == 200 and r_kv.json().get("success"):
            msgs.append("KV Storage: OK")
        else:
            return False, f"KV Storage failed (HTTP {r_kv.status_code}): {r_kv.text[:180]}"
    else:
        msgs.append("KV Namespace ID blank (skipped)")

    ai_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
    ai_payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply OK"}],
        "max_tokens": 8,
    }
    r_ai = requests.post(ai_url, headers=headers, json=ai_payload, timeout=30)
    if r_ai.status_code == 200 and r_ai.text.strip():
        msgs.append(f"Workers AI ({model}): OK")
    else:
        return (
            False,
            f"Workers AI failed (HTTP {r_ai.status_code}). Details: {r_ai.text[:200]}",
        )

    return True, " | ".join(msgs)


# ==============================================================================
# 100% OFFLINE OPENCV GRID + RAPIDOCR EXTRACTOR
# ==============================================================================
def _extract_cell_fields(lines_with_y: List[Tuple[float, str]]) -> Optional[Dict[str, str]]:
    if not lines_with_y:
        return None
    lines_with_y.sort(key=lambda t: t[0])
    texts = [t[1].strip() for t in lines_with_y if t[1].strip()]
    joined_upper = " ".join(texts).upper()
    if not joined_upper or "TUANGAN" in joined_upper:
        return None

    code_pat = re.compile(r"\b([A-Z]{2,4}\s*\d{4,5})\b")
    found_code = ""
    other_tokens: List[str] = []

    for line in texts:
        lu = line.upper()
        m = code_pat.search(lu)
        if m and not found_code:
            found_code = clean_ocr_course_code(m.group(1))
            rem = (lu[: m.start()] + " " + lu[m.end() :]).strip()
            if rem:
                other_tokens.append(rem)
        else:
            other_tokens.append(lu)

    if not found_code:
        return None

    venue = "-"
    lecturer = "-"
    venue_keywords = ("BK", "DK", "MK", "MP", "MAKMAL", "BENGKEL", "STUDIO", "DEWAN", "BILIK", "LAB", "B.", "M.")
    for tok in other_tokens:
        clean_tok = re.sub(r"\s+", " ", tok).strip(" ,.-/")
        if not clean_tok:
            continue
        if venue == "-" and (any(clean_tok.startswith(k) for k in venue_keywords) or re.search(r"\d", clean_tok)):
            venue = clean_tok
        elif lecturer == "-":
            lecturer = clean_tok
        else:
            lecturer = f"{lecturer} {clean_tok}"

    return {
        "Course_Code": found_code,
        "Venue": venue,
        "Lecturer": lecturer,
    }


def _detect_cohort_columns(ocr_items: List[Dict[str, Any]], w: int, h: int) -> List[Tuple[str, float]]:
    cohort_pat = re.compile(r"([A-Z]{2,4}\s*\d[-\s]?[S5]\s*\d)")
    prog_only_pat = re.compile(r"^([A-Z]{2,4}\s*\d)$")
    sec_only_pat = re.compile(r"^([S5]\s*\d)$")

    top_items = [it for it in ocr_items if it["cy"] <= h * 0.28]
    cohort_hits: List[Tuple[str, float]] = []
    used_top = set()

    for idx, it in enumerate(top_items):
        matches = list(cohort_pat.finditer(it["text"].upper()))
        if len(matches) == 1:
            cohort_hits.append((normalize_cohort_label(matches[0].group(1)), it["cx"]))
            used_top.add(idx)
        elif len(matches) > 1:
            span_w = (it["x1"] - it["x0"]) / float(len(matches))
            for mi, m in enumerate(matches):
                sub_cx = it["x0"] + span_w * (mi + 0.5)
                cohort_hits.append((normalize_cohort_label(m.group(1)), sub_cx))
            used_top.add(idx)

    for idx, it in enumerate(top_items):
        if idx in used_top:
            continue
        m_prog = prog_only_pat.match(it["text"].strip().upper())
        if not m_prog:
            continue
        prog_str = re.sub(r"\s+", "", m_prog.group(1))
        best_sec = None
        best_dx = w * 0.045
        for jdx, sec_it in enumerate(top_items):
            if jdx in used_top or jdx == idx:
                continue
            m_sec = sec_only_pat.match(sec_it["text"].strip().upper())
            if m_sec and 0 <= (sec_it["cy"] - it["cy"]) <= (h * 0.08):
                dx = abs(sec_it["cx"] - it["cx"])
                if dx < best_dx:
                    best_dx = dx
                    best_sec = (jdx, re.sub(r"\s+", "", m_sec.group(1)).replace("5", "S"))
        if best_sec:
            used_top.add(idx)
            used_top.add(best_sec[0])
            cohort_hits.append((f"{prog_str}-{best_sec[1]}", it["cx"]))
        else:
            cohort_hits.append((f"{prog_str}-S1", it["cx"]))

    cohort_hits.sort(key=lambda c: c[1])
    return cohort_hits


def parse_pdf_offline_grid_ocr(
    pdf_bytes: bytes,
    orientation_mode: str = "Auto-Detect Upright (Recommended)",
) -> Tuple[List[Dict[str, Any]], List[str]]:
    import cv2
    import numpy as np
    import pypdfium2 as pdfium

    ocr_engine = _get_rapidocr_engine()
    if ocr_engine is None:
        raise RuntimeError(
            "RapidOCR is not installed yet. Click 'CHECK & AUTO-INSTALL OFFLINE PACKAGES' in Section 1."
        )

    pdf_doc = pdfium.PdfDocument(pdf_bytes)
    all_rows: List[Dict[str, Any]] = []
    orient_notes: List[str] = []
    day_order = ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat"]

    for page_idx in range(len(pdf_doc)):
        bitmap = pdf_doc[page_idx].render(scale=2.0)
        pil_img = bitmap.to_pil().convert("RGB")
        pil_img, note = orient_pil_image_upright(pil_img, orientation_mode)
        orient_notes.append(f"P{page_idx + 1}: {note}")

        img_rgb = np.array(pil_img)
        h, w = img_rgb.shape[:2]

        ocr_res, _ = ocr_engine(img_rgb)
        if not ocr_res:
            continue

        ocr_items: List[Dict[str, Any]] = []
        for entry in ocr_res:
            box, txt = entry[0], str(entry[1] or "").strip()
            if not txt:
                continue
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            x0, x1 = min(xs), max(xs)
            y0, y1 = min(ys), max(ys)
            ocr_items.append({
                "x0": x0,
                "x1": x1,
                "y0": y0,
                "y1": y1,
                "cx": (x0 + x1) / 2.0,
                "cy": (y0 + y1) / 2.0,
                "text": txt,
            })

        cohort_hits = _detect_cohort_columns(ocr_items, w, h)
        if not cohort_hits:
            continue

        col_bounds: List[Tuple[str, float, float]] = []
        for i, (c_name, cx) in enumerate(cohort_hits):
            left_x = (cohort_hits[i - 1][1] + cx) / 2.0 if i > 0 else max(0.0, cx - (w * 0.08))
            right_x = (cx + cohort_hits[i + 1][1]) / 2.0 if i < len(cohort_hits) - 1 else min(float(w), cx + (w * 0.08))
            col_bounds.append((c_name, left_x, right_x))

        day_hits: List[Tuple[str, float]] = []
        for it in ocr_items:
            if it["cx"] <= w * 0.18:
                tu = re.sub(r"[^A-Z]", "", it["text"].upper())
                for k_day, norm_d in DAY_MAP.items():
                    if k_day in tu and norm_d in day_order:
                        day_hits.append((norm_d, it["cy"]))
                        break

        day_hits.sort(key=lambda d: d[1])
        unique_days: List[Tuple[str, float]] = []
        for d_name, dy in day_hits:
            if not unique_days or unique_days[-1][0] != d_name:
                unique_days.append((d_name, dy))

        if not unique_days:
            continue

        gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
        bw = cv2.adaptiveThreshold(~gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2)
        horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 35), 1))
        vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 35)))
        horiz_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, horiz_kernel)
        vert_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, vert_kernel)
        grid_mask = cv2.add(horiz_lines, vert_lines)

        contours, _ = cv2.findContours(grid_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        cell_boxes: List[Tuple[int, int, int, int]] = []
        for cnt in contours:
            bx, by, bw_c, bh_c = cv2.boundingRect(cnt)
            if (w * 0.025) <= bw_c <= (w * 0.25) and (h * 0.010) <= bh_c <= (h * 0.20):
                cell_boxes.append((bx, by, bw_c, bh_c))

        table_top = min(it["y1"] for it in ocr_items if it["cy"] <= h * 0.28)
        table_bottom = max(it["y1"] for it in ocr_items)
        if len(unique_days) > 1:
            avg_day_h = (unique_days[-1][1] - unique_days[0][1]) / float(len(unique_days) - 1)
        else:
            avg_day_h = (table_bottom - table_top) / 5.0

        day_intervals: List[Tuple[str, float, float]] = []
        for di, (d_name, d_cy) in enumerate(unique_days):
            d_top = max(table_top, d_cy - avg_day_h * 0.50)
            d_bot = min(float(h), d_cy + avg_day_h * 0.50)
            if di > 0:
                d_top = (unique_days[di - 1][1] + d_cy) / 2.0
            if di < len(unique_days) - 1:
                d_bot = (d_cy + unique_days[di + 1][1]) / 2.0
            day_intervals.append((d_name, d_top, d_bot))

        def _y_to_slot_index(y_val: float, d_top: float, d_bot: float) -> int:
            span = max(1.0, d_bot - d_top)
            frac = (y_val - d_top) / span
            idx = int(round(frac * 10.0))
            return max(0, min(10, idx))

        used_ocr_indices = set()
        cell_boxes.sort(key=lambda b: b[2] * b[3])

        for bx, by, bw_c, bh_c in cell_boxes:
            cx = bx + bw_c / 2.0
            cy = by + bh_c / 2.0

            matched_cohort = None
            for c_name, lx, rx in col_bounds:
                if lx <= cx <= rx:
                    matched_cohort = c_name
                    break
            if not matched_cohort:
                continue

            matched_day = None
            for d_name, d_top, d_bot in day_intervals:
                if d_top <= cy <= d_bot:
                    matched_day = (d_name, d_top, d_bot)
                    break
            if not matched_day:
                continue

            cell_lines: List[Tuple[float, str]] = []
            hit_indices: List[int] = []
            for oi, it in enumerate(ocr_items):
                if oi in used_ocr_indices:
                    continue
                if (bx - 4) <= it["cx"] <= (bx + bw_c + 4) and (by - 3) <= it["cy"] <= (by + bh_c + 3):
                    cell_lines.append((it["cy"], it["text"]))
                    hit_indices.append(oi)

            parsed_cell = _extract_cell_fields(cell_lines)
            if not parsed_cell:
                continue

            for oi in hit_indices:
                used_ocr_indices.add(oi)

            d_name, d_top, d_bot = matched_day
            s_idx = _y_to_slot_index(float(by), d_top, d_bot)
            e_idx = _y_to_slot_index(float(by + bh_c), d_top, d_bot)
            if e_idx <= s_idx:
                e_idx = min(10, s_idx + 1)
            if e_idx - s_idx > 4:
                e_idx = min(10, s_idx + 2)

            all_rows.append({
                "Cohort": matched_cohort,
                "Course_Code": parsed_cell["Course_Code"],
                "Day": d_name,
                "Start_Time": STANDARD_HOURS[s_idx],
                "End_Time": STANDARD_HOURS[e_idx],
                "Venue": parsed_cell["Venue"],
                "Lecturer": parsed_cell["Lecturer"],
            })

        code_pat = re.compile(r"\b([A-Z]{2,4}\s*\d{4,5})\b")
        for oi, it in enumerate(ocr_items):
            if oi in used_ocr_indices:
                continue
            m = code_pat.search(it["text"].upper())
            if not m:
                continue
            code = clean_ocr_course_code(m.group(1))
            if not code or "TUANGAN" in code:
                continue

            matched_cohort = None
            for c_name, lx, rx in col_bounds:
                if lx <= it["cx"] <= rx:
                    matched_cohort = c_name
                    break
            matched_day = None
            for d_name, d_top, d_bot in day_intervals:
                if d_top <= it["cy"] <= d_bot:
                    matched_day = (d_name, d_top, d_bot)
                    break
            if not matched_cohort or not matched_day:
                continue

            nearby_lines: List[Tuple[float, str]] = []
            for oj, other in enumerate(ocr_items):
                if oj in used_ocr_indices:
                    continue
                if abs(other["cx"] - it["cx"]) <= (w * 0.045) and -15 <= (other["cy"] - it["cy"]) <= 55:
                    nearby_lines.append((other["cy"], other["text"]))
                    used_ocr_indices.add(oj)

            parsed_cell = _extract_cell_fields(nearby_lines) or {
                "Course_Code": code,
                "Venue": "-",
                "Lecturer": "-",
            }
            d_name, d_top, d_bot = matched_day
            s_idx = _y_to_slot_index(it["y0"], d_top, d_bot)
            e_idx = min(10, s_idx + 2)
            all_rows.append({
                "Cohort": matched_cohort,
                "Course_Code": parsed_cell["Course_Code"],
                "Day": d_name,
                "Start_Time": STANDARD_HOURS[s_idx],
                "End_Time": STANDARD_HOURS[e_idx],
                "Venue": parsed_cell["Venue"],
                "Lecturer": parsed_cell["Lecturer"],
            })

    return all_rows, orient_notes


# ==============================================================================
# SPREADSHEET / JSON PARSERS
# ==============================================================================
def parse_tabular_file(filename: str, raw_bytes: bytes) -> List[Dict[str, Any]]:
    ext = Path(filename).suffix.lower()
    if ext == ".json":
        data = json.loads(raw_bytes.decode("utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for k in ("schedule", "slots", "data", "classes", "rows"):
                if isinstance(data.get(k), list):
                    return data[k]
        raise ValueError("JSON file must contain a list of schedule objects.")

    if ext == ".csv":
        import csv

        text = raw_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)

    if ext in (".xlsx", ".xls"):
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
        ws = wb.active
        rows_iter = list(ws.iter_rows(values_only=True))
        if not rows_iter:
            return []
        headers = [str(h or "").strip() for h in rows_iter[0]]
        out = []
        for row_vals in rows_iter[1:]:
            if any(v is not None and str(v).strip() != "" for v in row_vals):
                out.append({headers[i]: row_vals[i] for i in range(min(len(headers), len(row_vals)))})
        return out

    raise ValueError(f"Unsupported file type: {ext}")


# ==============================================================================
# MAIN NICEGUI DESKTOP APPLICATION
# ==============================================================================
def build_app() -> None:
    config = load_config()
    catalog = load_course_catalog()

    app_state: Dict[str, Any] = {
        "rows": [],
        "last_filename": "",
        "last_bytes": b"",
        "last_engine_label": "",
        "is_extracting": False,
    }

    ui.colors(primary="#1d4ed8", secondary="#0f172a", accent="#0284c7", positive="#15803d")

    with ui.column().classes("w-full max-w-6xl mx-auto p-4 gap-4"):
        # Header Banner
        with ui.card().classes("w-full bg-slate-900 text-white p-4 rounded-xl shadow"):
            with ui.row().classes("w-full items-center justify-between"):
                with ui.column().classes("gap-0"):
                    ui.label("JKM Master Timetable Admin (Desktop Utility)").classes("text-xl font-bold")
                    ui.label(
                        "Extract PKS JW Induk (PLSP-02(1a)) PDF / Excel / JSON via Gemini Vision, Cloudflare Workers AI, or Offline OCR"
                    ).classes("text-xs text-slate-300")
                ui.badge("Politeknik Kuching Sarawak", color="blue").classes("text-xs px-3 py-1")

        # ----------------------------------------------------------------------
        # SECTION 1: API SETTINGS (CLOUDFLARE KV, GEMINI VISION & WORKERS AI)
        # ----------------------------------------------------------------------
        needs_setup = not (config.get("cf_account_id") and config.get("cf_api_token"))
        with ui.expansion(
            "1. API Settings: Cloudflare KV, Gemini Vision & Workers AI (Stored Locally)",
            icon="cloud_upload",
            value=needs_setup,
        ).classes("w-full border rounded-xl bg-white shadow-sm"):
            with ui.column().classes("w-full p-3 gap-3"):
                with ui.row().classes("w-full gap-3"):
                    acc_id_input = ui.input(
                        label="Cloudflare Account ID (Used for KV & Workers AI)",
                        value=config.get("cf_account_id", ""),
                    ).classes("flex-1").props("outlined dense")

                    kv_ns_input = ui.input(
                        label="KV Namespace ID",
                        value=config.get("cf_kv_namespace_id", ""),
                    ).classes("flex-1").props("outlined dense")

                with ui.row().classes("w-full gap-3"):
                    cf_token_input = ui.input(
                        label="Cloudflare API Token (KV Edit + Workers AI Read & Edit)",
                        value=config.get("cf_api_token", ""),
                        password=True,
                        password_toggle_button=True,
                    ).classes("flex-1").props("outlined dense")

                    kv_key_input = ui.input(
                        label="KV Key Name",
                        value=config.get("cf_kv_key", "jadual_induk_jkm"),
                    ).classes("flex-1").props("outlined dense")

                with ui.row().classes("w-full gap-3"):
                    gemini_key_input = ui.input(
                        label="Google Gemini API Key (Optional - Fast Scanned PDF Extraction)",
                        value=config.get("gemini_api_key", ""),
                        password=True,
                        password_toggle_button=True,
                    ).classes("flex-1").props("outlined dense")

                    gemini_model_select = ui.select(
                        options=GEMINI_MODELS,
                        label="Gemini Vision Model",
                        value=config.get("gemini_model") if config.get("gemini_model") in GEMINI_MODELS else GEMINI_MODELS[0],
                    ).classes("flex-1").props("outlined dense")

                with ui.row().classes("w-full gap-3"):
                    vision_model_select = ui.select(
                        options=VISION_MODELS,
                        label="Cloudflare Workers AI Vision Model (Alternative)",
                        value=config.get("cf_vision_model") if config.get("cf_vision_model") in VISION_MODELS else VISION_MODELS[0],
                    ).classes("flex-1").props("outlined dense")

                    engine_mode_select = ui.select(
                        options=ENGINE_MODES,
                        label="PDF Extraction Engine Mode",
                        value=config.get("engine_mode") if config.get("engine_mode") in ENGINE_MODES else ENGINE_MODES[0],
                    ).classes("flex-1").props("outlined dense")

                with ui.row().classes("w-full gap-3 items-center"):
                    orientation_select = ui.select(
                        options=ORIENTATION_MODES,
                        label="PDF Page Orientation Fix (Auto-Rotates Sideways Scans Upright)",
                        value=config.get("orientation_mode") if config.get("orientation_mode") in ORIENTATION_MODES else ORIENTATION_MODES[0],
                    ).classes("flex-1").props("outlined dense")

                    _, _, init_pkg_msg = get_offline_package_status()
                    pkg_status_lbl = ui.label(init_pkg_msg).classes("text-xs text-slate-600 flex-1")

                def sync_and_save_settings(notify_user: bool = True) -> Dict[str, Any]:
                    config["cf_account_id"] = (acc_id_input.value or "").strip()
                    config["cf_kv_namespace_id"] = (kv_ns_input.value or "").strip()
                    config["cf_api_token"] = (cf_token_input.value or "").strip()
                    config["cf_kv_key"] = (kv_key_input.value or "jadual_induk_jkm").strip()
                    config["gemini_api_key"] = (gemini_key_input.value or "").strip()
                    config["gemini_model"] = gemini_model_select.value or GEMINI_MODELS[0]
                    config["cf_vision_model"] = vision_model_select.value or VISION_MODELS[0]
                    config["engine_mode"] = engine_mode_select.value or ENGINE_MODES[0]
                    config["orientation_mode"] = orientation_select.value or ORIENTATION_MODES[0]
                    save_config(config)
                    if notify_user:
                        ui.notify("API & orientation settings saved locally.", type="positive")
                    return config

                async def on_test_cf_click() -> None:
                    cfg = sync_and_save_settings(notify_user=False)
                    ui.notify("Testing Cloudflare KV & Workers AI connection...", type="info")
                    ok, msg = await asyncio.to_thread(
                        test_cloudflare_credentials,
                        cfg["cf_account_id"],
                        cfg["cf_kv_namespace_id"],
                        cfg["cf_api_token"],
                        cfg["cf_vision_model"],
                    )
                    ui.notify(msg, type="positive" if ok else "negative", timeout=8000)

                async def on_test_gemini_click() -> None:
                    cfg = sync_and_save_settings(notify_user=False)
                    ui.notify("Testing Google Gemini Vision API connection...", type="info")
                    ok, msg = await asyncio.to_thread(
                        test_gemini_credentials,
                        cfg["gemini_api_key"],
                        cfg["gemini_model"],
                    )
                    ui.notify(msg, type="positive" if ok else "negative", timeout=8000)

                async def on_check_packages_click() -> None:
                    ok_now, missing, status_txt = get_offline_package_status()
                    pkg_status_lbl.text = status_txt
                    if ok_now:
                        ui.notify(status_txt, type="positive")
                        return
                    ui.notify(f"Installing missing packages: {', '.join(missing)}...", type="info")
                    ok, msg = await asyncio.to_thread(install_missing_packages_sync, missing)
                    _, _, new_status = get_offline_package_status()
                    pkg_status_lbl.text = new_status
                    ui.notify(msg, type="positive" if ok else "negative", timeout=7000)

                with ui.row().classes("w-full items-center gap-3 flex-wrap"):
                    ui.button("SAVE SETTINGS", icon="save", on_click=lambda: sync_and_save_settings(True)).props(
                        "color=primary"
                    )
                    ui.button("TEST CLOUDFLARE KV & AI", icon="wifi_tethering", on_click=on_test_cf_click).props(
                        "outline color=secondary"
                    )
                    ui.button("TEST GEMINI API", icon="auto_awesome", on_click=on_test_gemini_click).props(
                        "outline color=accent"
                    )
                    ui.button(
                        "CHECK & AUTO-INSTALL OFFLINE PACKAGES",
                        icon="verified_user",
                        on_click=on_check_packages_click,
                    ).props("outline color=primary")

        # ----------------------------------------------------------------------
        # SECTION 2: COURSE CATALOG MANAGER
        # ----------------------------------------------------------------------
        with ui.expansion(
            "2. Course Catalog Manager (Auto-Built in course_catalog.json)",
            icon="menu_book",
            value=False,
        ).classes("w-full border rounded-xl bg-white shadow-sm"):
            with ui.column().classes("w-full p-3 gap-3"):
                ui.label(
                    "JW Induk PDFs only print Course Codes (e.g., DJJ30323). This local catalog maps codes to full Course Names for Borang PK01."
                ).classes("text-xs text-slate-600")

                with ui.row().classes("w-full gap-2 items-center"):
                    new_code_in = ui.input(label="Course Code (e.g. DJJ30323)").classes("w-48").props("outlined dense")
                    new_name_in = ui.input(label="Official Course Name").classes("flex-1").props("outlined dense")

                    def add_catalog_entry() -> None:
                        c = clean_ocr_course_code(new_code_in.value or "")
                        n = (new_name_in.value or "").strip()
                        if not c or not n:
                            ui.notify("Enter both Course Code and Course Name.", type="warning")
                            return
                        catalog[c] = n
                        save_course_catalog(catalog)
                        new_code_in.value = ""
                        new_name_in.value = ""
                        refresh_catalog_table()
                        for r in app_state["rows"]:
                            if r["Course_Code"] == c:
                                r["Course_Name"] = n
                        refresh_preview_table()
                        ui.notify(f"Saved {c} -> {n}", type="positive")

                    ui.button("ADD / UPDATE", icon="add", on_click=add_catalog_entry).props("color=primary")

                catalog_table = ui.table(
                    columns=[
                        {"name": "code", "label": "Course Code", "field": "code", "sortable": True, "align": "left"},
                        {"name": "name", "label": "Course Name", "field": "name", "sortable": True, "align": "left"},
                    ],
                    rows=[],
                    row_key="code",
                    pagination=8,
                ).classes("w-full")

                def refresh_catalog_table() -> None:
                    catalog_table.rows = [{"code": k, "name": v} for k, v in sorted(catalog.items())]
                    catalog_table.update()

                refresh_catalog_table()

        # ----------------------------------------------------------------------
        # SECTION 3: UPLOAD & EXTRACT TIMETABLE
        # ----------------------------------------------------------------------
        with ui.card().classes("w-full border rounded-xl bg-white p-4 shadow-sm gap-3"):
            with ui.row().classes("w-full items-center justify-between flex-wrap gap-2"):
                ui.label("3. Upload Master Timetable File (PDF / Excel / CSV / JSON)").classes("text-base font-bold")
                with ui.row().classes("items-center gap-2"):
                    cohort_filter = ui.select(
                        options=["ALL"],
                        label="Filter Cohort",
                        value="ALL",
                    ).classes("w-44").props("outlined dense")

                    def delete_selected_rows() -> None:
                        sel_ids = {r["id"] for r in preview_table.selected}
                        if not sel_ids:
                            ui.notify("Select at least one row to delete.", type="warning")
                            return
                        app_state["rows"] = [r for r in app_state["rows"] if r["id"] not in sel_ids]
                        preview_table.selected = []
                        refresh_preview_table()
                        ui.notify(f"Deleted {len(sel_ids)} row(s).", type="info")

                    ui.button("DELETE SELECTED", icon="delete", on_click=delete_selected_rows).props(
                        "outline color=negative"
                    )

            with ui.row().classes("w-full items-center gap-2"):
                extract_spinner = ui.spinner(size="sm").classes("hidden")
                status_lbl = ui.label("No file uploaded yet.").classes("text-xs text-slate-600")

            preview_table = ui.table(
                columns=[
                    {"name": "Cohort", "label": "Cohort / Section", "field": "Cohort", "sortable": True, "align": "left"},
                    {"name": "Course_Code", "label": "Course Code", "field": "Course_Code", "sortable": True, "align": "left"},
                    {"name": "Course_Name", "label": "Course Name", "field": "Course_Name", "sortable": True, "align": "left"},
                    {"name": "Credit", "label": "Credits", "field": "Credit", "sortable": True, "align": "center"},
                    {"name": "Day", "label": "Day", "field": "Day", "sortable": True, "align": "left"},
                    {"name": "Start_Time", "label": "Start Time", "field": "Start_Time", "sortable": True, "align": "center"},
                    {"name": "End_Time", "label": "End Time", "field": "End_Time", "sortable": True, "align": "center"},
                    {"name": "Venue", "label": "Venue", "field": "Venue", "sortable": True, "align": "left"},
                    {"name": "Lecturer", "label": "Lecturer", "field": "Lecturer", "sortable": True, "align": "left"},
                ],
                rows=[],
                row_key="id",
                selection="multiple",
                pagination=15,
            ).classes("w-full")

            def refresh_preview_table() -> None:
                cohorts = sorted({r["Cohort"] for r in app_state["rows"] if r.get("Cohort")})
                cohort_filter.options = ["ALL"] + cohorts
                if cohort_filter.value not in cohort_filter.options:
                    cohort_filter.value = "ALL"
                cohort_filter.update()

                active_filter = cohort_filter.value
                if active_filter and active_filter != "ALL":
                    filtered = [r for r in app_state["rows"] if r["Cohort"] == active_filter]
                else:
                    filtered = list(app_state["rows"])
                preview_table.rows = filtered
                preview_table.update()

            cohort_filter.on_value_change(lambda _: refresh_preview_table())

            async def run_extraction_pipeline(filename: str, raw_bytes: bytes) -> None:
                if app_state["is_extracting"]:
                    ui.notify("Extraction already in progress, please wait...", type="warning")
                    return

                cfg = sync_and_save_settings(notify_user=False)
                acc_id = cfg["cf_account_id"]
                api_token = cfg["cf_api_token"]
                cf_model = cfg["cf_vision_model"]
                gemini_key = cfg["gemini_api_key"]
                gemini_model = cfg["gemini_model"]
                mode = cfg["engine_mode"]
                orient_mode = cfg["orientation_mode"]

                app_state["is_extracting"] = True
                extract_spinner.classes(remove="hidden")
                reextract_btn.disable()
                preview_table.props("loading")

                try:
                    ext = Path(filename).suffix.lower()
                    raw_rows: List[Dict[str, Any]] = []
                    engine_errors: List[str] = []
                    orient_summary = ""
                    used_engine_label = ""

                    if ext == ".pdf":
                        try_gemini = mode in (
                            "Auto: Gemini Vision -> Workers AI -> 100% Offline",
                            "Gemini Vision API Only",
                        )
                        try_workers_ai = mode in (
                            "Auto: Gemini Vision -> Workers AI -> 100% Offline",
                            "Cloudflare Workers AI Only",
                        )
                        try_offline = mode in (
                            "Auto: Gemini Vision -> Workers AI -> 100% Offline",
                            "100% Offline Local Engine Only",
                        )

                        page_images: Optional[List[str]] = None

                        async def _get_upright_pages() -> List[str]:
                            nonlocal page_images, orient_summary
                            if page_images is not None:
                                return page_images
                            status_lbl.text = "Checking PDF orientation & rotating upright..."
                            await asyncio.sleep(0.05)
                            imgs, orient_notes = await asyncio.to_thread(
                                render_pdf_pages_upright_jpeg_b64, raw_bytes, orient_mode
                            )
                            page_images = imgs
                            orient_summary = f" [{', '.join(orient_notes)}]"
                            return page_images

                        # 1. Gemini Vision API
                        if try_gemini:
                            if not gemini_key:
                                if mode == "Gemini Vision API Only":
                                    raise RuntimeError("Google Gemini API Key is blank in Section 1.")
                            else:
                                try:
                                    imgs = await _get_upright_pages()
                                    total_p = len(imgs)
                                    temp_rows: List[Dict[str, Any]] = []
                                    for idx_p, img_b64 in enumerate(imgs, start=1):
                                        status_lbl.text = (
                                            f"Gemini Vision ({gemini_model}): Extracting Page {idx_p} of {total_p}{orient_summary}..."
                                        )
                                        await asyncio.sleep(0.05)
                                        page_rows = await asyncio.to_thread(
                                            call_gemini_vision_page,
                                            gemini_key,
                                            gemini_model,
                                            img_b64,
                                            idx_p,
                                            total_p,
                                        )
                                        temp_rows.extend(page_rows)
                                    if temp_rows:
                                        raw_rows = temp_rows
                                        used_engine_label = f"Gemini ({gemini_model})"
                                except Exception as g_exc:
                                    engine_errors.append(f"Gemini failed: {g_exc}")
                                    if mode == "Gemini Vision API Only":
                                        raise

                        # 2. Cloudflare Workers AI
                        if not raw_rows and try_workers_ai:
                            if not acc_id or not api_token:
                                if mode == "Cloudflare Workers AI Only":
                                    raise RuntimeError("Cloudflare Account ID or API Token is blank in Section 1.")
                            else:
                                try:
                                    imgs = await _get_upright_pages()
                                    total_p = len(imgs)
                                    temp_rows = []
                                    for idx_p, img_b64 in enumerate(imgs, start=1):
                                        status_lbl.text = (
                                            f"Cloudflare Workers AI ({cf_model}): Extracting Page {idx_p} of {total_p}{orient_summary}..."
                                        )
                                        await asyncio.sleep(0.05)
                                        page_rows = await asyncio.to_thread(
                                            call_cloudflare_workers_ai_vision_page,
                                            acc_id,
                                            api_token,
                                            cf_model,
                                            img_b64,
                                            idx_p,
                                            total_p,
                                        )
                                        temp_rows.extend(page_rows)
                                    if temp_rows:
                                        raw_rows = temp_rows
                                        used_engine_label = f"Workers AI ({cf_model})"
                                except Exception as cf_exc:
                                    engine_errors.append(f"Workers AI failed: {cf_exc}")
                                    if mode == "Cloudflare Workers AI Only":
                                        raise

                        # 3. 100% Offline Local Engine
                        if not raw_rows and try_offline:
                            status_lbl.text = "Checking orientation & running 100% Offline Grid + RapidOCR Extractor..."
                            await asyncio.sleep(0.05)
                            off_rows, orient_notes = await asyncio.to_thread(
                                parse_pdf_offline_grid_ocr, raw_bytes, orient_mode
                            )
                            if not orient_summary:
                                orient_summary = f" [{', '.join(orient_notes)}]"
                            if off_rows:
                                raw_rows = off_rows
                                used_engine_label = "100% Offline Grid OCR"

                        if not raw_rows:
                            detail = " | ".join(engine_errors) if engine_errors else "0 rows detected"
                            raise RuntimeError(
                                f"{detail}. Enter a Google Gemini API Key in Section 1 (or adjust Orientation Fix) and click 'Re-Extract Loaded File'."
                            )
                    else:
                        status_lbl.text = f"Parsing {filename}..."
                        await asyncio.sleep(0.05)
                        raw_rows = await asyncio.to_thread(parse_tabular_file, filename, raw_bytes)
                        used_engine_label = "Structured File Parser"

                    # Auto-catalog newly discovered course codes
                    discovered_codes = sorted({
                        clean_ocr_course_code(r.get("Course_Code") or r.get("course_code") or r.get("Code") or "")
                        for r in raw_rows
                    })
                    discovered_codes = [c for c in discovered_codes if c and "TUANGAN" not in c]
                    unknown_codes = [c for c in discovered_codes if c not in catalog and c not in OFFLINE_FALLBACK_CATALOG]

                    if unknown_codes:
                        if gemini_key:
                            status_lbl.text = f"Auto-cataloging {len(unknown_codes)} new course code(s) via Gemini..."
                            await asyncio.sleep(0.05)
                            await asyncio.to_thread(
                                enrich_catalog_with_gemini, gemini_key, gemini_model, unknown_codes, catalog
                            )
                        elif acc_id and api_token:
                            status_lbl.text = f"Auto-cataloging {len(unknown_codes)} new course code(s) via Workers AI..."
                            await asyncio.sleep(0.05)
                            await asyncio.to_thread(
                                enrich_catalog_with_workers_ai, acc_id, api_token, cf_model, unknown_codes, catalog
                            )

                    for c in discovered_codes:
                        if c not in catalog:
                            catalog[c] = OFFLINE_FALLBACK_CATALOG.get(c, f"Course {c}")
                    save_course_catalog(catalog)
                    refresh_catalog_table()

                    normalized = normalize_schedule_rows(raw_rows, catalog)
                    app_state["rows"] = normalized
                    app_state["last_engine_label"] = used_engine_label
                    refresh_preview_table()

                    status_lbl.text = (
                        f"Loaded {len(normalized)} class slots from '{filename}' via {used_engine_label}{orient_summary}."
                    )
                    ui.notify(f"Successfully extracted {len(normalized)} class slots!", type="positive")

                except Exception as err:
                    status_lbl.text = f"Extraction failed: {err}"
                    ui.notify(f"Error reading file: {err}", type="negative", timeout=10000)
                finally:
                    app_state["is_extracting"] = False
                    extract_spinner.classes(add="hidden")
                    reextract_btn.enable()
                    preview_table.props(remove="loading")

            async def handle_file_upload(e: Any) -> None:
                try:
                    if hasattr(e, "file") and e.file is not None:
                        fname = e.file.name
                        data = await e.file.read()
                    else:
                        fname = getattr(e, "name", "uploaded_file.pdf")
                        content_obj = getattr(e, "content", None)
                        data = content_obj.read() if content_obj is not None else b""

                    if not data:
                        ui.notify("Uploaded file appears empty.", type="warning")
                        return

                    app_state["last_filename"] = fname
                    app_state["last_bytes"] = data
                    await run_extraction_pipeline(fname, data)
                except Exception as exc:
                    ui.notify(f"Upload error: {exc}", type="negative")

            async def handle_reextract_click() -> None:
                if not app_state["last_bytes"]:
                    ui.notify("Please upload a file first.", type="warning")
                    return
                await run_extraction_pipeline(app_state["last_filename"], app_state["last_bytes"])

            with ui.row().classes("w-full items-center gap-3 flex-wrap"):
                ui.upload(
                    label="Select or Drag JW Induk File (.pdf, .xlsx, .csv, .json)",
                    on_upload=handle_file_upload,
                    auto_upload=True,
                ).props('accept=".pdf,.xlsx,.xls,.csv,.json"').classes("flex-1")

                reextract_btn = ui.button(
                    "RE-EXTRACT LOADED FILE",
                    icon="refresh",
                    on_click=handle_reextract_click,
                ).props("outline color=primary")

        # ----------------------------------------------------------------------
        # FOOTER ACTION BUTTONS (EXPORT & PUSH TO CLOUDFLARE KV)
        # ----------------------------------------------------------------------
        def export_local_json() -> None:
            if not app_state["rows"]:
                ui.notify("No timetable rows to export.", type="warning")
                return
            export_rows = [{k: v for k, v in r.items() if k != "id"} for r in app_state["rows"]]
            out_path = APP_DIR / f"{config.get('cf_kv_key', 'jadual_induk_jkm')}_backup.json"
            out_path.write_text(json.dumps(export_rows, indent=2, ensure_ascii=False), encoding="utf-8")
            ui.notify(f"Saved backup to: {out_path}", type="positive", timeout=6000)

        async def push_to_cloudflare_kv() -> None:
            if not app_state["rows"]:
                ui.notify("No timetable rows to push. Upload and extract a file first.", type="warning")
                return
            cfg = sync_and_save_settings(notify_user=False)
            acc_id = cfg["cf_account_id"]
            ns_id = cfg["cf_kv_namespace_id"]
            token = cfg["cf_api_token"]
            kv_key = cfg["cf_kv_key"] or "jadual_induk_jkm"

            if not acc_id or not ns_id or not token:
                ui.notify("Please fill in Account ID, KV Namespace ID, and API Token in Section 1.", type="negative")
                return

            payload_rows = [{k: v for k, v in r.items() if k != "id"} for r in app_state["rows"]]
            base_kv_url = f"https://api.cloudflare.com/client/v4/accounts/{acc_id}/storage/kv/namespaces/{ns_id}/values"
            url = f"{base_kv_url}/{kv_key}"
            history_url = f"{base_kv_url}/{kv_key}_history"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            read_headers = {"Authorization": f"Bearer {token}"}

            ui.notify(f"Pushing {len(payload_rows)} class slots to Cloudflare KV ('{kv_key}')...", type="info")

            def _put_kv_with_history() -> Tuple[requests.Response, Optional[Dict[str, Any]]]:
                prev_slots = 0
                try:
                    prev_resp = requests.get(url, headers=read_headers, timeout=15)
                    if prev_resp.status_code == 200 and prev_resp.text.strip():
                        prev_data = prev_resp.json()
                        if isinstance(prev_data, list):
                            prev_slots = len(prev_data)
                except Exception:
                    pass

                put_resp = requests.put(
                    url,
                    headers=headers,
                    data=json.dumps(payload_rows, ensure_ascii=False).encode("utf-8"),
                    timeout=30,
                )

                log_entry: Optional[Dict[str, Any]] = None
                if put_resp.status_code == 200 and put_resp.json().get("success"):
                    existing_logs: List[Dict[str, Any]] = []
                    try:
                        hist_resp = requests.get(history_url, headers=read_headers, timeout=15)
                        if hist_resp.status_code == 200 and hist_resp.text.strip():
                            parsed_hist = hist_resp.json()
                            if isinstance(parsed_hist, list):
                                existing_logs = parsed_hist
                    except Exception:
                        pass

                    new_slots = len(payload_rows)
                    cohorts_count = len({r.get("Cohort", "") for r in payload_rows if r.get("Cohort")})
                    now_iso = datetime.now(timezone.utc).isoformat()
                    log_entry = {
                        "id": f"kv_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                        "timestamp": now_iso,
                        "source": "desktop_kv",
                        "filename": app_state.get("last_filename") or "Desktop Upload",
                        "previousSlots": prev_slots,
                        "newSlots": new_slots,
                        "deltaSlots": new_slots - prev_slots,
                        "cohortsCount": cohorts_count,
                        "engineLabel": app_state.get("last_engine_label") or "Desktop Admin",
                    }
                    updated_logs = ([log_entry] + existing_logs)[:50]
                    try:
                        requests.put(
                            history_url,
                            headers=headers,
                            data=json.dumps(updated_logs, ensure_ascii=False).encode("utf-8"),
                            timeout=20,
                        )
                    except Exception:
                        pass

                return put_resp, log_entry

            resp, created_log = await asyncio.to_thread(_put_kv_with_history)
            if resp.status_code == 200 and resp.json().get("success"):
                diff_txt = ""
                if created_log:
                    delta = created_log["deltaSlots"]
                    sign = "+" if delta > 0 else ""
                    diff_txt = f" (Before: {created_log['previousSlots']} -> After: {created_log['newSlots']}, {sign}{delta})"
                ui.notify(
                    f"Success! Pushed {len(payload_rows)} class slots to Cloudflare KV key '{kv_key}'{diff_txt}.",
                    type="positive",
                    timeout=7000,
                )
            else:
                ui.notify(
                    f"Cloudflare KV Push Failed (HTTP {resp.status_code}): {resp.text[:250]}",
                    type="negative",
                    timeout=10000,
                )

        with ui.row().classes("w-full justify-end gap-3"):
            ui.button("EXPORT LOCAL JSON BACKUP", icon="download", on_click=export_local_json).props(
                "outline color=primary"
            )
            ui.button("PUSH & UPDATE TO CLOUDFLARE KV", icon="rocket_launch", on_click=push_to_cloudflare_kv).props(
                "color=primary"
            )

        async def startup_package_check() -> None:
            ok_now, missing, status_txt = get_offline_package_status()
            pkg_status_lbl.text = status_txt
            if not ok_now and missing:
                ui.notify(f"Auto-installing missing offline helpers: {', '.join(missing)}...", type="info")
                await asyncio.to_thread(install_missing_packages_sync, missing)
                _, _, updated_txt = get_offline_package_status()
                pkg_status_lbl.text = updated_txt

        ui.timer(0.8, startup_package_check, once=True)


build_app()
ui.run(
    title="JKM Master Timetable Admin - Cloudflare",
    native=True,
    window_size=(1240, 860),
    reload=False,
)
