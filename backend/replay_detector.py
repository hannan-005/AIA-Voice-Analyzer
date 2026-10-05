from pathlib import Path
import wave
import numpy as np


# ---------------------------------------------------------
# Prototype replay / acoustic-channel analyzer
#
# IMPORTANT:
# This does NOT prove replay.
# It only looks for acoustic clues that can become stronger
# when audio has been played through a loudspeaker and
# recorded again through another microphone / room.
# ---------------------------------------------------------


def _read_wav(audio_path: str):
    path = Path(audio_path)

    if not path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {path}"
        )

    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frames = wav_file.getnframes()

        audio_bytes = wav_file.readframes(frames)

    if sample_width != 2:
        raise ValueError(
            "Replay detector currently expects 16-bit PCM WAV."
        )

    audio = np.frombuffer(
        audio_bytes,
        dtype=np.int16
    ).astype(np.float32)

    if channels > 1:
        audio = audio.reshape(
            -1,
            channels
        ).mean(axis=1)

    audio /= 32768.0

    return audio, sample_rate


def _frame_audio(
    audio: np.ndarray,
    sample_rate: int,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
):
    frame_length = int(
        sample_rate * frame_ms / 1000
    )

    hop_length = int(
        sample_rate * hop_ms / 1000
    )

    if len(audio) < frame_length:
        return np.empty(
            (0, frame_length),
            dtype=np.float32
        )

    frames = []

    for start in range(
        0,
        len(audio) - frame_length + 1,
        hop_length
    ):
        frames.append(
            audio[
                start:
                start + frame_length
            ]
        )

    return np.asarray(
        frames,
        dtype=np.float32
    )


def _calculate_spectral_features(
    frames: np.ndarray,
    sample_rate: int
):
    if len(frames) == 0:
        return {
            "high_frequency_ratio": 0.0,
            "low_frequency_ratio": 0.0,
            "spectral_rolloff_hz": 0.0,
            "spectral_flatness": 0.0,
        }

    window = np.hanning(
        frames.shape[1]
    )

    spectra = np.abs(
        np.fft.rfft(
            frames * window,
            axis=1
        )
    )

    power = spectra ** 2

    frequencies = np.fft.rfftfreq(
        frames.shape[1],
        d=1.0 / sample_rate
    )

    total_energy = (
        np.sum(power, axis=1)
        + 1e-12
    )

    high_mask = frequencies >= 6000

    low_mask = frequencies <= 300

    high_energy = (
        np.sum(
            power[:, high_mask],
            axis=1
        )
        if np.any(high_mask)
        else np.zeros(len(frames))
    )

    low_energy = np.sum(
        power[:, low_mask],
        axis=1
    )

    high_ratio = float(
        np.mean(
            high_energy /
            total_energy
        )
    )

    low_ratio = float(
        np.mean(
            low_energy /
            total_energy
        )
    )

    rolloffs = []

    for frame_power in power:
        cumulative = np.cumsum(
            frame_power
        )

        threshold = (
            cumulative[-1] * 0.85
        )

        index = int(
            np.searchsorted(
                cumulative,
                threshold
            )
        )

        index = min(
            index,
            len(frequencies) - 1
        )

        rolloffs.append(
            frequencies[index]
        )

    rolloff_hz = float(
        np.mean(rolloffs)
    )

    geometric_mean = np.exp(
        np.mean(
            np.log(
                spectra + 1e-12
            ),
            axis=1
        )
    )

    arithmetic_mean = (
        np.mean(
            spectra,
            axis=1
        )
        + 1e-12
    )

    flatness = float(
        np.mean(
            geometric_mean /
            arithmetic_mean
        )
    )

    return {
        "high_frequency_ratio":
            round(high_ratio, 6),

        "low_frequency_ratio":
            round(low_ratio, 6),

        "spectral_rolloff_hz":
            round(rolloff_hz, 2),

        "spectral_flatness":
            round(flatness, 6),
    }


def _calculate_temporal_features(
    audio: np.ndarray,
    sample_rate: int
):
    if len(audio) == 0:
        return {
            "rms_energy": 0.0,
            "peak_to_rms_ratio": 0.0,
            "zero_crossing_rate": 0.0,
        }

    rms = float(
        np.sqrt(
            np.mean(
                audio ** 2
            )
            + 1e-12
        )
    )

    peak = float(
        np.max(
            np.abs(audio)
        )
    )

    peak_to_rms = (
        peak / (rms + 1e-12)
    )

    zero_crossings = np.mean(
        np.abs(
            np.diff(
                np.sign(audio)
            )
        ) > 0
    )

    return {
        "rms_energy":
            round(rms, 6),

        "peak_to_rms_ratio":
            round(
                peak_to_rms,
                4
            ),

        "zero_crossing_rate":
            round(
                float(
                    zero_crossings
                ),
                6
            ),
    }


