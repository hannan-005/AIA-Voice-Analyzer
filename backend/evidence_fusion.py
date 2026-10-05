def fuse_evidence(
    voice_authenticity,
    trust_circle=None,
    timeline=None,
    robustness=None,
):
    """
    AIA Evidence Fusion Engine V1

    Combines multiple evidence sources into a final
    review-oriented assessment.

    IMPORTANT:
    This is prototype decision logic.
    Thresholds must later be calibrated using a
    proper evaluation dataset.
    """

    # --------------------------------------------------
    # 1. SYNTHETIC SPEECH EVIDENCE
    # --------------------------------------------------

    fake_probability = float(
        voice_authenticity.get(
            "fake_probability",
            0
        )
    )

    real_probability = float(
        voice_authenticity.get(
            "real_probability",
            0
        )
    )

    if fake_probability >= 0.75:
        synthetic_level = "HIGH"

    elif fake_probability >= 0.50:
        synthetic_level = "MODERATE"

    elif fake_probability >= 0.30:
        synthetic_level = "WEAK"

    else:
        synthetic_level = "LOW"

    # --------------------------------------------------
    # 2. TRUST CIRCLE / IDENTITY EVIDENCE
    # --------------------------------------------------

    trusted_identity = None
    identity_similarity = None
    identity_match = False

    if trust_circle:

        best_match = trust_circle.get(
            "best_match"
        )

        if best_match:

            trusted_identity = (
                best_match.get("identity")
            )

            identity_similarity = (
                best_match.get(
                    "average_similarity"
                )
            )

            identity_match = bool(
                best_match.get(
                    "same_speaker",
                    False
                )
            )

    # --------------------------------------------------
    # 3. TIMELINE EVIDENCE
    # --------------------------------------------------

    synthetic_segments = 0
    suspicious_segments = 0
    usable_segments = 0
    mixed_evidence = False

    if timeline:

        synthetic_segments = int(
            timeline.get(
                "synthetic_segments",
                0
            )
        )

        suspicious_segments = int(
            timeline.get(
                "suspicious_segments",
                0
            )
        )

        usable_segments = int(
            timeline.get(
                "usable_segments",
                0
            )
        )

        mixed_evidence = bool(
            timeline.get(
                "mixed_evidence",
                False
            )
        )

    timeline_warning = (
        synthetic_segments > 0
        or suspicious_segments > 0
        or mixed_evidence
    )

    # --------------------------------------------------
    # 4. ROBUSTNESS
    # --------------------------------------------------

    robustness_stability = "unknown"
    robustness_unstable = False

    if robustness:

        robustness_stability = str(
            robustness.get(
                "stability",
                "unknown"
            )
        ).lower()

        robustness_unstable = (
            robustness_stability
            == "unstable"
        )

    # --------------------------------------------------
    # 5. FINAL EVIDENCE FUSION
    # --------------------------------------------------

    classification = "INCONCLUSIVE"
    risk_level = "MEDIUM"
    confidence = "LOW"

    possible_voice_clone = False

    reasons = []

    # CASE A:
    # Strong synthetic evidence + trusted identity match
    #
    # This is the strongest clone scenario.

    if (
        fake_probability >= 0.75
        and identity_match
    ):

        classification = (
            "POSSIBLE VOICE CLONE"
        )

        risk_level = "CRITICAL"
        confidence = "HIGH"

        possible_voice_clone = True

        reasons.append(
            "Strong synthetic-speech evidence detected."
        )

        reasons.append(
            "Audio matches a trusted identity."
        )

    # CASE B:
    # Strong synthetic evidence,
    # but no trusted identity.

    elif fake_probability >= 0.75:

        classification = (
            "LIKELY SYNTHETIC"
        )

        risk_level = "HIGH"
        confidence = "HIGH"

        reasons.append(
            "Strong synthetic-speech evidence detected."
        )

    # CASE C:
    # Timeline catches suspicious/synthetic regions.

    elif timeline_warning:

        classification = (
            "SUSPICIOUS AUDIO"
        )

        risk_level = "HIGH"
        confidence = "MODERATE"

        reasons.append(
            "Localized suspicious or synthetic "
            "speech evidence was detected."
        )

        if identity_match:

            reasons.append(
                "Audio also matches a trusted identity."
            )

    # CASE D:
    # Detector itself is unstable.
    #
    # We deliberately avoid declaring the audio
    # genuine or fake.

    elif robustness_unstable:

        classification = "INCONCLUSIVE"
        risk_level = "MEDIUM"
        confidence = "LOW"

        reasons.append(
            "Synthetic-speech detector was unstable "
            "under controlled audio transformations."
        )

        reasons.append(
            "The authenticity result should not be "
            "treated as reliable without additional "
            "verification."
        )

    # CASE E:
    # Low synthetic evidence + stable detector.

    elif (
        fake_probability < 0.30
        and robustness_stability == "stable"
    ):

        classification = (
            "LIKELY GENUINE"
        )

        risk_level = "LOW"
        confidence = "MODERATE"

        reasons.append(
            "Low synthetic-speech evidence detected."
        )

        reasons.append(
            "Detector remained stable under "
            "controlled transformations."
        )

        if identity_match:

            reasons.append(
                "Audio matches a trusted identity."
            )

    # CASE F:
    # Everything else stays inconclusive.

    else:

        classification = "INCONCLUSIVE"
        risk_level = "MEDIUM"
        confidence = "LOW"

        reasons.append(
            "Available evidence is insufficient "
            "for a confident authenticity decision."
        )

    # --------------------------------------------------
    # 6. CONFIDENCE SAFETY CHECK
    # --------------------------------------------------

    # Even if another branch produced a strong result,
    # instability should lower confidence.

    if robustness_unstable:

        confidence = "LOW"

        if (
            "Detector instability reduces confidence."
            not in reasons
        ):
            reasons.append(
                "Detector instability reduces confidence."
            )

    # --------------------------------------------------
    # 7. RECOMMENDATION
    # --------------------------------------------------

    if classification == "POSSIBLE VOICE CLONE":

        recommendation = (
            "Treat the audio as high-risk. "
            "Verify the trusted person's identity "
            "through an independent communication "
            "channel before taking action."
        )

    elif classification == "LIKELY SYNTHETIC":

        recommendation = (
            "Treat the audio as suspicious and "
            "verify its source before relying on it."
        )

    elif classification == "SUSPICIOUS AUDIO":

        recommendation = (
            "Review the flagged timeline regions "
            "and verify the speaker or source using "
            "an independent method."
        )

    elif classification == "INCONCLUSIVE":

        recommendation = (
            "Do not rely on the audio alone. "
            "Obtain additional evidence or verify "
            "the speaker through an independent "
            "trusted channel."
        )

    else:

        recommendation = (
            "No strong synthetic indicators were "
            "detected, but authenticity should not "
            "be treated as guaranteed."
        )

    # --------------------------------------------------
    # 8. RETURN
    # --------------------------------------------------

    return {
        "classification":
            classification,

        "risk_level":
            risk_level,

        "confidence":
            confidence,

        "possible_voice_clone":
            possible_voice_clone,

        "trusted_identity_match":
            trusted_identity
            if identity_match
            else None,

        "identity_similarity":
            identity_similarity
            if identity_match
            else None,

        "evidence": {

            "synthetic_speech": {
                "level":
                    synthetic_level,

                "fake_probability":
                    round(
                        fake_probability,
                        4
                    ),

                "real_probability":
                    round(
                        real_probability,
                        4
                    ),
            },

            "identity": {
                "matched":
                    identity_match,

                "identity":
                    trusted_identity
                    if identity_match
                    else None,

                "similarity":
                    identity_similarity
                    if identity_match
                    else None,
            },

            "timeline": {
                "usable_segments":
                    usable_segments,

                "synthetic_segments":
                    synthetic_segments,

                "suspicious_segments":
                    suspicious_segments,

                "mixed_evidence":
                    mixed_evidence,
            },

            "robustness": {
                "stability":
                    robustness_stability
            },
        },

        "reasons":
            reasons,

        "recommendation":
            recommendation,

        "note": (
            "AIA combines multiple evidence sources "
            "rather than treating any single model "
            "output as definitive proof. Current "
            "fusion thresholds are prototype values "
            "and require calibration."
        ),
    }


if __name__ == "__main__":
    print(
        "AIA Evidence Fusion Engine ready."
    )