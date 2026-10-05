import os
import re
import shutil
import subprocess
import tempfile
import json
import uuid
import math
import wave
import threading
from concurrent.futures import ThreadPoolExecutor
from array import array

from datetime import datetime, timezone

from pathlib import Path

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    Body,
    WebSocket,
    WebSocketDisconnect,
)

from fastapi.middleware.cors import CORSMiddleware

from voice_detector import analyze_voice
from audio_forensics import analyze_audio_forensics
from speaker_verifier import verify_speaker
from trust_circle import search_trust_circle
from partial_clone_detector import analyze_audio_timeline
from robustness_analyzer import analyze_robustness
from replay_detector import analyze_replay_evidence
from evidence_fusion import fuse_evidence


# =========================================================
# CONFIGURATION
# =========================================================

FFMPEG_PATH = (
    r"C:\Users\admin\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
)

BASE_DIR = Path(__file__).resolve().parent

TRUSTED_IDENTITIES_DIR = (
    BASE_DIR / "trusted_identities"
)

TRUSTED_IDENTITIES_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# =========================================================
# LIVE LAYER 2 SESSION MEMORY
# =========================================================

LIVE_IDENTITY_MIN_VOICED_SECONDS = 4.0
LIVE_IDENTITY_RECHECK_SECONDS = 9999.0
LIVE_IDENTITY_MAX_AUDIO_SECONDS = 24
LIVE_SESSION_LOCK = threading.RLock()
LIVE_SESSIONS = {}

# Keep heavy ECAPA / Trust Circle work off the live HTTP response path.
LIVE_IDENTITY_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="aia-live-identity",
)


HISTORY_FILE = BASE_DIR / "analysis_history.json"


def load_analysis_history():
    if not HISTORY_FILE.exists():
        return []

    try:
        with HISTORY_FILE.open(
            "r",
            encoding="utf-8",
        ) as history_file:
            data = json.load(history_file)

        return data if isinstance(data, list) else []

    except (json.JSONDecodeError, OSError):
        return []


def write_analysis_history(records):
    temporary_file = HISTORY_FILE.with_suffix(".tmp")

    with temporary_file.open(
        "w",
        encoding="utf-8",
    ) as history_file:
        json.dump(
            records,
            history_file,
            indent=2,
            ensure_ascii=False,
        )

    temporary_file.replace(HISTORY_FILE)


def save_analysis_history_record(record):
    records = load_analysis_history()
    records.insert(0, record)

    # Keep the prototype history bounded.
    records = records[:200]

    write_analysis_history(records)


ALERTS_FILE = BASE_DIR / "alerts.json"
SECURITY_EVENTS_FILE = BASE_DIR / "security_events.json"


PRIVACY_SETTINGS_FILE = BASE_DIR / "privacy_settings.json"

DEFAULT_PRIVACY_SETTINGS = {
    "raw_audio_retention": False,
    "metadata_retention_days": 30,
    "store_filenames": True,
    "feature_only_logging": True,
}


def load_privacy_settings():
    if not PRIVACY_SETTINGS_FILE.exists():
        write_privacy_settings(
            DEFAULT_PRIVACY_SETTINGS
        )
        return DEFAULT_PRIVACY_SETTINGS.copy()

    try:
        with PRIVACY_SETTINGS_FILE.open(
            "r",
            encoding="utf-8",
        ) as settings_file:
            data = json.load(settings_file)

        if not isinstance(data, dict):
            return DEFAULT_PRIVACY_SETTINGS.copy()

        settings = DEFAULT_PRIVACY_SETTINGS.copy()
        settings.update(data)

        settings["raw_audio_retention"] = False
        settings["feature_only_logging"] = True

        return settings

    except (json.JSONDecodeError, OSError):
        return DEFAULT_PRIVACY_SETTINGS.copy()


def write_privacy_settings(settings):
    temporary_file = PRIVACY_SETTINGS_FILE.with_suffix(".tmp")

    with temporary_file.open(
        "w",
        encoding="utf-8",
    ) as settings_file:
        json.dump(
            settings,
            settings_file,
            indent=2,
            ensure_ascii=False,
        )

    temporary_file.replace(PRIVACY_SETTINGS_FILE)


def redact_filename_if_needed(
    filename: str,
    settings: dict,
):
    if settings.get("store_filenames", True):
        return filename

    return "[filename not retained]"


def prune_records_by_retention(
    file_path: Path,
    retention_days: int,
):
    records = load_json_records(file_path)

    now = datetime.now(timezone.utc)
    kept = []

    for record in records:
        timestamp = record.get("timestamp")

        try:
            parsed = datetime.fromisoformat(
                timestamp.replace("Z", "+00:00")
            )

            if parsed.tzinfo is None:
                parsed = parsed.replace(
                    tzinfo=timezone.utc
                )

            age_days = (
                now
                - parsed.astimezone(timezone.utc)
            ).total_seconds() / 86400

            if age_days <= retention_days:
                kept.append(record)

        except Exception:
            kept.append(record)

    write_json_records(
        file_path,
        kept,
    )

    return len(records) - len(kept)


def apply_metadata_retention():
    settings = load_privacy_settings()

    retention_days = int(
        settings.get(
            "metadata_retention_days",
            30,
        )
    )

    return {
        "history": prune_records_by_retention(
            HISTORY_FILE,
            retention_days,
        ),
        "alerts": prune_records_by_retention(
            ALERTS_FILE,
            retention_days,
        ),
        "events": prune_records_by_retention(
            SECURITY_EVENTS_FILE,
            retention_days,
        ),
    }


def load_json_records(file_path: Path):
    if not file_path.exists():
        return []

    try:
        with file_path.open(
            "r",
            encoding="utf-8",
        ) as json_file:
            data = json.load(json_file)

        return data if isinstance(data, list) else []

    except (json.JSONDecodeError, OSError):
        return []


def write_json_records(
    file_path: Path,
    records,
):
    temporary_file = file_path.with_suffix(".tmp")

    with temporary_file.open(
        "w",
        encoding="utf-8",
    ) as json_file:
        json.dump(
            records,
            json_file,
            indent=2,
            ensure_ascii=False,
        )

    temporary_file.replace(file_path)


def save_security_event(record):
    records = load_json_records(
        SECURITY_EVENTS_FILE
    )

    records.insert(0, record)

    # Keep the prototype event log bounded.
    records = records[:500]

    write_json_records(
        SECURITY_EVENTS_FILE,
        records,
    )