def _estimate_reverb_proxy(
    audio: np.ndarray,
    sample_rate: int
):
    # This is only a rough energy-decay proxy.
    # It is NOT a calibrated RT60 measurement.

    frame_size = int(
        sample_rate * 0.02
    )

    if frame_size <= 0:
        return 0.0

    energies = []

    for start in range(
        0,
        len(audio) - frame_size,
        frame_size
    ):
        frame = audio[
            start:
            start + frame_size
        ]

        energy = float(
            np.mean(
                frame ** 2
            )
        )

        energies.append(
            energy
        )

    if len(energies) < 5:
        return 0.0

    energies = np.asarray(
        energies,
        dtype=np.float32
    )

    normalized = (
        energies /
        (
            np.max(energies)
            + 1e-12
        )
    )

    low_energy_frames = float(
        np.mean(
            (
                normalized > 0.01
            )
            &
            (
                normalized < 0.15
            )
        )
    )

    return round(
        low_energy_frames,
        4
    )


def analyze_replay_evidence(
    audio_path: str
):
    audio, sample_rate = (
        _read_wav(audio_path)
    )

    frames = _frame_audio(
        audio,
        sample_rate
    )

    spectral = (
        _calculate_spectral_features(
            frames,
            sample_rate
        )
    )

    temporal = (
        _calculate_temporal_features(
            audio,
            sample_rate
        )
    )

    reverb_proxy = (
        _estimate_reverb_proxy(
            audio,
            sample_rate
        )
    )

    indicators = []

    replay_score = 0

    # --------------------------------------------------
    # Prototype heuristic scoring
    #
    # These thresholds are NOT scientifically calibrated.
    # They are intentionally conservative and must later
    # be validated against genuine + replay datasets.
    # --------------------------------------------------

    if (
        spectral[
            "high_frequency_ratio"
        ] < 0.015
    ):
        indicators.append(
            "Reduced high-frequency energy"
        )

        replay_score += 20

    if (
        spectral[
            "spectral_rolloff_hz"
        ] < 5000
    ):
        indicators.append(
            "Narrowed spectral bandwidth"
        )

        replay_score += 15

    if (
        spectral[
            "low_frequency_ratio"
        ] > 0.12
    ):
        indicators.append(
            "Elevated low-frequency energy"
        )

        replay_score += 10

    if (
        reverb_proxy > 0.20
    ):
        indicators.append(
            "Room-like residual energy detected"
        )

        replay_score += 20

    if (
        temporal[
            "peak_to_rms_ratio"
        ] < 3.0
    ):
        indicators.append(
            "Compressed acoustic dynamic range"
        )

        replay_score += 10

    if (
        spectral[
            "spectral_flatness"
        ] > 0.18
    ):
        indicators.append(
            "Elevated broadband noise characteristics"
        )

        replay_score += 10

    replay_score = min(
        replay_score,
        100
    )

    if replay_score >= 60:
        evidence_level = "high"

    elif replay_score >= 35:
        evidence_level = "elevated"

    elif replay_score >= 15:
        evidence_level = "low"

    else:
        evidence_level = "minimal"

    return {
        "status": "completed",

        "replay_evidence_score":
            replay_score,

        "evidence_level":
            evidence_level,

        "indicators":
            indicators,

        "acoustic_features": {
            "sample_rate":
                sample_rate,

            "high_frequency_ratio":
                spectral[
                    "high_frequency_ratio"
                ],

            "low_frequency_ratio":
                spectral[
                    "low_frequency_ratio"
                ],

            "spectral_rolloff_hz":
                spectral[
                    "spectral_rolloff_hz"
                ],

            "spectral_flatness":
                spectral[
                    "spectral_flatness"
                ],

            "rms_energy":
                temporal[
                    "rms_energy"
                ],

            "peak_to_rms_ratio":
                temporal[
                    "peak_to_rms_ratio"
                ],

            "zero_crossing_rate":
                temporal[
                    "zero_crossing_rate"
                ],

            "reverb_proxy":
                reverb_proxy,
        },

        "interpretation": (
            "Replay evidence estimates whether "
            "the recording contains acoustic "
            "characteristics that can occur when "
            "speech is reproduced through a "
            "speaker and captured again through "
            "another microphone or room."
        ),

        "warning": (
            "This prototype replay score is "
            "experimental and is not proof of "
            "a replay attack. Similar acoustic "
            "characteristics can also occur in "
            "genuine recordings made in noisy, "
            "reverberant, low-quality, or "
            "band-limited environments."
        ),
    }


if __name__ == "__main__":
    print(
        "AIA Replay / Acoustic Channel "
        "Analyzer ready."
    )