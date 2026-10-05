from pathlib import Path
import csv
import subprocess
import tempfile
import shutil
from collections import defaultdict

from voice_detector import analyze_voice
from partial_clone_detector import analyze_audio_timeline
from robustness_analyzer import analyze_robustness
from trust_circle import search_trust_circle
from evidence_fusion import fuse_evidence


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

EVALUATION_DIR = BASE_DIR / "evaluation"
RESULTS_DIR = EVALUATION_DIR / "results"

DATASET_FILE = EVALUATION_DIR / "dataset.csv"


# ============================================================
# CATEGORY LABELS
# ============================================================

CATEGORY_LABELS = {
    "genuine": "GENUINE",
    "direct_clone": "CLONE",
    "replayed_clone": "CLONE",
}


# ============================================================
# FILE EXTENSIONS
# ============================================================

SUPPORTED_EXTENSIONS = {
    ".wav",
    ".mp3",
    ".m4a",
    ".flac",
    ".ogg",
    ".aac",
}


# ============================================================
# FFMPEG
# ============================================================

FFMPEG_PATH = shutil.which("ffmpeg")

if not FFMPEG_PATH:

    FALLBACK_FFMPEG = Path(
        r"C:\Users\admin\AppData\Local\Microsoft\WinGet\Packages"
        r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
        r"\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
    )

    if FALLBACK_FFMPEG.exists():
        FFMPEG_PATH = str(FALLBACK_FFMPEG)


# ============================================================
# LOAD DATASET MANIFEST
# ============================================================

def load_dataset():

    if not DATASET_FILE.exists():

        raise FileNotFoundError(
            f"dataset.csv was not found at:\n"
            f"{DATASET_FILE}"
        )

    samples = []

    with open(
        DATASET_FILE,
        "r",
        encoding="utf-8",
        newline="",
    ) as file:

        reader = csv.DictReader(file)

        required_columns = {
            "filename",
            "category",
            "speaker",
            "source",
            "recording_method",
            "notes",
        }

        if not reader.fieldnames:

            raise RuntimeError(
                "dataset.csv has no header."
            )

        missing = (
            required_columns
            - set(reader.fieldnames)
        )

        if missing:

            raise RuntimeError(
                "dataset.csv is missing columns: "
                + ", ".join(sorted(missing))
            )

        for row in reader:

            category = (
                row["category"]
                .strip()
                .lower()
            )

            filename = (
                row["filename"]
                .strip()
            )

            if category not in CATEGORY_LABELS:

                print(
                    f"Skipping {filename}: "
                    f"unknown category '{category}'"
                )

                continue

            audio_path = (
                EVALUATION_DIR
                / category
                / filename
            )

            if not audio_path.exists():

                print(
                    f"WARNING: File not found: "
                    f"{audio_path}"
                )

                continue

            if (
                audio_path.suffix.lower()
                not in SUPPORTED_EXTENSIONS
            ):

                print(
                    f"Skipping unsupported file: "
                    f"{audio_path.name}"
                )

                continue

            samples.append({
                "filename":
                    filename,

                "category":
                    category,

                "speaker":
                    row["speaker"].strip(),

                "source":
                    row["source"].strip(),

                "recording_method":
                    row[
                        "recording_method"
                    ].strip(),

                "notes":
                    row["notes"].strip(),

                "audio_path":
                    audio_path,
            })

    return samples


# ============================================================
# NORMALIZE AUDIO
# ============================================================