def save_alert(record):
    records = load_json_records(
        ALERTS_FILE
    )

    records.insert(0, record)

    # Keep the prototype alerts list bounded.
    records = records[:200]

    write_json_records(
        ALERTS_FILE,
        records,
    )


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="AIA - Audio Integrity Analyzer",
    description=(
        "AI-powered voice authenticity, "
        "forensics, speaker verification and "
        "automatic Trust Circle analysis API"
    ),
    version="0.6.0",
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



# =========================================================
# WEBRTC SIGNALING — CROSS-DEVICE DEMO
# =========================================================

SIGNALING_ROOMS: dict[str, dict[str, WebSocket]] = {}
SIGNALING_LOCK = threading.Lock()


@app.websocket("/ws/signaling/{room_id}/{peer_id}")
async def websocket_signaling(
    websocket: WebSocket,
    room_id: str,
    peer_id: str,
):
    """
    Lightweight WebRTC signaling relay for the AIA demo.

    The server does not inspect or process WebRTC media.
    It only relays offer / answer / ICE signaling JSON
    between peers that joined the same room.
    """
    room_key = room_id.strip().upper()
    peer_key = peer_id.strip()

    await websocket.accept()

    with SIGNALING_LOCK:
        room = SIGNALING_ROOMS.setdefault(room_key, {})
        room[peer_key] = websocket
        peer_count = len(room)

    try:
        await websocket.send_json(
            {
                "type": "signaling-ready",
                "room": room_key,
                "peer_count": peer_count,
            }
        )

        while True:
            payload = await websocket.receive_json()
            payload["from"] = peer_key

            with SIGNALING_LOCK:
                recipients = [
                    (other_id, other_socket)
                    for other_id, other_socket in SIGNALING_ROOMS
                    .get(room_key, {})
                    .items()
                    if other_id != peer_key
                ]

            stale_peers = []
            for other_id, other_socket in recipients:
                try:
                    await other_socket.send_json(payload)
                except Exception:
                    stale_peers.append(other_id)

            if stale_peers:
                with SIGNALING_LOCK:
                    room = SIGNALING_ROOMS.get(room_key, {})
                    for stale_id in stale_peers:
                        room.pop(stale_id, None)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(
            f"Signaling error in room {room_key} "
            f"for peer {peer_key}: {exc}"
        )
    finally:
        with SIGNALING_LOCK:
            room = SIGNALING_ROOMS.get(room_key)
            if room:
                room.pop(peer_key, None)
                if not room:
                    SIGNALING_ROOMS.pop(room_key, None)

# =========================================================
# AUDIO TYPES
# =========================================================

ALLOWED_AUDIO_TYPES = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/aac",
    "audio/flac",
    "audio/x-flac",
    "audio/ogg",
    "audio/webm",
    "audio/webm;codecs=opus",
    "video/webm",
    "application/octet-stream",
]



# =========================================================
# HELPER: SPEECH / AUDIO ACTIVITY CHECK
# =========================================================

