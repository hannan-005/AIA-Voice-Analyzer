from pathlib import Path
import subprocess
import tempfile

from voice_detector import analyze_voice


def run_ffmpeg(input_path, output_path, filters=None):
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
    ]

    if filters:
        command.extend(["-af", filters])

    command.extend([
        "-ac", "1",
        "-ar", "16000",
        str(output_path),
    ])

    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


def analyze_variant(name, path):
    result = analyze_voice(str(path))

    return {
        "variant": name,
        "real_probability": round(
            float(result.get("real", 0)),
            4
        ),
        "fake_probability": round(
            float(result.get("fake", 0)),
            4
        ),
    }


def analyze_robustness(audio_path: str):

    audio_path = Path(audio_path)

    if not audio_path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {audio_path}"
        )

    results = []

    # ----------------------------------------
    # ORIGINAL
    # ----------------------------------------

    original = analyze_variant(
        "original",
        audio_path
    )

    results.append(original)

    with tempfile.TemporaryDirectory() as temp_dir:

        temp_dir = Path(temp_dir)

        variants = [
            (
                "resampled",
                "aresample=12000,aresample=16000"
            ),
            (
                "telephone_band",
                "highpass=f=300,lowpass=f=3400"
            ),
            (
                "mild_lowpass",
                "lowpass=f=6000"
            ),
        ]

        for name, audio_filter in variants:

            output_path = (
                temp_dir / f"{name}.wav"
            )

            try:

                run_ffmpeg(
                    audio_path,
                    output_path,
                    audio_filter
                )

                result = analyze_variant(
                    name,
                    output_path
                )

                results.append(result)

            except Exception as exc:

                results.append({
                    "variant": name,
                    "real_probability": None,
                    "fake_probability": None,
                    "error": str(exc),
                })

    usable_results = [
        item
        for item in results
        if item["fake_probability"] is not None
    ]

    scores = [
        item["fake_probability"]
        for item in usable_results
    ]

    if scores:

        minimum_score = min(scores)
        maximum_score = max(scores)

        score_range = (
            maximum_score - minimum_score
        )

        average_score = (
            sum(scores) / len(scores)
        )

    else:

        minimum_score = 0
        maximum_score = 0
        score_range = 0
        average_score = 0

    # Prototype stability thresholds.
    # These must later be calibrated
    # using a proper evaluation dataset.

    if score_range >= 0.40:

        stability = "unstable"

    elif score_range >= 0.20:

        stability = "moderate"

    else:

        stability = "stable"

    return {
        "status": "completed",

        "variants_tested":
            len(usable_results),

        "stability":
            stability,

        "minimum_fake_probability":
            round(minimum_score, 4),

        "maximum_fake_probability":
            round(maximum_score, 4),

        "average_fake_probability":
            round(average_score, 4),

        "score_range":
            round(score_range, 4),

        "results":
            results,

        "note": (
            "Robustness results measure how "
            "stable the current synthetic-speech "
            "detector is under controlled audio "
            "transformations. Instability does "
            "not by itself prove that the audio "
            "is synthetic or that a replay attack "
            "occurred."
        ),
    }


if __name__ == "__main__":
    print(
        "AIA Robustness Analyzer ready."
    )