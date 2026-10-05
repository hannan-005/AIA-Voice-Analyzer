import numpy as np
import librosa


def analyze_audio_forensics(file_path: str):
    """
    Extract measurable acoustic and prosodic characteristics
    from a normalized audio file.

    These measurements are supporting forensic signals.
    They are NOT independently proof that audio is synthetic.
    """

    # --------------------------------------------------
    # 1. Load audio
    # --------------------------------------------------

    audio, sample_rate = librosa.load(
        file_path,
        sr=16000,
        mono=True
    )

    duration = librosa.get_duration(
        y=audio,
        sr=sample_rate
    )

    # --------------------------------------------------
    # 2. RMS Energy
    #
    # Measures signal energy / loudness over time.
    # --------------------------------------------------

    rms = librosa.feature.rms(
        y=audio
    )[0]

    rms_mean = float(np.mean(rms))
    rms_std = float(np.std(rms))

    if rms_mean > 0:
        energy_variation = rms_std / rms_mean
    else:
        energy_variation = 0.0

    # --------------------------------------------------
    # 3. Zero Crossing Rate
    #
    # Measures how frequently waveform crosses zero.
    # Can describe noisiness / signal characteristics.
    # --------------------------------------------------

    zcr = librosa.feature.zero_crossing_rate(
        audio
    )[0]

    zcr_mean = float(np.mean(zcr))

    # --------------------------------------------------
    # 4. Spectral Centroid
    #
    # Roughly describes where the "center of mass"
    # of the audio spectrum lies.
    # --------------------------------------------------

    spectral_centroid = librosa.feature.spectral_centroid(
        y=audio,
        sr=sample_rate
    )[0]

    centroid_mean = float(
        np.mean(spectral_centroid)
    )

    centroid_std = float(
        np.std(spectral_centroid)
    )

    if centroid_mean > 0:
        spectral_variation = (
            centroid_std / centroid_mean
        )
    else:
        spectral_variation = 0.0

    # --------------------------------------------------
    # 5. Spectral Flatness
    #
    # Gives information about whether sound is more
    # tonal or noise-like.
    # --------------------------------------------------

    spectral_flatness = (
        librosa.feature.spectral_flatness(
            y=audio
        )[0]
    )

    spectral_flatness_mean = float(
        np.mean(spectral_flatness)
    )

    # --------------------------------------------------
    # 6. Pitch / Fundamental Frequency
    #
    # Estimate voice pitch over time.
    # --------------------------------------------------

    try:
        f0, voiced_flag, voiced_prob = librosa.pyin(
            audio,
            fmin=65,
            fmax=500,
            sr=sample_rate
        )

        valid_pitch = f0[
            ~np.isnan(f0)
        ]

        if len(valid_pitch) > 0:
            pitch_mean = float(
                np.mean(valid_pitch)
            )

            pitch_std = float(
                np.std(valid_pitch)
            )
        else:
            pitch_mean = 0.0
            pitch_std = 0.0

    except Exception:
        pitch_mean = 0.0
        pitch_std = 0.0

    # --------------------------------------------------
    # 7. Silence / pause ratio
    # --------------------------------------------------

    intervals = librosa.effects.split(
        audio,
        top_db=35
    )

    non_silent_samples = sum(
        end - start
        for start, end in intervals
    )

    total_samples = len(audio)

    if total_samples > 0:
        speech_ratio = (
            non_silent_samples
            / total_samples
        )
    else:
        speech_ratio = 0.0

    silence_ratio = 1.0 - speech_ratio

    # --------------------------------------------------
    # 8. Experimental supporting indicators
    #
    # IMPORTANT:
    # These are heuristic observations.
    # They are NOT standalone deepfake proof.
    # --------------------------------------------------

    indicators = []

    if pitch_std > 0 and pitch_std < 12:
        indicators.append(
            "Low pitch variation detected"
        )

    if energy_variation < 0.15:
        indicators.append(
            "Low energy variation detected"
        )

    if spectral_variation < 0.10:
        indicators.append(
            "Low spectral variation detected"
        )

    if silence_ratio < 0.02:
        indicators.append(
            "Very low pause ratio detected"
        )

    # --------------------------------------------------
    # Final structured result
    # --------------------------------------------------

    return {
        "duration_seconds": round(
            duration,
            2
        ),

        "sample_rate": sample_rate,

        "prosody": {
            "pitch_mean_hz": round(
                pitch_mean,
                2
            ),

            "pitch_variation_hz": round(
                pitch_std,
                2
            ),

            "energy_variation": round(
                energy_variation,
                4
            ),

            "silence_ratio": round(
                silence_ratio,
                4
            )
        },

        "spectral": {
            "spectral_centroid_hz": round(
                centroid_mean,
                2
            ),

            "spectral_variation": round(
                spectral_variation,
                4
            ),

            "spectral_flatness": round(
                spectral_flatness_mean,
                6
            ),

            "zero_crossing_rate": round(
                zcr_mean,
                6
            )
        },

        "experimental_indicators": indicators
    }