def analyze_speech_activity(
    wav_path: str,
):
    """
    Hybrid speech/activity gate for live WebRTC audio.

    WebRTC VAD is still the primary speech detector, but browser/phone WebRTC
    audio can occasionally be rejected even while a person is clearly speaking.
    To avoid repeated false "NO SPEECH" chunks, this function also computes
    frame-level RMS energy as a conservative fallback.

    IMPORTANT:
    - This gate only decides whether a chunk contains enough usable voice-like
      audio to analyze and accumulate for Trust Circle.
    - It does NOT decide whether the speech is genuine or synthetic.
    - The deepfake model still receives the same normalized WAV as before.
    """

    try:
        import webrtcvad
    except ImportError as error:
        raise RuntimeError(
            "WebRTC VAD is not installed. Run: "
            "pip install webrtcvad-wheels"
        ) from error

    with wave.open(wav_path, "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw_audio = wav_file.readframes(frame_count)

    if channels != 1:
        raise RuntimeError("Live VAD expected mono audio.")

    if sample_width != 2:
        raise RuntimeError("Live VAD expected 16-bit PCM audio.")

    if sample_rate not in {8000, 16000, 32000, 48000}:
        raise RuntimeError(
            "WebRTC VAD received an unsupported sample rate."
        )

    if not raw_audio:
        return {
            "speech_detected": False,
            "voiced_ratio": 0.0,
            "voiced_frames": 0,
            "total_frames": 0,
            "voiced_seconds": 0.0,
            "energy_active_ratio": 0.0,
            "energy_active_seconds": 0.0,
            "speech_gate_source": "none",
            "note": "No usable audio samples were found.",
        }

    frame_ms = 30
    bytes_per_sample = 2
    frame_bytes = int(
        sample_rate * (frame_ms / 1000.0) * bytes_per_sample
    )

    # Less aggressive than the previous mode 2.
    vad = webrtcvad.Vad()
    vad.set_mode(1)

    voiced_frames = 0
    energy_active_frames = 0
    total_frames = 0

    # Conservative absolute RMS floor for 16-bit PCM.
    # ~300 corresponds to roughly -41 dBFS. This is intentionally low enough
    # to catch normal phone speech without treating near-silence as speech.
    energy_rms_threshold = 300.0

    for offset in range(
        0,
        len(raw_audio) - frame_bytes + 1,
        frame_bytes,
    ):
        frame = raw_audio[offset:offset + frame_bytes]

        if len(frame) != frame_bytes:
            continue

        total_frames += 1

        try:
            if vad.is_speech(frame, sample_rate):
                voiced_frames += 1
        except Exception:
            pass

        # Independent energy fallback.
        samples = array("h")
        samples.frombytes(frame)
        if samples:
            mean_square = sum(float(x) * float(x) for x in samples) / len(samples)
            rms = math.sqrt(mean_square)
            if rms >= energy_rms_threshold:
                energy_active_frames += 1

    voiced_ratio = (
        voiced_frames / total_frames
        if total_frames
        else 0.0
    )

    energy_active_ratio = (
        energy_active_frames / total_frames
        if total_frames
        else 0.0
    )

    vad_voiced_seconds = (
        voiced_frames * frame_ms
    ) / 1000.0

    energy_active_seconds = (
        energy_active_frames * frame_ms
    ) / 1000.0

    # Primary VAD gate: relaxed for cross-device phone/WebRTC speech.
    vad_pass = (
        voiced_ratio >= 0.06
        and vad_voiced_seconds >= 0.20
    )

    # Fallback gate: require a little more sustained energy than the VAD gate.
    # This catches clear speaking that WebRTC VAD sometimes misses after
    # codec/resampling transformations.
    energy_pass = (
        energy_active_ratio >= 0.12
        and energy_active_seconds >= 0.35
    )

    speech_detected = vad_pass or energy_pass

    # Trust Circle needs an estimate of usable speaker evidence. If VAD missed
    # speech but the energy fallback passed, use the active-energy duration.
    effective_voiced_seconds = max(
        vad_voiced_seconds,
        energy_active_seconds if energy_pass else 0.0,
    )

    gate_source = (
        "webrtc_vad+energy"
        if vad_pass and energy_pass
        else "webrtc_vad"
        if vad_pass
        else "energy_fallback"
        if energy_pass
        else "none"
    )

    return {
        "speech_detected": speech_detected,
        "voiced_ratio": round(voiced_ratio, 4),
        "voiced_frames": voiced_frames,
        "total_frames": total_frames,
        "voiced_seconds": round(effective_voiced_seconds, 3),
        "vad_voiced_seconds": round(vad_voiced_seconds, 3),
        "energy_active_ratio": round(energy_active_ratio, 4),
        "energy_active_seconds": round(energy_active_seconds, 3),
        "energy_rms_threshold": energy_rms_threshold,
        "speech_gate_source": gate_source,
        "vad_mode": 1,
        "frame_ms": frame_ms,
        "note": (
            "Speech/activity detected. Chunk is eligible for synthetic-voice analysis."
            if speech_detected
            else (
                "No sufficient speech/activity detected. "
                "Chunk is excluded from the session risk score."
            )
        ),
    }


# =========================================================
# HELPER: NORMALIZE AUDIO
# =========================================================

def normalize_audio(
    input_path: str,
    output_path: str,
):
    subprocess.run(
        [
            FFMPEG_PATH,
            "-y",
            "-i",
            input_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            output_path,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )



# =========================================================
# EXPERIMENTAL: LIGHT NOISE-ROBUSTNESS PREPROCESSING
# =========================================================

def create_lightly_cleaned_audio(
    input_wav: str,
    output_wav: str,
):
    """
    Experimental only.

    Creates a lightly speech-focused version of the microphone chunk
    using conservative FFmpeg filters:
      - high-pass at 80 Hz (reduces low-frequency rumble)
      - low-pass at 7600 Hz (keeps almost the full 16 kHz speech band)
      - gentle loudness normalization

    IMPORTANT:
    This cleaned score does NOT affect the Layer-1 verdict.
    It is returned only so we can compare original vs cleaned audio
    on genuine and synthetic noisy-room tests before adopting anything.
    """
    subprocess.run(
        [
            FFMPEG_PATH,
            "-y",
            "-i",
            input_wav,
            "-af",
            (
                "highpass=f=80,"
                "lowpass=f=7600,"
                "loudnorm=I=-23:LRA=7:TP=-2"
            ),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            output_wav,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def build_noise_robustness_comparison(
    original_fake_probability: float,
    cleaned_fake_probability: float,
):
    original_score = round(original_fake_probability * 100, 1)
    cleaned_score = round(cleaned_fake_probability * 100, 1)
    difference = round(cleaned_score - original_score, 1)

    if difference >= 10:
        observation = (
            "Cleaning increased synthetic evidence on this chunk."
        )
    elif difference <= -10:
        observation = (
            "Cleaning reduced synthetic evidence on this chunk."
        )
    else:
        observation = (
            "Cleaning caused only a small score change on this chunk."
        )

    return {
        "enabled": True,
        "experimental_only": True,
        "affects_live_verdict": False,
        "original_synthetic_score": original_score,
        "cleaned_synthetic_score": cleaned_score,
        "difference_percentage_points": difference,
        "observation": observation,
        "warning": (
            "Do not interpret a higher cleaned score as proof that "
            "cleaning is better. Validate against both synthetic and "
            "genuine speech before changing the production pipeline."
        ),
    }


# =========================================================
# HELPER: SAFE IDENTITY NAME
# =========================================================

def sanitize_identity_name(
    identity: str,
):
    identity = identity.strip().lower()

    identity = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        identity,
    )

    identity = identity.strip("_")

    if not identity:
        raise HTTPException(
            status_code=400,
            detail="Invalid identity name.",
        )

    return identity


# =========================================================
# HELPER: GET ALL REFERENCE FILES
# =========================================================

def get_identity_reference_files(
    identity_directory: Path,
):
    references = []

    # Old format support
    legacy_reference = (
        identity_directory / "reference.wav"
    )

    if legacy_reference.exists():
        references.append(
            legacy_reference
        )

    # New format
    numbered_references = sorted(
        identity_directory.glob(
            "reference_*.wav"
        )
    )

    for reference in numbered_references:
        if reference not in references:
            references.append(
                reference
            )

    return references


# =========================================================
# HELPER: NEXT REFERENCE NUMBER
# =========================================================

def get_next_reference_path(
    identity_directory: Path,
):
    """
    Find the next unused reference filename.

    Example:

    reference_1.wav exists
    reference_2.wav exists

    returns:
    reference_3.wav
    """

    existing_numbers = []

    for reference in identity_directory.glob(
        "reference_*.wav"
    ):

        match = re.match(
            r"reference_(\d+)\.wav$",
            reference.name,
        )

        if match:
            existing_numbers.append(
                int(match.group(1))
            )

    next_number = (
        max(existing_numbers) + 1
        if existing_numbers
        else 1
    )

    return (
        identity_directory
        / f"reference_{next_number}.wav"
    )


# =========================================================
# HOME / HEALTH CHECK
# =========================================================

@app.get("/")
def home():

    return {
        "message": (
            "AIA Audio Integrity Analyzer "
            "backend is running"
        ),
        "version": "0.6.0",
    }


# =========================================================
# LIST TRUSTED IDENTITIES
# =========================================================

@app.get("/trusted-identities")
def get_trusted_identities():

    identities = []

    for identity_directory in sorted(
        TRUSTED_IDENTITIES_DIR.iterdir(),
        key=lambda path: path.name.lower(),
    ):

        if not identity_directory.is_dir():
            continue

        reference_files = (
            get_identity_reference_files(
                identity_directory
            )
        )

        if not reference_files:
            continue

        identities.append(
            {
                "identity":
                    identity_directory.name,

                "sample_count":
                    len(reference_files),
            }
        )

    return {
        "identities": identities,
    }


# =========================================================
# ENROLL TRUSTED SPEAKER
# =========================================================

@app.post("/enroll-speaker")
async def enroll_speaker(
    identity: str = Form(...),
    file: UploadFile = File(...),
):

    if (
        file.content_type
        not in ALLOWED_AUDIO_TYPES
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Please upload a supported "
                "audio file."
            ),
        )

    safe_identity = (
        sanitize_identity_name(
            identity
        )
    )

    identity_directory = (
        TRUSTED_IDENTITIES_DIR
        / safe_identity
    )

    # Automatically create identity folder
    identity_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_input = None

    try:

        # -----------------------------------------
        # SAVE UPLOADED FILE TEMPORARILY
        # -----------------------------------------

        filename = (
            file.filename
            or "reference_audio"
        )

        suffix = os.path.splitext(
            filename
        )[1]

        if not suffix:
            suffix = ".audio"

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
        ) as temp_file:

            shutil.copyfileobj(
                file.file,
                temp_file,
            )

            temporary_input = (
                temp_file.name
            )

        # -----------------------------------------
        # GET NEXT REFERENCE FILE
        # -----------------------------------------

        reference_wav = (
            get_next_reference_path(
                identity_directory
            )
        )

        # -----------------------------------------
        # NORMALIZE AND STORE
        # -----------------------------------------

        normalize_audio(
            temporary_input,
            str(reference_wav),
        )

        reference_files = (
            get_identity_reference_files(
                identity_directory
            )
        )

        return {
            "message": (
                f'Voice sample added to '
                f'"{safe_identity}" successfully.'
            ),

            "identity":
                safe_identity,

            "reference_file":
                reference_wav.name,

            "sample_count":
                len(reference_files),

            "reference_enrolled":
                True,
        }

    except subprocess.CalledProcessError:

        raise HTTPException(
            status_code=400,
            detail=(
                "Reference audio conversion failed. "
                "The audio may be corrupted or unsupported."
            ),
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                "Speaker enrollment failed: "
                f"{str(error)}"
            ),
        )

    finally:

        if (
            temporary_input
            and os.path.exists(
                temporary_input
            )
        ):

            os.remove(
                temporary_input
            )


