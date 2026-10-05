from pathlib import Path
import tempfile
import wave

from voice_detector import analyze_voice


DEFAULT_CHUNK_SECONDS = 4.0

SYNTHETIC_THRESHOLD = 0.75
SUSPICIOUS_THRESHOLD = 0.50

# Segments shorter than this are not analyzed alone.
MIN_SEGMENT_SECONDS = 2.0


def classify_segment(fake_probability: float) -> str:
    if fake_probability >= SYNTHETIC_THRESHOLD:
        return "synthetic"

    if fake_probability >= SUSPICIOUS_THRESHOLD:
        return "suspicious"

    return "likely_genuine"


def analyze_audio_timeline(
    audio_path: str,
    chunk_seconds: float = DEFAULT_CHUNK_SECONDS,
):
    audio_path = Path(audio_path)

    if not audio_path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {audio_path}"
        )

    if chunk_seconds <= 0:
        raise ValueError(
            "chunk_seconds must be greater than zero."
        )

    segments = []

    with wave.open(str(audio_path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        total_frames = wav_file.getnframes()

        if channels != 1:
            raise ValueError(
                "Timeline detector expects mono WAV audio."
            )

        chunk_frames = int(
            sample_rate * chunk_seconds
        )

        min_segment_frames = int(
            sample_rate * MIN_SEGMENT_SECONDS
        )

        if chunk_frames <= 0:
            raise ValueError(
                "Invalid chunk size."
            )

        segment_index = 0
        current_frame = 0

        while current_frame < total_frames:

            remaining_frames = (
                total_frames - current_frame
            )

            frames_to_read = min(
                chunk_frames,
                remaining_frames
            )

            # ---------------------------------------------
            # SHORT FINAL SEGMENT HANDLING
            # ---------------------------------------------
            #
            # If the last piece is too short,
            # do NOT analyze it independently.
            #
            # Instead, extend the previous segment
            # so the detector receives enough audio.
            # ---------------------------------------------

            if (
                frames_to_read < min_segment_frames
                and segment_index > 0
            ):
                break

            audio_frames = wav_file.readframes(
                frames_to_read
            )

            if not audio_frames:
                break

            start_seconds = (
                current_frame / sample_rate
            )

            end_seconds = (
                (
                    current_frame
                    + frames_to_read
                )
                / sample_rate
            )

            temp_path = None

            try:
                with tempfile.NamedTemporaryFile(
                    delete=False,
                    suffix=".wav"
                ) as temp_file:
                    temp_path = Path(
                        temp_file.name
                    )

                with wave.open(
                    str(temp_path),
                    "wb"
                ) as chunk_file:

                    chunk_file.setnchannels(
                        channels
                    )

                    chunk_file.setsampwidth(
                        sample_width
                    )

                    chunk_file.setframerate(
                        sample_rate
                    )

                    chunk_file.writeframes(
                        audio_frames
                    )

                result = analyze_voice(
                    str(temp_path)
                )

                real_probability = float(
                    result.get(
                        "real",
                        0.0
                    )
                )

                fake_probability = float(
                    result.get(
                        "fake",
                        0.0
                    )
                )

                classification = (
                    classify_segment(
                        fake_probability
                    )
                )

                segments.append({
                    "segment_index":
                        segment_index,

                    "start_seconds":
                        round(
                            start_seconds,
                            2
                        ),

                    "end_seconds":
                        round(
                            end_seconds,
                            2
                        ),

                    "duration_seconds":
                        round(
                            end_seconds
                            - start_seconds,
                            2
                        ),

                    "real_probability":
                        round(
                            real_probability,
                            4
                        ),

                    "fake_probability":
                        round(
                            fake_probability,
                            4
                        ),

                    "classification":
                        classification,
                })

            except Exception as exc:

                segments.append({
                    "segment_index":
                        segment_index,

                    "start_seconds":
                        round(
                            start_seconds,
                            2
                        ),

                    "end_seconds":
                        round(
                            end_seconds,
                            2
                        ),

                    "duration_seconds":
                        round(
                            end_seconds
                            - start_seconds,
                            2
                        ),

                    "real_probability":
                        None,

                    "fake_probability":
                        None,

                    "classification":
                        "unavailable",

                    "error":
                        str(exc),
                })

            finally:
                if (
                    temp_path is not None
                    and temp_path.exists()
                ):
                    temp_path.unlink()

            current_frame += (
                frames_to_read
            )

            segment_index += 1

    # --------------------------------------------------
    # SUMMARY
    # --------------------------------------------------

    usable_segments = [
        segment
        for segment in segments
        if segment.get(
            "fake_probability"
        ) is not None
    ]

    synthetic_segments = [
        segment
        for segment in usable_segments
        if segment[
            "classification"
        ] == "synthetic"
    ]

    suspicious_segments = [
        segment
        for segment in usable_segments
        if segment[
            "classification"
        ] == "suspicious"
    ]

    genuine_segments = [
        segment
        for segment in usable_segments
        if segment[
            "classification"
        ] == "likely_genuine"
    ]

    strongest_segment = None

    if usable_segments:
        strongest_segment = max(
            usable_segments,
            key=lambda segment:
                segment[
                    "fake_probability"
                ],
        )

    mixed_evidence = (
        len(synthetic_segments) > 0
        and len(genuine_segments) > 0
    )

    analyzed_duration = 0.0

    if segments:
        analyzed_duration = (
            segments[-1][
                "end_seconds"
            ]
        )

    return {
        "chunk_seconds":
            chunk_seconds,

        "minimum_segment_seconds":
            MIN_SEGMENT_SECONDS,

        "total_segments":
            len(segments),

        "usable_segments":
            len(usable_segments),

        "synthetic_segments":
            len(
                synthetic_segments
            ),

        "suspicious_segments":
            len(
                suspicious_segments
            ),

        "likely_genuine_segments":
            len(
                genuine_segments
            ),

        "mixed_evidence":
            mixed_evidence,

        "analyzed_duration_seconds":
            round(
                analyzed_duration,
                2
            ),

        "strongest_synthetic_segment":
            strongest_segment,

        "segments":
            segments,

        "note": (
            "Timeline labels represent "
            "localized synthetic-speech "
            "evidence from the current "
            "detector. Very short final "
            "audio fragments are excluded "
            "from independent classification. "
            "Timeline results do not by "
            "themselves prove voice cloning."
        ),
    }


if __name__ == "__main__":
    print(
        "AIA Partial Clone Timeline module ready."
    )