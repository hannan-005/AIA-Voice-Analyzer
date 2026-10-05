from pathlib import Path
import threading

import torch
import torchaudio

from speechbrain.inference.speaker import SpeakerRecognition
from speechbrain.utils.fetching import LocalStrategy


print("Loading speaker verification model...")

speaker_model = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="pretrained_models/spkrec-ecapa-voxceleb",
    local_strategy=LocalStrategy.COPY,
)

print("Speaker verification model loaded successfully.")

TARGET_SAMPLE_RATE = 16000
SPEAKER_MATCH_THRESHOLD = 0.25

# Reference embeddings are stable until an enrolled WAV changes.
# Cache them by absolute path + modification time + file size.
_REFERENCE_EMBEDDING_CACHE = {}
_REFERENCE_CACHE_LOCK = threading.RLock()

# SpeechBrain / PyTorch inference is guarded so concurrent live/offline requests
# do not make the CPU fight itself.
_SPEAKER_INFERENCE_LOCK = threading.RLock()


def load_audio(audio_path: str):
    """
    Load audio, convert to mono, and resample to 16 kHz when needed.
    Returns SpeechBrain-compatible [batch, time] float waveform.
    """
    path = Path(audio_path).resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"Audio file does not exist: {path}"
        )

    try:
        waveform, sample_rate = torchaudio.load(str(path))
    except Exception as exc:
        raise RuntimeError(
            f"Could not load audio file '{path}': {exc}"
        ) from exc

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    if sample_rate != TARGET_SAMPLE_RATE:
        waveform = torchaudio.functional.resample(
            waveform,
            sample_rate,
            TARGET_SAMPLE_RATE,
        )
        sample_rate = TARGET_SAMPLE_RATE

    return waveform.float(), sample_rate


def encode_waveform(waveform: torch.Tensor):
    """
    Produce one ECAPA speaker embedding.

    normalize=False intentionally matches SpeechBrain verify_batch(), whose
    own implementation compares non-normalized embeddings with cosine
    similarity.
    """
    with _SPEAKER_INFERENCE_LOCK:
        with torch.inference_mode():
            embedding = speaker_model.encode_batch(
                waveform,
                normalize=False,
            )

    return embedding.detach().cpu()


def encode_audio(audio_path: str):
    waveform, _ = load_audio(audio_path)
    return encode_waveform(waveform)


def _reference_cache_key(reference_audio: str):
    path = Path(reference_audio).resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"Reference audio does not exist: {path}"
        )

    stat = path.stat()

    return (
        str(path),
        stat.st_mtime_ns,
        stat.st_size,
    )


def get_reference_embedding(reference_audio: str):
    """
    Return a cached ECAPA embedding for an enrolled reference WAV.
    The cache automatically invalidates when the file changes.
    """
    cache_key = _reference_cache_key(reference_audio)

    with _REFERENCE_CACHE_LOCK:
        cached = _REFERENCE_EMBEDDING_CACHE.get(cache_key)

    if cached is not None:
        return cached

    embedding = encode_audio(reference_audio)

    with _REFERENCE_CACHE_LOCK:
        # Remove stale entries for the same path.
        reference_path = cache_key[0]
        stale_keys = [
            key
            for key in _REFERENCE_EMBEDDING_CACHE
            if key[0] == reference_path and key != cache_key
        ]

        for key in stale_keys:
            _REFERENCE_EMBEDDING_CACHE.pop(key, None)

        _REFERENCE_EMBEDDING_CACHE[cache_key] = embedding

    return embedding


def clear_reference_embedding_cache(
    reference_audio: str | None = None,
):
    """
    Clear one enrolled reference from cache, or clear all cached references.
    Useful after enrollment/deletion, though file-stat invalidation already
    prevents stale embeddings from being reused.
    """
    with _REFERENCE_CACHE_LOCK:
        if reference_audio is None:
            _REFERENCE_EMBEDDING_CACHE.clear()
            return

        resolved = str(Path(reference_audio).resolve())

        keys = [
            key
            for key in _REFERENCE_EMBEDDING_CACHE
            if key[0] == resolved
        ]

        for key in keys:
            _REFERENCE_EMBEDDING_CACHE.pop(key, None)


def compare_embeddings(
    reference_embedding: torch.Tensor,
    test_embedding: torch.Tensor,
):
    """
    Match SpeechBrain SpeakerRecognition.verify_batch() behavior:
    cosine similarity > 0.25 means same-speaker evidence.
    """
    with torch.inference_mode():
        score = speaker_model.similarity(
            reference_embedding,
            test_embedding,
        )

    similarity_score = float(
        score.squeeze().item()
    )

    return {
        "similarity_score": round(
            similarity_score,
            4,
        ),
        "same_speaker": bool(
            similarity_score > SPEAKER_MATCH_THRESHOLD
        ),
    }


def verify_speaker(
    reference_audio: str,
    test_audio: str,
):
    """
    Backward-compatible verification function used by the rest of AIA.

    Faster than the old implementation because an enrolled reference
    embedding is cached. The test audio is encoded once for this call.
    """
    reference_embedding = get_reference_embedding(
        reference_audio
    )

    test_embedding = encode_audio(
        test_audio
    )

    result = compare_embeddings(
        reference_embedding,
        test_embedding,
    )

    print("\nSpeaker verification")
    print("--------------------")
    print(
        f"Reference: {Path(reference_audio).resolve()}"
    )
    print(
        f"Test:      {Path(test_audio).resolve()}"
    )
    print(
        "Similarity score:",
        result["similarity_score"],
    )
    print(
        "Same speaker:",
        result["same_speaker"],
    )

    return result


if __name__ == "__main__":
    print("\nTesting speaker verification...")

    result = verify_speaker(
        "voice_ref_fixed.wav",
        "different_person_fixed.wav",
    )

    print("\nSpeaker Verification Result:")
    print(result)