# =========================================================
# DELETE TRUSTED IDENTITY
# =========================================================

@app.delete(
    "/trusted-identities/{identity}"
)
def delete_trusted_identity(
    identity: str,
):

    safe_identity = (
        sanitize_identity_name(
            identity
        )
    )

    identity_directory = (
        TRUSTED_IDENTITIES_DIR
        / safe_identity
    )

    if not identity_directory.exists():

        raise HTTPException(
            status_code=404,
            detail=(
                "Trusted identity not found."
            ),
        )

    shutil.rmtree(
        identity_directory
    )

    return {
        "message": (
            f'Identity "{safe_identity}" deleted.'
        ),
    }


# =========================================================
# ANALYSIS HISTORY
# =========================================================

@app.get("/analysis-history")
def get_analysis_history():
    return {
        "history": load_analysis_history(),
    }


@app.delete("/analysis-history")
def clear_analysis_history():
    write_analysis_history([])

    return {
        "message": "Analysis history cleared.",
    }


# =========================================================
# ALERTS + SECURITY EVENT LOG
# =========================================================

@app.get("/alerts")
def get_alerts():
    return {
        "alerts": load_json_records(
            ALERTS_FILE
        ),
    }


@app.delete("/alerts")
def clear_alerts():
    write_json_records(
        ALERTS_FILE,
        [],
    )

    return {
        "message": "Alerts cleared.",
    }


@app.get("/security-events")
def get_security_events():
    return {
        "events": load_json_records(
            SECURITY_EVENTS_FILE
        ),
    }


@app.delete("/security-events")
def clear_security_events():
    write_json_records(
        SECURITY_EVENTS_FILE,
        [],
    )

    return {
        "message": "Security event log cleared.",
    }


# =========================================================
# PRIVACY CONTROLS
# =========================================================

@app.get("/privacy-settings")
def get_privacy_settings():
    settings = load_privacy_settings()

    return {
        "settings": settings,
        "privacy_note": (
            "Raw analysis audio is not retained. "
            "Persistent logs contain derived summary metadata only."
        ),
    }


@app.put("/privacy-settings")
def update_privacy_settings(
    payload: dict = Body(...),
):
    current = load_privacy_settings()

    allowed_retention_days = {
        1,
        7,
        30,
        90,
    }

    if "metadata_retention_days" in payload:
        try:
            retention_days = int(
                payload["metadata_retention_days"]
            )
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=(
                    "metadata_retention_days must be "
                    "1, 7, 30, or 90."
                ),
            )

        if retention_days not in allowed_retention_days:
            raise HTTPException(
                status_code=400,
                detail=(
                    "metadata_retention_days must be "
                    "1, 7, 30, or 90."
                ),
            )

        current["metadata_retention_days"] = retention_days

    if "store_filenames" in payload:
        current["store_filenames"] = bool(
            payload["store_filenames"]
        )

    current["raw_audio_retention"] = False
    current["feature_only_logging"] = True

    write_privacy_settings(current)

    removed = apply_metadata_retention()

    return {
        "message": "Privacy settings updated.",
        "settings": current,
        "retention_cleanup": removed,
    }


@app.post("/privacy/purge-expired")
def purge_expired_metadata():
    removed = apply_metadata_retention()

    return {
        "message": "Expired metadata purged.",
        "removed": removed,
    }


# =========================================================
# LIVE ANALYSIS — LAYERS 1 + 2
# =========================================================