def normalize_audio(
    input_path: Path,
):

    if not FFMPEG_PATH:

        raise RuntimeError(
            "FFmpeg could not be found."
        )

    temp_file = (
        tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False,
        )
    )

    temp_file.close()

    output_path = Path(
        temp_file.name
    )

    command = [
        str(FFMPEG_PATH),

        "-y",

        "-i",
        str(input_path),

        "-ac",
        "1",

        "-ar",
        "16000",

        "-c:a",
        "pcm_s16le",

        str(output_path),
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:

        if output_path.exists():
            output_path.unlink()

        raise RuntimeError(
            "FFmpeg conversion failed:\n"
            + result.stderr
        )

    return output_path


# ============================================================
# ANALYZE ONE SAMPLE
# ============================================================

def analyze_sample(
    sample,
):

    audio_path = sample["audio_path"]

    normalized_path = None

    print()
    print("=" * 70)

    print(
        f"Testing: {sample['filename']}"
    )

    print(
        f"Category: "
        f"{sample['category']}"
    )

    print(
        f"Speaker: "
        f"{sample['speaker']}"
    )

    print(
        f"Source: "
        f"{sample['source']}"
    )

    print(
        f"Recording method: "
        f"{sample['recording_method']}"
    )

    print("=" * 70)

    try:

        normalized_path = normalize_audio(
            audio_path
        )


        # ----------------------------------------------------
        # SYNTHETIC DETECTOR
        # ----------------------------------------------------

        voice_result = analyze_voice(
            str(normalized_path)
        )

        voice_authenticity = {
            "real_probability":
                float(
                    voice_result["real"]
                ),

            "fake_probability":
                float(
                    voice_result["fake"]
                ),
        }


        # ----------------------------------------------------
        # TRUST CIRCLE
        # ----------------------------------------------------

        trust_circle_result = (
            search_trust_circle(
                str(normalized_path)
            )
        )


        # ----------------------------------------------------
        # TIMELINE
        # ----------------------------------------------------

        timeline_result = (
            analyze_audio_timeline(
                str(normalized_path),
                chunk_seconds=4.0,
            )
        )


        # ----------------------------------------------------
        # ROBUSTNESS
        # ----------------------------------------------------

        robustness_result = (
            analyze_robustness(
                str(normalized_path)
            )
        )


        # ----------------------------------------------------
        # EVIDENCE FUSION
        # ----------------------------------------------------

        fusion_result = fuse_evidence(
            voice_authenticity=
                voice_authenticity,

            trust_circle=
                trust_circle_result,

            timeline=
                timeline_result,

            robustness=
                robustness_result,
        )


        classification = (
            fusion_result.get(
                "classification",
                "UNKNOWN",
            )
        )


        attack_classes = {
            "POSSIBLE VOICE CLONE",
            "LIKELY SYNTHETIC",
            "SUSPICIOUS AUDIO",
        }


        predicted_attack = (
            classification
            in attack_classes
        )


        expected_attack = (
            CATEGORY_LABELS[
                sample["category"]
            ]
            == "CLONE"
        )


        correct = (
            predicted_attack
            == expected_attack
        )


        # ----------------------------------------------------
        # TRUSTED IDENTITY
        # ----------------------------------------------------

        best_match = (
            trust_circle_result.get(
                "best_match"
            )
            or {}
        )


        # ----------------------------------------------------
        # FINAL ROW
        # ----------------------------------------------------

        return {

            "filename":
                sample["filename"],

            "category":
                sample["category"],

            "speaker":
                sample["speaker"],

            "source":
                sample["source"],

            "recording_method":
                sample[
                    "recording_method"
                ],

            "notes":
                sample["notes"],

            "ground_truth":
                CATEGORY_LABELS[
                    sample["category"]
                ],

            "real_probability":
                round(
                    voice_authenticity[
                        "real_probability"
                    ],
                    4,
                ),

            "fake_probability":
                round(
                    voice_authenticity[
                        "fake_probability"
                    ],
                    4,
                ),

            "trusted_identity":
                best_match.get(
                    "identity"
                ),

            "identity_similarity":
                best_match.get(
                    "average_similarity"
                ),

            "timeline_synthetic_segments":
                timeline_result.get(
                    "synthetic_segments",
                    0,
                ),

            "timeline_suspicious_segments":
                timeline_result.get(
                    "suspicious_segments",
                    0,
                ),

            "timeline_total_segments":
                timeline_result.get(
                    "usable_segments",
                    0,
                ),

            "robustness":
                robustness_result.get(
                    "stability",
                    "unknown",
                ),

            "classification":
                classification,

            "risk_level":
                fusion_result.get(
                    "risk_level",
                    "UNKNOWN",
                ),

            "confidence":
                fusion_result.get(
                    "confidence",
                    "UNKNOWN",
                ),

            "predicted_attack":
                predicted_attack,

            "expected_attack":
                expected_attack,

            "correct":
                correct,
        }


    finally:

        if (
            normalized_path
            and normalized_path.exists()
        ):

            try:
                normalized_path.unlink()

            except Exception:
                pass


# ============================================================
# METRICS
# ============================================================

def calculate_metrics(
    results,
):

    total = len(results)

    if total == 0:
        return {}


    true_positive = sum(
        1
        for item in results
        if (
            item["expected_attack"]
            and item["predicted_attack"]
        )
    )


    true_negative = sum(
        1
        for item in results
        if (
            not item["expected_attack"]
            and
            not item["predicted_attack"]
        )
    )


    false_positive = sum(
        1
        for item in results
        if (
            not item["expected_attack"]
            and item["predicted_attack"]
        )
    )


    false_negative = sum(
        1
        for item in results
        if (
            item["expected_attack"]
            and
            not item["predicted_attack"]
        )
    )


    correct = (
        true_positive
        + true_negative
    )


    accuracy = (
        correct / total
    )


    precision = (
        true_positive
        /
        (
            true_positive
            + false_positive
        )

        if (
            true_positive
            + false_positive
        )

        else 0
    )


    recall = (
        true_positive
        /
        (
            true_positive
            + false_negative
        )

        if (
            true_positive
            + false_negative
        )

        else 0
    )


    f1 = (
        2
        * precision
        * recall
        / (
            precision
            + recall
        )

        if (
            precision
            + recall
        )

        else 0
    )


    return {

        "total":
            total,

        "correct":
            correct,

        "accuracy":
            accuracy,

        "precision":
            precision,

        "recall":
            recall,

        "f1":
            f1,

        "tp":
            true_positive,

        "tn":
            true_negative,

        "fp":
            false_positive,

        "fn":
            false_negative,
    }


# ============================================================
# CATEGORY STATISTICS
# ============================================================

def calculate_group_stats(
    results,
    field,
):

    groups = defaultdict(
        lambda: {
            "total": 0,
            "correct": 0,
        }
    )

    for result in results:

        value = (
            result.get(field)
            or "unknown"
        )

        groups[value]["total"] += 1

        if result["correct"]:

            groups[value]["correct"] += 1


    summary = {}

    for key, values in groups.items():

        total = values["total"]

        correct = values["correct"]

        summary[key] = {
            "total":
                total,

            "correct":
                correct,

            "accuracy":
                (
                    correct
                    / total
                    if total
                    else 0
                ),
        }

    return summary


# ============================================================
# SAVE CSV
# ============================================================

def save_results(
    results,
):

    RESULTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    output_path = (
        RESULTS_DIR
        / "benchmark_results.csv"
    )


    if not results:
        return output_path


    with open(
        output_path,
        "w",
        newline="",
        encoding="utf-8",
    ) as file:

        writer = csv.DictWriter(
            file,
            fieldnames=
                results[0].keys(),
        )

        writer.writeheader()

        writer.writerows(
            results
        )


    return output_path


# ============================================================
# PRINT GROUP SUMMARY
# ============================================================

def print_group_summary(
    title,
    stats,
):

    print()
    print(title)
    print("-" * 70)

    for name, values in stats.items():

        print(
            f"{name}: "
            f"{values['correct']}/"
            f"{values['total']} correct "
            f"({values['accuracy']:.2%})"
        )


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print(
        "AIA EVALUATION & BENCHMARK"
    )

    print(
        "=" * 70
    )


    if not FFMPEG_PATH:

        print(
            "ERROR: FFmpeg not found."
        )

        return


    try:

        samples = load_dataset()

    except Exception as exc:

        print()
        print(
            "DATASET ERROR:"
        )

        print(exc)

        return


    print()
    print(
        f"Samples loaded from dataset.csv: "
        f"{len(samples)}"
    )


    results = []


    for sample in samples:

        try:

            result = analyze_sample(
                sample
            )

            results.append(
                result
            )


            status = (
                "PASS"
                if result["correct"]
                else "FAIL"
            )


            print()
            print(
                f"{status} | "
                f"{result['classification']}"
            )

            print(
                f"Fake probability: "
                f"{result['fake_probability']:.2%}"
            )

            print(
                f"Risk: "
                f"{result['risk_level']}"
            )


        except Exception as exc:

            print()
            print(
                f"ERROR | "
                f"{sample['filename']}"
            )

            print(exc)


    metrics = calculate_metrics(
        results
    )


    output_path = save_results(
        results
    )


    print()
    print(
        "=" * 70
    )

    print(
        "BENCHMARK SUMMARY"
    )

    print(
        "=" * 70
    )


    if not metrics:

        print(
            "No samples were successfully analyzed."
        )

        return


    print(
        f"Samples: "
        f"{metrics['total']}"
    )

    print(
        f"Correct: "
        f"{metrics['correct']}"
    )

    print(
        f"Accuracy: "
        f"{metrics['accuracy']:.2%}"
    )

    print(
        f"Precision: "
        f"{metrics['precision']:.2%}"
    )

    print(
        f"Recall: "
        f"{metrics['recall']:.2%}"
    )

    print(
        f"F1 Score: "
        f"{metrics['f1']:.2%}"
    )


    print()
    print(
        "Confusion Matrix"
    )

    print(
        f"TP: {metrics['tp']} "
        f"| FP: {metrics['fp']}"
    )

    print(
        f"FN: {metrics['fn']} "
        f"| TN: {metrics['tn']}"
    )


    # ========================================================
    # CATEGORY BREAKDOWN
    # ========================================================

    category_stats = (
        calculate_group_stats(
            results,
            "category",
        )
    )

    print_group_summary(
        "RESULTS BY CATEGORY",
        category_stats,
    )


    # ========================================================
    # RECORDING METHOD BREAKDOWN
    # ========================================================

    recording_stats = (
        calculate_group_stats(
            results,
            "recording_method",
        )
    )

    print_group_summary(
        "RESULTS BY RECORDING METHOD",
        recording_stats,
    )


    # ========================================================
    # SOURCE BREAKDOWN
    # ========================================================

    source_stats = (
        calculate_group_stats(
            results,
            "source",
        )
    )

    print_group_summary(
        "RESULTS BY SOURCE",
        source_stats,
    )


    print()
    print(
        "Results saved to:"
    )

    print(
        output_path
    )


    print()
    print(
        "IMPORTANT: Results from small datasets "
        "are prototype evaluation results and "
        "must not be presented as general model accuracy."
    )


if __name__ == "__main__":
    main()