from pathlib import Path
from statistics import mean

from speaker_verifier import (
    compare_embeddings,
    encode_audio,
    get_reference_embedding,
)


BASE_DIR = Path(__file__).resolve().parent

TRUSTED_IDENTITIES_DIR = (
    BASE_DIR / "trusted_identities"
)

TRUSTED_IDENTITIES_DIR.mkdir(
    parents=True,
    exist_ok=True
)


def get_reference_files(
    identity_folder: Path,
):
    """
    Return all enrolled reference WAV files for one trusted identity.
    Supports legacy reference.wav plus reference_1.wav, reference_2.wav, etc.
    """
    references = []

    legacy_reference = (
        identity_folder / "reference.wav"
    )

    if legacy_reference.exists():
        references.append(
            legacy_reference
        )

    numbered_references = sorted(
        identity_folder.glob(
            "reference_*.wav"
        )
    )

    for reference in numbered_references:
        if reference not in references:
            references.append(
                reference
            )

    return references


def analyze_identity_from_embedding(
    identity_folder: Path,
    test_embedding,
):
    """
    Compare one already-computed test embedding against every cached reference
    embedding belonging to one identity.
    """
    identity = identity_folder.name

    reference_files = get_reference_files(
        identity_folder
    )

    if not reference_files:
        return None

    sample_results = []

    for reference_path in reference_files:
        try:
            reference_embedding = (
                get_reference_embedding(
                    str(reference_path)
                )
            )

            verification = compare_embeddings(
                reference_embedding,
                test_embedding,
            )

            sample_results.append(
                {
                    "reference":
                        reference_path.name,
                    "similarity_score":
                        float(
                            verification[
                                "similarity_score"
                            ]
                        ),
                    "same_speaker":
                        bool(
                            verification[
                                "same_speaker"
                            ]
                        ),
                }
            )

        except Exception as exc:
            print(
                f"Speaker comparison failed "
                f"for {identity} / "
                f"{reference_path.name}: "
                f"{exc}"
            )

    if not sample_results:
        return None

    similarity_scores = [
        item["similarity_score"]
        for item in sample_results
    ]

    matching_samples = sum(
        1
        for item in sample_results
        if item["same_speaker"]
    )

    total_samples = len(
        sample_results
    )

    average_similarity = mean(
        similarity_scores
    )

    max_similarity = max(
        similarity_scores
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
            sample_results[0][
                "same_speaker"
            ]
        )

    return {
        "identity":
            identity,

        "average_similarity":
            round(
                average_similarity,
                4
            ),

        "max_similarity":
            round(
                max_similarity,
                4
            ),

        # Backward-compatible field expected by AIA frontend/backend.
        "similarity_score":
            round(
                average_similarity,
                4
            ),

        "same_speaker":
            same_speaker,

        "matching_samples":
            matching_samples,

        "total_samples":
            total_samples,

        "sample_results":
            sample_results,
    }


def analyze_identity(
    identity_folder: Path,
    test_audio: str,
):
    """
    Backward-compatible helper for checking one identity.

    The suspicious/test audio is encoded exactly once.
    """
    test_embedding = encode_audio(
        test_audio
    )

    return analyze_identity_from_embedding(
        identity_folder,
        test_embedding,
    )


def search_trust_circle(
    test_audio: str,
):
    """
    Fast Trust Circle search.

    Major optimization:
      OLD:
        encode test audio again for every reference comparison.

      NEW:
        1. encode incoming test audio ONCE
        2. reuse cached ECAPA embeddings for all enrolled references
        3. perform only inexpensive cosine comparisons afterward

    Returned JSON structure remains compatible with the existing AIA UI.
    """
    if not TRUSTED_IDENTITIES_DIR.exists():
        return {
            "status": "empty",
            "best_match": None,
            "matches": [],
            "identities_scanned": 0,
            "message":
                "No trusted identities are enrolled.",
        }

    identity_folders = sorted(
        [
            folder
            for folder
            in TRUSTED_IDENTITIES_DIR.iterdir()
            if folder.is_dir()
        ],
        key=lambda folder:
            folder.name.lower()
    )

    if not identity_folders:
        return {
            "status": "empty",
            "best_match": None,
            "matches": [],
            "identities_scanned": 0,
            "message":
                "No trusted identities are enrolled.",
        }

    # This is the expensive ECAPA operation for the incoming sample.
    # It happens exactly ONCE for the entire Trust Circle search.
    test_embedding = encode_audio(
        test_audio
    )

    matches = []

    for identity_folder in identity_folders:
        try:
            identity_result = (
                analyze_identity_from_embedding(
                    identity_folder,
                    test_embedding,
                )
            )

            if identity_result:
                matches.append(
                    identity_result
                )

        except Exception as exc:
            print(
                "Trust Circle comparison "
                f"failed for "
                f"{identity_folder.name}: "
                f"{exc}"
            )

    if not matches:
        return {
            "status": "unavailable",
            "best_match": None,
            "matches": [],
            "identities_scanned": 0,
            "message":
                "No usable trusted voice "
                "references were found.",
        }

    matches.sort(
        key=lambda item:
            item[
                "average_similarity"
            ],
        reverse=True,
    )

    strongest_candidate = (
        matches[0]
    )

    if strongest_candidate[
        "same_speaker"
    ]:
        best_match = (
            strongest_candidate
        )
        status = "match"
    else:
        best_match = None
        status = "no_match"

    return {
        "status":
            status,

        "best_match":
            best_match,

        "strongest_candidate":
            strongest_candidate,

        "matches":
            matches,

        "identities_scanned":
            len(matches),

        "message":
            "Trust Circle search completed.",
    }


def warm_trust_circle_cache():
    """
    Optional startup warm-up.

    Precompute reference embeddings so the first live Trust Circle verification
    does not pay the cost of embedding every enrolled reference.
    """
    warmed = 0
    failed = 0

    if not TRUSTED_IDENTITIES_DIR.exists():
        return {
            "warmed": 0,
            "failed": 0,
        }

    for identity_folder in TRUSTED_IDENTITIES_DIR.iterdir():
        if not identity_folder.is_dir():
            continue

        for reference_path in get_reference_files(
            identity_folder
        ):
            try:
                get_reference_embedding(
                    str(reference_path)
                )
                warmed += 1
            except Exception as exc:
                failed += 1
                print(
                    "Could not warm speaker reference "
                    f"{reference_path}: {exc}"
                )

    return {
        "warmed": warmed,
        "failed": failed,
    }


if __name__ == "__main__":
    print(
        "AIA Trust Circle module ready."
    )

    print(
        "Trusted identity directory:"
    )

    print(
        TRUSTED_IDENTITIES_DIR
    )