def _read_pcm16_mono_wav(wav_path: str):
    with wave.open(wav_path, "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2:
            raise RuntimeError("Live identity buffer expected mono 16-bit PCM audio.")
        sample_rate = wav_file.getframerate()
        pcm = wav_file.readframes(wav_file.getnframes())
    return sample_rate, pcm


def _write_pcm16_mono_wav(wav_path: str, sample_rate: int, pcm: bytes):
    with wave.open(wav_path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)


def _live_identity_snapshot(session_id: str):
    with LIVE_SESSION_LOCK:
        session = LIVE_SESSIONS.get(session_id)
        if not session:
            return {
                "status": "COLLECTING",
                "speech_collected_seconds": 0.0,
                "minimum_speech_seconds": LIVE_IDENTITY_MIN_VOICED_SECONDS,
                "trust_circle": None,
                "verification_in_progress": False,
                "note": "Collecting enough speech for Trust Circle verification.",
            }

        total_voiced = sum(
            float(v) for v in session.get("voiced_seconds", {}).values()
        )
        result = session.get("last_result")
        busy = bool(session.get("verification_in_progress", False))

        if busy:
            status = "VERIFYING"
            note = "Trust Circle verification is running in the background."
        elif result is not None:
            status = "VERIFIED"
            note = "Latest Trust Circle result is available."
        elif total_voiced < LIVE_IDENTITY_MIN_VOICED_SECONDS:
            status = "COLLECTING"
            note = "Collecting enough speech for Trust Circle verification."
        else:
            status = "MONITORING"
            note = "Enough speech is available; Trust Circle verification is queued."

        return {
            "status": status,
            "speech_collected_seconds": round(total_voiced, 1),
            "minimum_speech_seconds": LIVE_IDENTITY_MIN_VOICED_SECONDS,
            "trust_circle": result,
            "verification_in_progress": busy,
            "note": note,
        }


def _run_live_identity_verification(
    session_id: str,
    sample_rate: int,
    combined_pcm: bytes,
    verified_voiced_seconds: float,
):
    temp_identity_wav = None
    trust_result = None
    error_message = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
            temp_identity_wav = f.name

        _write_pcm16_mono_wav(
            temp_identity_wav,
            sample_rate,
            combined_pcm,
        )
        trust_result = search_trust_circle(temp_identity_wav)

    except Exception as error:
        error_message = str(error)
        print("Live Trust Circle verification failed:", error)

    finally:
        if temp_identity_wav and os.path.exists(temp_identity_wav):
            try:
                os.remove(temp_identity_wav)
            except OSError:
                pass

    with LIVE_SESSION_LOCK:
        session = LIVE_SESSIONS.get(session_id)
        if session is None:
            return

        session["verification_in_progress"] = False

        if trust_result is not None:
            session["last_result"] = trust_result
            session["last_verified_voiced_seconds"] = verified_voiced_seconds
            session["last_identity_error"] = None
        else:
            session["last_identity_error"] = error_message


def update_live_identity_session(
    session_id: str,
    chunk_index: int,
    wav_path: str,
    voiced_seconds: float,
):
    """
    Live Layer 2 accumulator.

    During live capture we ONLY collect temporary normalized PCM and VAD
    speech duration. ECAPA is intentionally not run here, so Layer 1 remains
    responsive and there is no background verification/finalization race.

    One Trust Circle verification is performed synchronously at STOP by
    /live-session/{session_id}/finalize.
    """
    sample_rate, pcm = _read_pcm16_mono_wav(wav_path)

    with LIVE_SESSION_LOCK:
        session = LIVE_SESSIONS.setdefault(
            session_id,
            {
                "sample_rate": sample_rate,
                "chunks": {},
                "voiced_seconds": {},
                "last_verified_voiced_seconds": 0.0,
                "last_result": None,
                "verification_in_progress": False,
                "verification_started_once": False,
                "last_identity_error": None,
            },
        )

        session["chunks"][chunk_index] = pcm
        session["voiced_seconds"][chunk_index] = max(
            0.0,
            float(voiced_seconds),
        )

        total_voiced = sum(
            float(v)
            for v in session["voiced_seconds"].values()
        )

        # This flag now means enough speaker evidence has been collected.
        session["speaker_evidence_ready"] = (
            total_voiced >= LIVE_IDENTITY_MIN_VOICED_SECONDS
        )

    snapshot = _live_identity_snapshot(session_id)

    if snapshot["speech_collected_seconds"] >= LIVE_IDENTITY_MIN_VOICED_SECONDS:
        snapshot["status"] = "READY"
        snapshot["verification_in_progress"] = False
        snapshot["note"] = (
            "Enough speaker evidence is collected. Trust Circle verification "
            "will run once when the live session is finalized."
        )

    return snapshot


@app.post("/live-session/{session_id}/finalize")
def finalize_live_session(session_id: str):
    """
    Authoritative live Layer 2 finalization.

    At STOP:
    1. snapshot the accumulated live PCM,
    2. use at most the most recent 12 seconds,
    3. run exactly ONE synchronous Trust Circle search,
    4. persist and return that result,
    5. let the frontend build Layer 2C,
    6. frontend deletes temporary session memory afterward.

    This deliberately avoids background ECAPA jobs and their race with DELETE.
    """
    import time

    started = time.monotonic()

    with LIVE_SESSION_LOCK:
        session = LIVE_SESSIONS.get(session_id)

        if session is None:
            raise HTTPException(
                status_code=404,
                detail="Live session not found.",
            )

        ordered = sorted(session.get("chunks", {}))
        total_voiced = sum(
            float(session.get("voiced_seconds", {}).get(i, 0.0))
            for i in ordered
        )
        sample_rate = int(
            session.get("sample_rate", 16000)
        )
        existing_result = session.get("last_result")

        if existing_result is not None:
            return {
                "status": "VERIFIED",
                "speech_collected_seconds": round(total_voiced, 1),
                "minimum_speech_seconds": LIVE_IDENTITY_MIN_VOICED_SECONDS,
                "trust_circle": existing_result,
                "verification_in_progress": False,
                "finalized": True,
                "waited_ms": round((time.monotonic() - started) * 1000),
                "note": "Stored Trust Circle result returned.",
            }

        if total_voiced < LIVE_IDENTITY_MIN_VOICED_SECONDS:
            return {
                "status": "INSUFFICIENT_SPEECH",
                "speech_collected_seconds": round(total_voiced, 1),
                "minimum_speech_seconds": LIVE_IDENTITY_MIN_VOICED_SECONDS,
                "trust_circle": None,
                "verification_in_progress": False,
                "finalized": True,
                "waited_ms": round((time.monotonic() - started) * 1000),
                "note": "Not enough usable speech for Trust Circle verification.",
            }

        combined_pcm = b"".join(
            session["chunks"][i]
            for i in ordered
        )

    # Bound ECAPA input to the most recent ~12 seconds.
    identity_window_seconds = 12
    max_bytes = int(
        sample_rate * 2 * identity_window_seconds
    )

    if len(combined_pcm) > max_bytes:
        combined_pcm = combined_pcm[-max_bytes:]

    temp_identity_wav = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".wav",
        ) as temp_file:
            temp_identity_wav = temp_file.name

        _write_pcm16_mono_wav(
            temp_identity_wav,
            sample_rate,
            combined_pcm,
        )

        print(
            f"Finalizing live Trust Circle: "
            f"{round(total_voiced, 1)}s voiced, "
            f"{len(combined_pcm) / (sample_rate * 2):.1f}s ECAPA window"
        )

        trust_result = search_trust_circle(
            temp_identity_wav
        )

        print(
            "Final live Trust Circle result:",
            trust_result.get("status"),
            (
                trust_result.get("best_match", {}) or {}
            ).get("identity"),
        )

        with LIVE_SESSION_LOCK:
            session = LIVE_SESSIONS.get(session_id)

            if session is not None:
                session["last_result"] = trust_result
                session["verification_in_progress"] = False
                session["last_verified_voiced_seconds"] = total_voiced
                session["last_identity_error"] = None

        return {
            "status": "VERIFIED",
            "speech_collected_seconds": round(total_voiced, 1),
            "minimum_speech_seconds": LIVE_IDENTITY_MIN_VOICED_SECONDS,
            "trust_circle": trust_result,
            "verification_in_progress": False,
            "finalized": True,
            "waited_ms": round((time.monotonic() - started) * 1000),
            "note": "Trust Circle verification completed at session finalization.",
        }

    except Exception as error:
        print(
            "Final live Trust Circle verification failed:",
            repr(error),
        )

        with LIVE_SESSION_LOCK:
            session = LIVE_SESSIONS.get(session_id)

            if session is not None:
                session["verification_in_progress"] = False
                session["last_identity_error"] = str(error)

        raise HTTPException(
            status_code=500,
            detail=f"Live Trust Circle verification failed: {error}",
        )

    finally:
        if temp_identity_wav and os.path.exists(temp_identity_wav):
            try:
                os.remove(temp_identity_wav)
            except OSError:
                pass


