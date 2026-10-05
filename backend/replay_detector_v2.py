from pathlib import Path

import torch
import torchaudio
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification


MODEL_ID = "Vansh180/deepfake-audio-wav2vec2"


print("Loading AIA Replay Detector V2...")


feature_extractor = AutoFeatureExtractor.from_pretrained(
    MODEL_ID
)

replay_model = AutoModelForAudioClassification.from_pretrained(
    MODEL_ID
)

replay_model.eval()


def _load_audio(audio_path: str):

    path = Path(audio_path)

    if not path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {path}"
        )

    waveform, sample_rate = torchaudio.load(
        str(path)
    )

    # Convert stereo to mono
    if waveform.shape[0] > 1:
        waveform = waveform.mean(
            dim=0,
            keepdim=True
        )

    # Convert to 16 kHz
    if sample_rate != 16000:

        waveform = torchaudio.functional.resample(
            waveform,
            sample_rate,
            16000
        )

        sample_rate = 16000

    waveform = waveform.squeeze(0)

    return waveform, sample_rate


def _find_label_index(
    label_map,
    keywords
):

    for index, label in label_map.items():

        label_lower = str(label).lower()

        for keyword in keywords:

            if keyword in label_lower:
                return int(index)

    return None


def analyze_replay_v2(
    audio_path: str
):

    waveform, sample_rate = _load_audio(
        audio_path
    )

    audio_array = (
        waveform
        .detach()
        .cpu()
        .numpy()
    )

    inputs = feature_extractor(
        audio_array,
        sampling_rate=sample_rate,
        return_tensors="pt",
        padding=True,
    )

    with torch.no_grad():

        outputs = replay_model(
            **inputs
        )

    probabilities = torch.softmax(
        outputs.logits,
        dim=-1
    )[0]

    label_map = replay_model.config.id2label

    print(
        "Replay V2 labels:",
        label_map
    )

    spoof_index = _find_label_index(
        label_map,
        [
            "spoof",
            "fake",
            "attack"
        ]
    )

    genuine_index = _find_label_index(
        label_map,
        [
            "bonafide",
            "bona fide",
            "genuine",
            "real"
        ]
    )

    # Fallback for binary models
    if (
        spoof_index is None
        or genuine_index is None
    ):

        if len(probabilities) != 2:

            raise RuntimeError(
                "Unable to identify spoof and "
                "bonafide labels from model."
            )

        print(
            "WARNING: Could not infer model "
            "labels automatically. Using "
            "binary fallback."
        )

        genuine_index = 0
        spoof_index = 1

    spoof_probability = float(
        probabilities[
            spoof_index
        ].item()
    )

    genuine_probability = float(
        probabilities[
            genuine_index
        ].item()
    )

    # ---------------------------------------
    # Prototype interpretation thresholds.
    # These must later be calibrated using
    # our own genuine/replay evaluation set.
    # ---------------------------------------

    if spoof_probability >= 0.75:

        classification = (
            "likely_spoof"
        )

        evidence_level = "high"

    elif spoof_probability >= 0.50:

        classification = (
            "possible_spoof"
        )

        evidence_level = "elevated"

    elif spoof_probability >= 0.30:

        classification = (
            "uncertain"
        )

        evidence_level = "moderate"

    else:

        classification = (
            "likely_bonafide"
        )

        evidence_level = "low"

    return {

        "status":
            "completed",

        "model":
            MODEL_ID,

        "sample_rate":
            sample_rate,

        "bonafide_probability":
            round(
                genuine_probability,
                4
            ),

        "spoof_probability":
            round(
                spoof_probability,
                4
            ),

        "classification":
            classification,

        "evidence_level":
            evidence_level,

        "model_labels":
            {
                str(key): value
                for key, value
                in label_map.items()
            },

        "interpretation": (
            "This anti-spoofing model estimates "
            "whether the received speech resembles "
            "bonafide speech or spoofed speech. "
            "Spoof evidence may include replay or "
            "other attack characteristics depending "
            "on the model's training data."
        ),

        "warning": (
            "This result is not proof of replay. "
            "Anti-spoofing models can fail under "
            "unseen devices, rooms, codecs, "
            "languages, speakers, and attack types. "
            "AIA should combine this result with "
            "synthetic-speech detection, speaker "
            "verification, and other evidence."
        ),
    }


if __name__ == "__main__":

    print(
        "AIA Replay Detector V2 ready."
    )