import wave
import numpy as np
import torch

from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

MODEL_NAME = "garystafford/wav2vec2-deepfake-voice-detector"

print("Loading voice deepfake detection model...")

try:
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
except Exception:
    pass

feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_NAME)
model = AutoModelForAudioClassification.from_pretrained(MODEL_NAME)
model.eval()

print("Voice detector loaded successfully.")


def _load_normalized_wav_fast(file_path: str):
    """
    Fast loader for AIA's already-normalized 16 kHz mono PCM16 WAV files.
    """
    with wave.open(file_path, "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw_audio = wav_file.readframes(frame_count)

    if channels != 1:
        raise ValueError(
            f"Voice detector expected mono WAV, received {channels} channels."
        )

    if sample_width != 2:
        raise ValueError(
            f"Voice detector expected 16-bit PCM WAV, received {sample_width * 8}-bit."
        )

    if sample_rate != 16000:
        raise ValueError(
            f"Voice detector expected 16000 Hz WAV, received {sample_rate} Hz."
        )

    audio = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32)
    audio /= 32768.0
    return audio


def analyze_voice(file_path: str):
    audio = _load_normalized_wav_fast(file_path)

    if audio.size == 0:
        return {"real": 0.0, "fake": 0.0}

    inputs = feature_extractor(
        audio,
        sampling_rate=16000,
        return_tensors="pt",
        padding=False,
    )

    with torch.inference_mode():
        outputs = model(**inputs)
        probabilities = torch.softmax(outputs.logits, dim=-1)[0]

    labels = model.config.id2label
    result = {}

    for index, probability in enumerate(probabilities):
        label = str(labels[index]).lower()
        result[label] = float(probability.item())

    result.setdefault("real", 0.0)
    result.setdefault("fake", 0.0)
    return result


if __name__ == "__main__":
    print("\nAnalyzing test recording...")
    result = analyze_voice("Recording.wav")
    print("\nAI Analysis Result:")
    print(result)