@app.delete("/live-session/{session_id}")
def clear_live_session(session_id: str):
    with LIVE_SESSION_LOCK:
        existed = LIVE_SESSIONS.pop(session_id, None) is not None
    return {
        "cleared": existed,
        "audio_retained": False,
    }


@app.post("/live-analyze")
async def live_analyze(
    file: UploadFile = File(...),
    chunk_index: int = Form(0),
    session_id: str | None = Form(None),
):
    """
    Near-real-time analysis endpoint.

    Layer 1 runs the synthetic-voice detector on each usable chunk.
    Layer 2 temporarily accumulates VAD-confirmed speech and periodically
    checks the existing Trust Circle after enough speech is available.
    Full forensics and Evidence Fusion are still excluded from every chunk.

    Uploaded live chunks are temporary and are deleted after
    analysis. Live-session results are not added to History or
    Alerts in Layer 1.
    """

    content_type = (file.content_type or "").lower()

    # Browser MediaRecorder commonly sends audio/webm.
    supported_live_types = set(ALLOWED_AUDIO_TYPES) | {
        "audio/webm",
        "audio/webm;codecs=opus",
        "video/webm",
        "application/octet-stream",
    }

    if content_type and content_type not in supported_live_types:
        # Some browsers include codec parameters such as:
        # audio/webm;codecs=opus
        if not content_type.startswith("audio/webm"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Unsupported live-audio format. "
                    "Use browser microphone recording in WebM/WAV format."
                ),
            )

    temp_input_path = None
    temp_output_path = None

    try:
        filename = file.filename or f"live_chunk_{chunk_index}.webm"
        suffix = os.path.splitext(filename)[1] or ".webm"

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
        ) as temp_input:
            shutil.copyfileobj(
                file.file,
                temp_input,
            )
            temp_input_path = temp_input.name

        # Reject completely empty chunks before invoking FFmpeg.
        if (
            not temp_input_path
            or not os.path.exists(temp_input_path)
            or os.path.getsize(temp_input_path) < 100
        ):
            raise HTTPException(
                status_code=400,
                detail="Live audio chunk was empty or too short.",
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".wav",
        ) as temp_output:
            temp_output_path = temp_output.name

        normalize_audio(
            temp_input_path,
            temp_output_path,
        )

        speech_activity = analyze_speech_activity(
            temp_output_path
        )

        if not speech_activity.get(
            "speech_detected",
            False,
        ):
            return {
                "chunk_index": chunk_index,
                "timestamp": datetime.now(
                    timezone.utc
                ).isoformat(),
                "real_probability": 0.0,
                "fake_probability": 0.0,
                "synthetic_score": 0.0,
                "risk_level": "NO SPEECH",
                "classification": "Insufficient speech",
                "chunk_seconds": 4,
                "speech_detected": False,
                "speech_activity": speech_activity,
                "live_identity": (
                    {
                        **_live_identity_snapshot(session_id),
                        "status": "NO SPEECH",
                        "note": "This chunk was not added to live identity verification.",
                    }
                    if session_id else None
                ),
            }

        # Layer 1 first: this is the result the live UI is waiting for.
        voice_result = analyze_voice(
            temp_output_path
        )

        # Layer 2 is non-blocking. ECAPA / Trust Circle is queued in a
        # dedicated background worker after Layer 1 inference completes.
        live_identity = None
        if session_id:
            live_identity = update_live_identity_session(
                session_id=session_id,
                chunk_index=chunk_index,
                wav_path=temp_output_path,
                voiced_seconds=float(
                    speech_activity.get("voiced_seconds", 0.0)
                ),
            )

        real_probability = float(
            voice_result.get("real", 0.0)
        )
        fake_probability = float(
            voice_result.get("fake", 0.0)
        )

        synthetic_score = round(
            fake_probability * 100,
            1,
        )

        if synthetic_score >= 75:
            risk_level = "HIGH"
            classification = "High synthetic-voice risk"
        elif synthetic_score >= 30:
            risk_level = "SUSPICIOUS"
            classification = "Suspicious voice evidence"
        else:
            risk_level = "SAFE"
            classification = "No strong synthetic evidence"

        return {
            "chunk_index": chunk_index,
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
            "real_probability": round(
                real_probability,
                4,
            ),
            "fake_probability": round(
                fake_probability,
                4,
            ),
            "synthetic_score": synthetic_score,
            "risk_level": risk_level,
            "classification": classification,
            "chunk_seconds": 4,
            "speech_detected": True,
            "speech_activity": speech_activity,
            "live_identity": live_identity,
            "privacy": {
                "audio_retained": False,
                "saved_to_history": False,
                "saved_as_alert": False,
            },
        }

    except subprocess.CalledProcessError:
        raise HTTPException(
            status_code=400,
            detail=(
                "Live audio conversion failed. "
                "Try again or check microphone permissions."
            ),
        )

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Live voice analysis failed: "
                f"{str(error)}"
            ),
        )

    finally:
        for temporary_path in (
            temp_input_path,
            temp_output_path,
        ):
            if (
                temporary_path
                and os.path.exists(temporary_path)
            ):
                try:
                    os.remove(temporary_path)
                except OSError:
                    pass


# =========================================================
# ANALYZE AUDIO
# =========================================================

@app.post("/analyze-audio")
async def analyze_audio(
    file: UploadFile = File(...),
    claimed_identity: str | None = Form(None),
):

    if (
        file.content_type
        not in ALLOWED_AUDIO_TYPES
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "Please upload a supported "
                "audio file."
            ),
        )

    temp_input_path = None
    temp_output_path = None

    try:

        # =================================================
        # STEP 1
        # Save uploaded audio temporarily
        # =================================================

        filename = (
            file.filename
            or "uploaded_audio"
        )

        suffix = os.path.splitext(
            filename
        )[1]

        if not suffix:
            suffix = ".audio"

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
        ) as temp_input:

            shutil.copyfileobj(
                file.file,
                temp_input,
            )

            temp_input_path = (
                temp_input.name
            )

        # =================================================
        # STEP 2
        # Create temporary WAV output
        # =================================================

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".wav",
        ) as temp_output:

            temp_output_path = (
                temp_output.name
            )

        # =================================================
        # STEP 3
        # Normalize incoming audio
        # =================================================

        normalize_audio(
            temp_input_path,
            temp_output_path,
        )

        # =================================================
        # STEP 4
        # Deepfake detection
        # =================================================

        voice_result = analyze_voice(
            temp_output_path
        )

        real_probability = float(
            voice_result.get(
                "real",
                0.0,
            )
        )

        fake_probability = float(
            voice_result.get(
                "fake",
                0.0,
            )
        )

        # =================================================
        # STEP 5
        # Forensic analysis
        # =================================================

        forensic_result = (
            analyze_audio_forensics(
                temp_output_path
            )
        )

        # =================================================
        # STEP 6
        # Automatic Trust Circle Search
        # =================================================

        trust_circle_result = (
            search_trust_circle(
                temp_output_path
            )
        )

        timeline_result = (
            analyze_audio_timeline(
                 temp_output_path,
                    chunk_seconds=4.0,
            )
        )

        robustness_result = analyze_robustness(
            temp_output_path
        )

        replay_result = analyze_replay_evidence(
            temp_output_path
        )

        fusion_result = fuse_evidence(
                voice_authenticity={
                    "real_probability": voice_result["real"],
                    "fake_probability": voice_result["fake"],
            },
                trust_circle=trust_circle_result,
                timeline=timeline_result,
                robustness=robustness_result,
        )

        # =================================================
        # STEP 7
        # Optional specific identity verification
        #
        # Now supports MULTIPLE reference samples.
        # =================================================

        speaker_result = None

        if claimed_identity:

            safe_identity = (
                sanitize_identity_name(
                    claimed_identity
                )
            )

            identity_directory = (
                TRUSTED_IDENTITIES_DIR
                / safe_identity
            )

            if not identity_directory.exists():

                raise HTTPException(
                    status_code=404,
                    detail=(
                        f'No trusted identity '
                        f'"{safe_identity}" found.'
                    ),
                )

            reference_files = (
                get_identity_reference_files(
                    identity_directory
                )
            )

            if not reference_files:

                raise HTTPException(
                    status_code=404,
                    detail=(
                        f'No trusted voice samples '
                        f'found for "{safe_identity}".'
                    ),
                )

            individual_results = []

            for reference_wav in reference_files:

                verification = (
                    verify_speaker(
                        str(reference_wav),
                        temp_output_path,
                    )
                )

                individual_results.append(
                    {
                        "reference":
                            reference_wav.name,

                        "similarity_score":
                            verification[
                                "similarity_score"
                            ],

                        "same_speaker":
                            verification[
                                "same_speaker"
                            ],
                    }
                )

            similarity_scores = [
                result[
                    "similarity_score"
                ]
                for result
                in individual_results
            ]

            average_similarity = (
                sum(similarity_scores)
                / len(similarity_scores)
            )

            matching_samples = sum(
                1
                for result
                in individual_results
                if result[
                    "same_speaker"
                ]
            )

            total_samples = len(
                individual_results
            )

            required_matches = (
                total_samples // 2
            ) + 1

            same_speaker = (
                matching_samples
                >= required_matches
            )

            if total_samples == 1:

                same_speaker = (
                    individual_results[0][
                        "same_speaker"
                    ]
                )

            speaker_result = {

                "claimed_identity":
                    safe_identity,

                "similarity_score":
                    round(
                        average_similarity,
                        4,
                    ),

                "same_speaker":
                    same_speaker,

                "matching_samples":
                    matching_samples,

                "total_samples":
                    total_samples,

                "sample_results":
                    individual_results,
            }

        # =================================================
        # STEP 8
        # Initial risk scoring
        # =================================================

        risk_score = round(
            fake_probability * 100
        )

        if risk_score < 25:

            risk_level = "LOW"

            classification = (
                "Likely Genuine"
            )

            recommendation = (
                "No strong synthetic voice "
                "indicators detected."
            )

        elif risk_score < 50:

            risk_level = "MEDIUM"

            classification = (
                "Uncertain"
            )

            recommendation = (
                "Verify the caller using a "
                "secondary authentication method."
            )

        elif risk_score < 75:

            risk_level = "HIGH"

            classification = (
                "Likely AI-generated"
            )

            recommendation = (
                "Do not approve sensitive actions "
                "without additional verification."
            )

        else:

            risk_level = "CRITICAL"

            classification = (
                "Likely AI-generated"
            )

            recommendation = (
                "Block sensitive action and "
                "require secondary authentication."
            )

        # =================================================
        # STEP 9
        # Specific identity clone scenario
        # =================================================

        clone_warning = False

        if (
            speaker_result is not None
            and speaker_result.get(
                "same_speaker"
            ) is True
            and fake_probability >= 0.75
        ):

            clone_warning = True

            classification = (
                "Possible AI Voice Clone"
            )

            risk_level = "CRITICAL"

            risk_score = max(
                risk_score,
                95,
            )

            recommendation = (
                "The incoming voice resembles the "
                "claimed identity while also showing "
                "strong synthetic voice indicators. "
                "Do not authorize sensitive actions. "
                "Require secondary authentication."
            )

        # =================================================
        # STEP 10
        # Automatic impersonation scenario
        # =================================================

        automatic_impersonation = False
        suspected_identity = None

        best_match = (
            trust_circle_result.get(
                "best_match"
            )
            if trust_circle_result
            else None
        )

        if best_match:

            suspected_identity = (
                best_match.get(
                    "identity"
                )
            )

            if (
                best_match.get(
                    "same_speaker"
                ) is True
                and fake_probability >= 0.75
            ):

                automatic_impersonation = True

                classification = (
                    "Possible AI Voice Clone"
                )

                risk_level = "CRITICAL"

                risk_score = max(
                    risk_score,
                    95,
                )

                recommendation = (
                    "AIA automatically identified "
                    f'"{suspected_identity}" as the '
                    "strongest trusted speaker match "
                    "while the recording also shows "
                    "strong synthetic voice indicators. "
                    "Treat this as a possible voice "
                    "impersonation attack and verify "
                    "the person through another "
                    "trusted channel."
                )

        # =================================================
        # STEP 11
        # Return unified result
        # =================================================

        analysis_result = {

            "filename":
                filename,

            "voice_authenticity": {

                "real_probability":
                    round(
                        real_probability,
                        4,
                    ),

                "fake_probability":
                    round(
                        fake_probability,
                        4,
                    ),
            },

            "speaker_verification":
                speaker_result,

            "trust_circle_search":
                trust_circle_result,

            "audio_integrity_timeline":
                timeline_result,

            "robustness_analysis":
                robustness_result,

            "replay_analysis":
                replay_result,

            "forensic_analysis":
                forensic_result,

            "evidence_fusion":
                fusion_result,


            "risk_analysis": {

                "risk_score":
                    risk_score,

                "risk_level":
                    risk_level,

                "classification":
                    classification,

                "possible_voice_clone":
                    (
                        clone_warning
                        or automatic_impersonation
                    ),

                "automatic_impersonation":
                    automatic_impersonation,

                "suspected_identity":
                    suspected_identity,
            },

            "recommendation":
                recommendation,
        }


        fusion_classification = (
            fusion_result.get("classification")
            or fusion_result.get("final_classification")
            or fusion_result.get("verdict")
            or classification
        )

        fusion_risk_level = (
            fusion_result.get("risk_level")
            or risk_level
        )

        fusion_confidence = (
            fusion_result.get("confidence")
            or "NOT REPORTED"
        )

        trusted_identity_match = (
            fusion_result.get("trusted_identity_match")
        )

        identity_similarity = (
            fusion_result.get("identity_similarity")
        )

        privacy_settings = load_privacy_settings()

        persisted_filename = redact_filename_if_needed(
            filename,
            privacy_settings,
        )

        history_record = {
            "id": uuid.uuid4().hex,
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
            "filename": persisted_filename,
            "classification": fusion_classification,
            "risk_level": fusion_risk_level,
            "confidence": fusion_confidence,
            "synthetic_score": round(
                fake_probability * 100,
                1,
            ),
            "trusted_identity": trusted_identity_match,
            "identity_similarity": identity_similarity,
            "possible_voice_clone": bool(
                fusion_result.get(
                    "possible_voice_clone",
                    clone_warning
                    or automatic_impersonation,
                )
            ),
            "recommendation": (
                fusion_result.get("recommendation")
                or recommendation
            ),
        }

        # History stores only summary metadata.
        # Uploaded audio itself is still removed in finally.
        try:
            save_analysis_history_record(
                history_record
            )
        except Exception as history_error:
            print(
                "Could not save analysis history:",
                history_error,
            )

        # -------------------------------------------------
        # Security event logging
        # -------------------------------------------------
        security_event = {
            "id": uuid.uuid4().hex,
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
            "event_type": "VOICE_ANALYSIS_COMPLETED",
            "filename": persisted_filename,
            "classification": fusion_classification,
            "risk_level": fusion_risk_level,
            "confidence": fusion_confidence,
            "synthetic_score": round(
                fake_probability * 100,
                1,
            ),
            "trusted_identity": trusted_identity_match,
            "identity_similarity": identity_similarity,
            "possible_voice_clone": bool(
                fusion_result.get(
                    "possible_voice_clone",
                    clone_warning
                    or automatic_impersonation,
                )
            ),
            "recommendation": (
                fusion_result.get("recommendation")
                or recommendation
            ),
        }

        try:
            save_security_event(
                security_event
            )
        except Exception as event_error:
            print(
                "Could not save security event:",
                event_error,
            )

        # -------------------------------------------------
        # Alert creation
        #
        # Only HIGH / CRITICAL final fusion decisions
        # create an active alert. This keeps alerts useful
        # instead of turning every analysis into noise.
        # -------------------------------------------------
        normalized_fusion_risk = str(
            fusion_risk_level
        ).upper()

        if normalized_fusion_risk in {
            "HIGH",
            "CRITICAL",
        }:
            possible_clone = bool(
                fusion_result.get(
                    "possible_voice_clone",
                    clone_warning
                    or automatic_impersonation,
                )
            )

            if possible_clone:
                alert_title = (
                    "Possible voice clone detected"
                )
            elif normalized_fusion_risk == "CRITICAL":
                alert_title = (
                    "Critical synthetic-voice risk detected"
                )
            else:
                alert_title = (
                    "High-risk synthetic-voice evidence detected"
                )

            alert_record = {
                "id": uuid.uuid4().hex,
                "timestamp": datetime.now(
                    timezone.utc
                ).isoformat(),
                "severity": normalized_fusion_risk,
                "title": alert_title,
                "filename": persisted_filename,
                "classification": fusion_classification,
                "confidence": fusion_confidence,
                "synthetic_score": round(
                    fake_probability * 100,
                    1,
                ),
                "trusted_identity": trusted_identity_match,
                "identity_similarity": identity_similarity,
                "possible_voice_clone": possible_clone,
                "recommendation": (
                    fusion_result.get("recommendation")
                    or recommendation
                ),
            }

            try:
                save_alert(
                    alert_record
                )
            except Exception as alert_error:
                print(
                    "Could not save alert:",
                    alert_error,
                )

        return analysis_result

    except subprocess.CalledProcessError:

        raise HTTPException(
            status_code=400,
            detail=(
                "Audio conversion failed. "
                "The uploaded audio may be "
                "corrupted or unsupported."
            ),
        )

    except FileNotFoundError as error:

        raise HTTPException(
            status_code=500,
            detail=(
                "Required audio file or "
                "FFmpeg executable was not found. "
                f"{str(error)}"
            ),
        )

    except HTTPException:

        raise

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                "Voice analysis failed: "
                f"{str(error)}"
            ),
        )

    finally:

        if (
            temp_input_path
            and os.path.exists(
                temp_input_path
            )
        ):

            os.remove(
                temp_input_path
            )

        if (
            temp_output_path
            and os.path.exists(
                temp_output_path
            )
        ):

            os.remove(
                temp_output_path
            )