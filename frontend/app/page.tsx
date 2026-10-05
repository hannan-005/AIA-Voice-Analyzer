"use client";

import { useEffect, useRef, useState } from "react";

type SpeakerVerification = {
  identity?: string;
  claimed_identity?: string;
  similarity_score?: number;
  similarity?: number;
  same_speaker?: boolean;
  match?: boolean;
  message?: string;
};

type TrustCircleMatch = {
  identity: string;
  similarity_score: number;
  same_speaker: boolean;
};

type TrustCircleSearch = {
  status: string;
  best_match: TrustCircleMatch | null;
  matches: TrustCircleMatch[];
  message?: string;
};

type IdentityMode = "automatic" | "specific";

type IdentityRecord = {
  identity: string;
  sample_count: number;
};

type TimelineSegment = {
  segment_index: number;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  real_probability: number | null;
  fake_probability: number | null;
  classification:
    | "synthetic"
    | "suspicious"
    | "likely_genuine"
    | "unavailable";
  error?: string;
};

type AudioIntegrityTimeline = {
  chunk_seconds: number;
  total_segments: number;
  usable_segments: number;
  synthetic_segments: number;
  suspicious_segments: number;
  likely_genuine_segments: number;
  mixed_evidence: boolean;
  strongest_synthetic_segment: TimelineSegment | null;
  segments: TimelineSegment[];
  note: string;
};

type EvidenceFusion = {
  classification?: string;
  final_classification?: string;
  verdict?: string;
  risk_level?: string;
  confidence?: string;
  reasons?: string[];
  recommendation?: string;
  evidence_matrix?: Record<string, unknown>;
  trusted_identity_match?: string | null;
  identity_similarity?: number | null;
  possible_voice_clone?: boolean;
  calibration_note?: string;
};

type RobustnessAnalysis = {
  stability?: string;
  [key: string]: unknown;
};

type HistoryRecord = {
  id: string;
  timestamp: string;
  filename: string;
  classification: string;
  risk_level: string;
  confidence: string;
  synthetic_score: number;
  trusted_identity?: string | null;
  identity_similarity?: number | null;
  possible_voice_clone?: boolean;
  recommendation?: string;
};

type AlertRecord = {
  id: string;
  timestamp: string;
  severity: string;
  title: string;
  filename: string;
  classification: string;
  confidence: string;
  synthetic_score: number;
  trusted_identity?: string | null;
  identity_similarity?: number | null;
  possible_voice_clone?: boolean;
  recommendation?: string;
};

type SecurityEventRecord = {
  id: string;
  timestamp: string;
  event_type: string;
  filename: string;
  classification: string;
  risk_level: string;
  confidence: string;
  synthetic_score: number;
  trusted_identity?: string | null;
  identity_similarity?: number | null;
  possible_voice_clone?: boolean;
  recommendation?: string;
};

type PrivacySettings = {
  raw_audio_retention: boolean;
  metadata_retention_days: number;
  store_filenames: boolean;
  feature_only_logging: boolean;
};

type LiveChunkResult = {
  chunk_index: number;
  timestamp: string;
  real_probability: number;
  fake_probability: number;
  synthetic_score: number;
  risk_level: "SAFE" | "SUSPICIOUS" | "HIGH" | string;
  classification: string;
  chunk_seconds: number;
  speech_detected?: boolean;
  speech_activity?: {
    activity_ratio?: number;
    audio_level_dbfs?: number | null;
    note?: string;
  };
  live_identity?: {
    status?: string;
    speech_collected_seconds?: number;
    minimum_speech_seconds?: number;
    trust_circle?: TrustCircleSearch | null;
    note?: string;
  } | null;
  noise_robustness_experiment?: {
    enabled?: boolean;
    experimental_only?: boolean;
    affects_live_verdict?: boolean;
    skipped?: boolean;
    reason?: string;
    original_synthetic_score?: number;
    cleaned_synthetic_score?: number;
    difference_percentage_points?: number;
    observation?: string;
    warning?: string;
  };
};

type LiveTimelineItem = LiveChunkResult & {
  start_seconds: number;
  end_seconds: number;
};

type LiveFinalizeResult = {
  status?: string;
  speech_collected_seconds?: number;
  trust_circle?: TrustCircleSearch | null;
  verification_in_progress?: boolean;
  waited_ms?: number;
};


type LiveSessionSummary = {
  duration_seconds: number;
  chunks_analyzed: number;
  average_synthetic_percent: number;
  peak_synthetic_percent: number;
  safe_chunks: number;
  suspicious_chunks: number;
  high_chunks: number;
  no_speech_chunks: number;
  usable_speech_chunks: number;
  persistent_warning: boolean;
  assessment:
    | "LIKELY GENUINE"
    | "SUSPICIOUS"
    | "LIKELY SYNTHETIC";
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  recommendation: string;
  fusion_assessment:
    | "LIKELY GENUINE TRUSTED SPEAKER"
    | "POSSIBLE VOICE IMPERSONATION"
    | "LIKELY SYNTHETIC / UNKNOWN SPEAKER"
    | "LIKELY GENUINE / UNKNOWN SPEAKER"
    | "INCONCLUSIVE";
  fusion_risk_level: "LOW" | "MEDIUM" | "HIGH";
  fusion_reason: string;
  fusion_recommendation: string;
  trusted_identity: string | null;
  speaker_similarity_percent: number | null;
  trusted_speaker_match: boolean;
};

type AnalysisResult = {
  filename: string;

  voice_authenticity: {
    real_probability: number;
    fake_probability: number;
  };

  speaker_verification: SpeakerVerification | null;
  trust_circle_search?: TrustCircleSearch | null;
  audio_integrity_timeline?: AudioIntegrityTimeline | null;
  robustness_analysis?: RobustnessAnalysis | null;
  evidence_fusion?: EvidenceFusion | null;

  risk_analysis: {
    risk_score: number;
    risk_level: string;
    classification: string;
    possible_voice_clone?: boolean;
    automatic_impersonation?: boolean;
    suspected_identity?: string | null;
  };

  forensic_analysis: {
    duration_seconds: number;
    sample_rate: number;

    prosody: {
      pitch_mean_hz: number;
      pitch_variation_hz: number;
      energy_variation: number;
      silence_ratio: number;
    };

    spectral: {
      spectral_centroid_hz: number;
      spectral_variation: number;
      spectral_flatness: number;
      zero_crossing_rate: number;
    };

    experimental_indicators: string[];
  };

  recommendation: string;
};

const API_BASE = "http://127.0.0.1:8000";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);

  const [result, setResult] =
    useState<AnalysisResult | null>(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [trustedIdentities, setTrustedIdentities] =
    useState<IdentityRecord[]>([]);

  const [identityMode, setIdentityMode] =
    useState<IdentityMode>("automatic");

  const [claimedIdentity, setClaimedIdentity] =
    useState("");

  const [newIdentity, setNewIdentity] =
    useState("");

  const [enrollmentFile, setEnrollmentFile] =
    useState<File | null>(null);

  const [enrolling, setEnrolling] =
    useState(false);

  const [identityMessage, setIdentityMessage] =
    useState("");

  const [showEnrollment, setShowEnrollment] =
    useState(false);

  const [showTechnicalDetails, setShowTechnicalDetails] =
    useState(false);


  const [analysisHistory, setAnalysisHistory] =
    useState<HistoryRecord[]>([]);

  const [showHistory, setShowHistory] =
    useState(false);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyMessage, setHistoryMessage] =
    useState("");


  const [alerts, setAlerts] =
    useState<AlertRecord[]>([]);

  const [securityEvents, setSecurityEvents] =
    useState<SecurityEventRecord[]>([]);

  const [showAlerts, setShowAlerts] =
    useState(false);

  const [alertsLoading, setAlertsLoading] =
    useState(false);

  const [alertsMessage, setAlertsMessage] =
    useState("");

  const [eventsMessage, setEventsMessage] =
    useState("");


  const [privacySettings, setPrivacySettings] =
    useState<PrivacySettings>({
      raw_audio_retention: false,
      metadata_retention_days: 30,
      store_filenames: true,
      feature_only_logging: true,
    });

  const [showPrivacy, setShowPrivacy] =
    useState(false);

  const [privacyLoading, setPrivacyLoading] =
    useState(false);

  const [privacySaving, setPrivacySaving] =
    useState(false);

  const [privacyMessage, setPrivacyMessage] =
    useState("");

  // ---------------------------------------------------------
  // LIVE ANALYSIS — LAYERS 1 + 2
  // ---------------------------------------------------------
  const [showLive, setShowLive] =
    useState(false);

  const [liveActive, setLiveActive] =
    useState(false);

  const [liveElapsed, setLiveElapsed] =
    useState(0);

  const [liveCurrent, setLiveCurrent] =
    useState<LiveChunkResult | null>(null);

  const [liveTimeline, setLiveTimeline] =
    useState<LiveTimelineItem[]>([]);

  const [liveError, setLiveError] =
    useState("");

  const [liveProcessing, setLiveProcessing] =
    useState(0);

  const [liveFinalizing, setLiveFinalizing] =
    useState(false);


  const [liveSummary, setLiveSummary] =
    useState<LiveSessionSummary | null>(null);

  const [showCompletedChunks, setShowCompletedChunks] =
    useState(false);

  const [showReportBreakdown, setShowReportBreakdown] =
    useState(false);

  const liveStreamRef =
    useRef<MediaStream | null>(null);

  const liveRecorderRef =
    useRef<MediaRecorder | null>(null);

  const liveActiveRef =
    useRef(false);

  const liveChunkIndexRef =
    useRef(0);

  const liveStartedAtRef =
    useRef<number | null>(null);

  const liveTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const liveTimelineRef =
    useRef<LiveTimelineItem[]>([]);

  const livePendingRequestsRef =
    useRef<Set<Promise<void>>>(new Set());

  const liveAbortControllersRef =
    useRef<Set<AbortController>>(new Set());

  const liveStoppingRef =
    useRef(false);

  const liveSessionIdRef =
    useRef<string | null>(null);

  const liveIdentityEvidenceRef =
    useRef<{
      identity: string | null;
      similarityPercent: number | null;
      trustedMatch: boolean;
    }>({
      identity: null,
      similarityPercent: null,
      trustedMatch: false,
    });

  useEffect(() => {
    loadTrustedIdentities();
    loadAnalysisHistory();
    loadAlertsAndEvents();
    loadPrivacySettings();
  }, []);

  useEffect(() => {
    return () => {
      liveActiveRef.current = false;

      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
      }

      liveStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, []);

  async function loadTrustedIdentities() {
    try {
      const response = await fetch(
        `${API_BASE}/trusted-identities`
      );

      if (!response.ok) {
        throw new Error(
          `Could not load identities (${response.status})`
        );
      }

      const data = await response.json();

      const rawIdentities =
        Array.isArray(data)
          ? data
          : Array.isArray(data.identities)
          ? data.identities
          : Array.isArray(data.trusted_identities)
          ? data.trusted_identities
          : [];

      const normalized: IdentityRecord[] =
        rawIdentities.map((item: unknown) => {
          if (typeof item === "string") {
            return {
              identity: item,
              sample_count: 1,
            };
          }

          const record =
            item as Partial<IdentityRecord>;

          return {
            identity:
              record.identity ?? "unknown",
            sample_count:
              record.sample_count ?? 1,
          };
        });

      setTrustedIdentities(normalized);
    } catch (err) {
      console.error(
        "Could not load trusted identities:",
        err
      );
    }
  }

  async function loadAnalysisHistory() {
    setHistoryLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/analysis-history`
      );

      if (!response.ok) {
        throw new Error(
          `Could not load history (${response.status})`
        );
      }

      const data = await response.json();

      setAnalysisHistory(
        Array.isArray(data.history)
          ? data.history
          : []
      );
    } catch (err) {
      console.error(
        "Could not load analysis history:",
        err
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearAnalysisHistory() {
    if (analysisHistory.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all saved AIA analysis history?"
    );

    if (!confirmed) {
      return;
    }

    setHistoryMessage("");

    try {
      const response = await fetch(
        `${API_BASE}/analysis-history`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Could not clear analysis history."
        );
      }

      setAnalysisHistory([]);
      setHistoryMessage(
        "Analysis history cleared."
      );
    } catch (err) {
      setHistoryMessage(
        err instanceof Error
          ? err.message
          : "Could not clear analysis history."
      );
    }
  }

  async function loadAlertsAndEvents() {
    setAlertsLoading(true);

    try {
      const [alertsResponse, eventsResponse] =
        await Promise.all([
          fetch(`${API_BASE}/alerts`),
          fetch(`${API_BASE}/security-events`),
        ]);

      if (!alertsResponse.ok) {
        throw new Error(
          `Could not load alerts (${alertsResponse.status})`
        );
      }

      if (!eventsResponse.ok) {
        throw new Error(
          `Could not load event log (${eventsResponse.status})`
        );
      }

      const [alertsData, eventsData] =
        await Promise.all([
          alertsResponse.json(),
          eventsResponse.json(),
        ]);

      setAlerts(
        Array.isArray(alertsData.alerts)
          ? alertsData.alerts
          : []
      );

      setSecurityEvents(
        Array.isArray(eventsData.events)
          ? eventsData.events
          : []
      );
    } catch (err) {
      console.error(
        "Could not load alerts/event log:",
        err
      );
    } finally {
      setAlertsLoading(false);
    }
  }

  async function clearAlerts() {
    if (alerts.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all active AIA alerts?"
    );

    if (!confirmed) {
      return;
    }

    setAlertsMessage("");

    try {
      const response = await fetch(
        `${API_BASE}/alerts`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Could not clear alerts."
        );
      }

      setAlerts([]);
      setAlertsMessage(
        "Active alerts cleared."
      );
    } catch (err) {
      setAlertsMessage(
        err instanceof Error
          ? err.message
          : "Could not clear alerts."
      );
    }
  }

  async function clearSecurityEvents() {
    if (securityEvents.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Clear the AIA security event log?"
    );

    if (!confirmed) {
      return;
    }

    setEventsMessage("");

    try {
      const response = await fetch(
        `${API_BASE}/security-events`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Could not clear event log."
        );
      }

      setSecurityEvents([]);
      setEventsMessage(
        "Security event log cleared."
      );
    } catch (err) {
      setEventsMessage(
        err instanceof Error
          ? err.message
          : "Could not clear event log."
      );
    }
  }

  async function loadPrivacySettings() {
    setPrivacyLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/privacy-settings`
      );

      if (!response.ok) {
        throw new Error(
          `Could not load privacy settings (${response.status})`
        );
      }

      const data = await response.json();

      if (data.settings) {
        setPrivacySettings(data.settings);
      }
    } catch (err) {
      console.error(
        "Could not load privacy settings:",
        err
      );
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function savePrivacySettings() {
    setPrivacySaving(true);
    setPrivacyMessage("");

    try {
      const response = await fetch(
        `${API_BASE}/privacy-settings`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            metadata_retention_days:
              privacySettings.metadata_retention_days,
            store_filenames:
              privacySettings.store_filenames,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Could not update privacy settings."
        );
      }

      if (data.settings) {
        setPrivacySettings(data.settings);
      }

      setPrivacyMessage(
        "Privacy settings saved."
      );

      await loadAnalysisHistory();
      await loadAlertsAndEvents();
    } catch (err) {
      setPrivacyMessage(
        err instanceof Error
          ? err.message
          : "Could not save privacy settings."
      );
    } finally {
      setPrivacySaving(false);
    }
  }

  async function purgeExpiredMetadata() {
    setPrivacyMessage("");

    try {
      const response = await fetch(
        `${API_BASE}/privacy/purge-expired`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Could not purge expired metadata."
        );
      }

      setPrivacyMessage(
        `Old results deleted — History: ${data.removed?.history ?? 0}, Alerts: ${data.removed?.alerts ?? 0}, Events: ${data.removed?.events ?? 0}.`
      );

      await loadAnalysisHistory();
      await loadAlertsAndEvents();
    } catch (err) {
      setPrivacyMessage(
        err instanceof Error
          ? err.message
          : "Could not purge expired metadata."
      );
    }
  }

  async function enrollIdentity() {
    if (!newIdentity.trim()) {
      setIdentityMessage(
        "Enter a name for the trusted identity."
      );
      return;
    }

    if (!enrollmentFile) {
      setIdentityMessage(
        "Select a reference voice recording."
      );
      return;
    }

    setEnrolling(true);
    setIdentityMessage("");

    try {
      const formData = new FormData();

      formData.append(
        "identity",
        newIdentity.trim()
      );

      formData.append(
        "file",
        enrollmentFile
      );

      const response = await fetch(
        `${API_BASE}/enroll-speaker`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Speaker enrollment failed."
        );
      }

      const enrolledIdentity =
        data.identity || newIdentity.trim();

      const sampleCount =
        data.sample_count ?? 1;

      setIdentityMessage(
        `✓ ${enrolledIdentity} saved — ${sampleCount} voice sample${
          sampleCount === 1 ? "" : "s"
        }`
      );

      setClaimedIdentity(
        enrolledIdentity
      );

      setNewIdentity("");
      setEnrollmentFile(null);

      await loadTrustedIdentities();
    } catch (err) {
      if (err instanceof Error) {
        setIdentityMessage(err.message);
      } else {
        setIdentityMessage(
          "Enrollment failed."
        );
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function deleteIdentity(
    identity: string
  ) {
    const confirmed = window.confirm(
      `Delete trusted identity "${identity}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/trusted-identities/${encodeURIComponent(
          identity
        )}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Could not delete identity."
        );
      }

      if (claimedIdentity === identity) {
        setClaimedIdentity("");
      }

      await loadTrustedIdentities();
    } catch (err) {
      console.error(err);
      setIdentityMessage(
        "Could not delete identity."
      );
    }
  }

  function formatLiveTime(seconds: number) {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");

    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");

    return `${mins}:${secs}`;
  }

  async function sendLiveChunk(
    blob: Blob,
    chunkIndex: number,
    startSeconds: number,
    endSeconds: number
  ) {
    if (blob.size < 100) {
      return;
    }

    setLiveProcessing((count) => count + 1);

    const controller =
      new AbortController();

    liveAbortControllersRef.current.add(
      controller
    );

    try {
      const mimeType =
        blob.type || "audio/webm";

      const extension =
        mimeType.includes("webm")
          ? "webm"
          : "wav";

      const liveFile = new File(
        [blob],
        `live_chunk_${chunkIndex}.${extension}`,
        {
          type: mimeType,
        }
      );

      const formData = new FormData();

      formData.append("file", liveFile);
      formData.append(
        "chunk_index",
        String(chunkIndex)
      );

      if (liveSessionIdRef.current) {
        formData.append(
          "session_id",
          liveSessionIdRef.current
        );
      }

      const response = await fetch(
        `${API_BASE}/live-analyze`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            `Live analysis failed (${response.status}).`
        );
      }

      const result =
        data as LiveChunkResult;

      const bestLiveMatch =
        result.live_identity
          ?.trust_circle?.best_match;

      if (bestLiveMatch) {
        liveIdentityEvidenceRef.current = {
          identity:
            bestLiveMatch.identity ?? null,
          similarityPercent:
            Math.round(
              (bestLiveMatch.similarity_score ?? 0) *
                100
            ),
          trustedMatch:
            bestLiveMatch.same_speaker === true,
        };
      }

      setLiveCurrent(result);

      const timelineItem: LiveTimelineItem = {
        ...result,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      };

      const updatedTimeline = [
        ...liveTimelineRef.current.filter(
          (item) =>
            item.chunk_index !== timelineItem.chunk_index
        ),
        timelineItem,
      ]
        .sort(
          (a, b) =>
            a.chunk_index - b.chunk_index
        )
        .slice(-30);

      // This ref is the immediate source of truth.
      // Update it synchronously before React schedules a render.
      liveTimelineRef.current =
        updatedTimeline;

      setLiveTimeline(
        updatedTimeline
      );

      setLiveError("");
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "AbortError"
      ) {
        return;
      }

      console.error(
        "Live chunk analysis failed:",
        err
      );

      setLiveError(
        err instanceof Error
          ? err.message
          : "Could not analyze this live audio chunk."
      );
    } finally {
      liveAbortControllersRef.current.delete(
        controller
      );

      setLiveProcessing((count) =>
        Math.max(0, count - 1)
      );
    }
  }

  function startNextLiveChunk(
    stream: MediaStream
  ) {
    if (!liveActiveRef.current) {
      return;
    }

    try {
      const preferredMime =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(
          "audio/webm;codecs=opus"
        )
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      const recorder = new MediaRecorder(
        stream,
        {
          mimeType: preferredMime,
        }
      );

      liveRecorderRef.current = recorder;

      const pieces: BlobPart[] = [];

      const chunkIndex =
        liveChunkIndexRef.current + 1;

      liveChunkIndexRef.current =
        chunkIndex;

      const startSeconds =
        (chunkIndex - 1) * 4;

      const endSeconds =
        chunkIndex * 4;

      const recordingStartedAt =
        Date.now();

      recorder.ondataavailable = (
        event
      ) => {
        if (event.data.size > 0) {
          pieces.push(event.data);
        }
      };

      recorder.onerror = () => {
        setLiveError(
          "Microphone recording failed. Check browser microphone permission."
        );
      };

      recorder.onstop = () => {
        const recordedForMs =
          Date.now() - recordingStartedAt;

        if (
          pieces.length > 0 &&
          recordedForMs >= 1500
        ) {
          const blob = new Blob(
            pieces,
            {
              type: recorder.mimeType ||
                preferredMime,
            }
          );

          const request = sendLiveChunk(
            blob,
            chunkIndex,
            startSeconds,
            endSeconds
          );

          livePendingRequestsRef.current.add(request);

          void request.finally(() => {
            livePendingRequestsRef.current.delete(request);
          });
        }

        if (liveActiveRef.current) {
          startNextLiveChunk(stream);
        }
      };

      recorder.start();

      window.setTimeout(() => {
        if (
          recorder.state === "recording"
        ) {
          recorder.stop();
        }
      }, 4000);
    } catch (err) {
      console.error(
        "Could not start live recorder:",
        err
      );

      setLiveError(
        err instanceof Error
          ? err.message
          : "Could not start live microphone recording."
      );

      void stopLiveAnalysis();
    }
  }


  function getLatestLiveIdentityEvidence(
    chunks: LiveTimelineItem[]
  ) {
    for (
      let index = chunks.length - 1;
      index >= 0;
      index -= 1
    ) {
      const bestMatch =
        chunks[index].live_identity
          ?.trust_circle?.best_match;

      if (bestMatch) {
        return {
          identity:
            bestMatch.identity ?? null,
          similarityPercent:
            Math.round(
              (bestMatch.similarity_score ?? 0) *
                100
            ),
          trustedMatch:
            bestMatch.same_speaker === true,
        };
      }
    }

    return {
      ...liveIdentityEvidenceRef.current,
    };
  }

  function buildLiveSessionSummary(
    chunks: LiveTimelineItem[],
    durationSeconds: number,
    identityEvidenceOverride?: {
      identity: string | null;
      similarityPercent: number | null;
      trustedMatch: boolean;
    } | null
  ): LiveSessionSummary | null {
    if (chunks.length === 0) {
      return null;
    }

    const usableChunks = chunks.filter(
      (chunk) =>
        chunk.risk_level !== "NO SPEECH" &&
        chunk.speech_detected !== false
    );

    const noSpeechChunks =
      chunks.length - usableChunks.length;

    const scores = usableChunks.map(
      (chunk) => chunk.synthetic_score
    );

    const average =
      scores.length > 0
        ? scores.reduce(
            (sum, score) => sum + score,
            0
          ) / scores.length
        : 0;

    const peak =
      scores.length > 0
        ? Math.max(...scores)
        : 0;

    const safeChunks = usableChunks.filter(
      (chunk) => chunk.risk_level === "SAFE"
    ).length;

    const suspiciousChunks =
      usableChunks.filter(
        (chunk) =>
          chunk.risk_level === "SUSPICIOUS"
      ).length;

    const highChunks = usableChunks.filter(
      (chunk) => chunk.risk_level === "HIGH"
    ).length;

    let persistentWarning = false;

    for (
      let index = 0;
      index <= usableChunks.length - 3;
      index += 1
    ) {
      const window = usableChunks.slice(
        index,
        index + 3
      );

      const warningChunks = window.filter(
        (chunk) =>
          chunk.risk_level === "SUSPICIOUS" ||
          chunk.risk_level === "HIGH"
      ).length;

      if (warningChunks >= 2) {
        persistentWarning = true;
        break;
      }
    }

    let assessment:
      LiveSessionSummary["assessment"] =
        "LIKELY GENUINE";

    let riskLevel:
      LiveSessionSummary["risk_level"] =
        "LOW";

    let recommendation =
      "No sustained synthetic-voice pattern was detected during usable speech.";

    if (usableChunks.length === 0) {
      assessment = "SUSPICIOUS";
      riskLevel = "MEDIUM";
      recommendation =
        "There was not enough usable speech to make a reliable session assessment. Record a longer spoken sample and try again.";
    } else if (
      highChunks >= 2 ||
      (persistentWarning && average >= 50)
    ) {
      assessment = "LIKELY SYNTHETIC";
      riskLevel = "HIGH";
      recommendation =
        "Synthetic indicators persisted across multiple speech-containing audio segments. Verify the caller through another trusted channel before approving any sensitive action.";
    } else if (
      suspiciousChunks + highChunks >= 2 ||
      persistentWarning ||
      peak >= 50
    ) {
      assessment = "SUSPICIOUS";
      riskLevel = "MEDIUM";
      recommendation =
        "Some suspicious synthetic-voice evidence appeared during usable speech. Continue monitoring and verify the speaker if the conversation involves a sensitive request.";
    }

    // -------------------------------------------------
    // LAYER 2C — CONSERVATIVE LIVE IMPERSONATION FUSION
    //
    // Speaker similarity and synthetic probability are
    // different signals. We do not add them together.
    // A trusted-speaker match + sustained synthetic evidence
    // is treated as a possible impersonation warning.
    // -------------------------------------------------
    const identityEvidence =
      identityEvidenceOverride ??
      getLatestLiveIdentityEvidence(chunks);

    // Layer 2C must distinguish an isolated short-window anomaly
    // from synthetic evidence that persists across the session.
    //
    // A single suspicious/high chunk can happen because of microphone
    // transients, codec effects, clipping, noise, or short-window model
    // uncertainty. It must NOT by itself turn a verified trusted speaker
    // into a "possible impersonation" verdict.
    const syntheticConcern =
      assessment === "SUSPICIOUS" ||
      assessment === "LIKELY SYNTHETIC";

    const sustainedSyntheticConcern =
      assessment === "LIKELY SYNTHETIC" ||
      persistentWarning ||
      suspiciousChunks + highChunks >= 2;

    const isolatedSyntheticConcern =
      syntheticConcern &&
      !sustainedSyntheticConcern;

    const strongSyntheticConcern =
      assessment === "LIKELY SYNTHETIC";

    let fusionAssessment:
      LiveSessionSummary["fusion_assessment"] =
        "INCONCLUSIVE";

    let fusionRisk:
      LiveSessionSummary["fusion_risk_level"] =
        "MEDIUM";

    let fusionReason =
      "AIA does not yet have enough combined evidence to make a stronger session-level interpretation.";

    let fusionRecommendation =
      "Continue monitoring or collect a longer spoken sample before relying on this result.";

    if (
      identityEvidence.trustedMatch &&
      sustainedSyntheticConcern
    ) {
      fusionAssessment =
        "POSSIBLE VOICE IMPERSONATION";
      fusionRisk = "HIGH";
      fusionReason =
        `The voice resembles ${identityEvidence.identity ?? "a trusted identity"}, while synthetic-voice evidence persisted across multiple usable speech segments.`;
      fusionRecommendation =
        "Do not rely on the voice alone. Verify the caller through another trusted method before sharing sensitive information, approving a transaction, or taking a high-impact action.";
    } else if (
      identityEvidence.trustedMatch &&
      isolatedSyntheticConcern
    ) {
      fusionAssessment =
        "LIKELY GENUINE TRUSTED SPEAKER";
      fusionRisk = "LOW";
      fusionReason =
        `The voice resembles ${identityEvidence.identity ?? "a trusted identity"}. A short isolated synthetic anomaly was observed, but it did not persist across the session.`;
      fusionRecommendation =
        "No sustained impersonation pattern was found. The isolated anomaly is retained as cautionary evidence; use normal secondary verification for sensitive actions.";
    } else if (
      identityEvidence.trustedMatch &&
      assessment === "LIKELY GENUINE"
    ) {
      fusionAssessment =
        "LIKELY GENUINE TRUSTED SPEAKER";
      fusionRisk = "LOW";
      fusionReason =
        `The voice resembles ${identityEvidence.identity ?? "a trusted identity"}, and no sustained synthetic-voice pattern was detected during usable speech.`;
      fusionRecommendation =
        "No strong impersonation warning was found in this session. For sensitive actions, normal secondary verification is still recommended.";
    } else if (
      !identityEvidence.trustedMatch &&
      syntheticConcern
    ) {
      fusionAssessment =
        "LIKELY SYNTHETIC / UNKNOWN SPEAKER";
      fusionRisk =
        strongSyntheticConcern ? "HIGH" : "MEDIUM";
      fusionReason =
        "Synthetic-voice evidence was detected, but AIA did not confirm a trusted-speaker match.";
      fusionRecommendation =
        "Treat the caller cautiously and verify their identity through another trusted method before sensitive actions.";
    } else if (
      !identityEvidence.trustedMatch &&
      assessment === "LIKELY GENUINE"
    ) {
      fusionAssessment =
        "LIKELY GENUINE / UNKNOWN SPEAKER";
      fusionRisk = "LOW";
      fusionReason =
        "No sustained synthetic-voice pattern was detected, but AIA did not confirm a trusted-speaker match.";
      fusionRecommendation =
        "The voice appears genuine-side, but the speaker is not confirmed as a trusted identity.";
    }

    return {
      duration_seconds: Math.max(
        durationSeconds,
        chunks[chunks.length - 1]
          ?.end_seconds ?? 0
      ),
      chunks_analyzed: chunks.length,
      average_synthetic_percent:
        Math.round(average),
      peak_synthetic_percent:
        Math.round(peak),
      safe_chunks: safeChunks,
      suspicious_chunks: suspiciousChunks,
      high_chunks: highChunks,
      no_speech_chunks: noSpeechChunks,
      usable_speech_chunks:
        usableChunks.length,
      persistent_warning: persistentWarning,
      assessment,
      risk_level: riskLevel,
      recommendation,
      fusion_assessment: fusionAssessment,
      fusion_risk_level: fusionRisk,
      fusion_reason: fusionReason,
      fusion_recommendation:
        fusionRecommendation,
      trusted_identity:
        identityEvidence.identity,
      speaker_similarity_percent:
        identityEvidence.similarityPercent,
      trusted_speaker_match:
        identityEvidence.trustedMatch,
    };
  }

  async function startLiveAnalysis() {
    setLiveSummary(null);
    setShowCompletedChunks(false);
    setShowReportBreakdown(false);
    setLiveError("");
    setLiveCurrent(null);
    setLiveTimeline([]);
    liveTimelineRef.current = [];
    livePendingRequestsRef.current.clear();
    liveIdentityEvidenceRef.current = {
      identity: null,
      similarityPercent: null,
      trustedMatch: false,
    };
    liveStoppingRef.current = false;
    setLiveElapsed(0);
    setLiveProcessing(0);
    liveSessionIdRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `aia-live-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setLiveError(
        "This browser does not support microphone capture."
      );
      return;
    }

    if (
      typeof MediaRecorder === "undefined"
    ) {
      setLiveError(
        "This browser does not support live audio recording."
      );
      return;
    }

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

      liveStreamRef.current = stream;
      liveActiveRef.current = true;
      liveChunkIndexRef.current = 0;
      liveStartedAtRef.current = Date.now();

      setLiveFinalizing(false);
      setLiveActive(true);

      if (liveTimerRef.current) {
        clearInterval(
          liveTimerRef.current
        );
      }

      liveTimerRef.current =
        setInterval(() => {
          if (
            liveStartedAtRef.current
          ) {
            setLiveElapsed(
              Math.floor(
                (
                  Date.now() -
                  liveStartedAtRef.current
                ) / 1000
              )
            );
          }
        }, 250);

      startNextLiveChunk(stream);
    } catch (err) {
      console.error(
        "Microphone permission failed:",
        err
      );

      setLiveError(
        "Microphone access was blocked. Allow microphone permission in the browser and try again."
      );
    }
  }

  async function stopLiveAnalysis() {
    if (liveStoppingRef.current) {
      return;
    }

    liveStoppingRef.current = true;
    setLiveFinalizing(true);

    const sessionDuration =
      liveStartedAtRef.current != null
        ? Math.max(
            0,
            Math.round(
              (Date.now() - liveStartedAtRef.current) / 1000
            )
          )
        : liveElapsed;

    // Stop capture immediately so STOP still feels instant.
    liveActiveRef.current = false;
    setLiveActive(false);

    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }

    const recorder = liveRecorderRef.current;

    if (recorder) {
      // Do not create a new partial chunk after STOP.
      recorder.onstop = null;
      recorder.ondataavailable = null;

      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          // Recorder may already be becoming inactive.
        }
      }
    }

    liveRecorderRef.current = null;

    liveStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    liveStreamRef.current = null;

    const completedSessionId =
      liveSessionIdRef.current;

    try {
      // Give already-submitted Layer 1 requests a short chance to finish.
      // They are now fast because ECAPA no longer blocks /live-analyze.
      const pendingAtStop = [
        ...livePendingRequestsRef.current,
      ];

      if (pendingAtStop.length > 0) {
        await Promise.race([
          Promise.allSettled(pendingAtStop),
          new Promise<void>((resolve) =>
            window.setTimeout(resolve, 3500)
          ),
        ]);
      }

      // Ask the backend for the authoritative Layer 2 result.
      // This endpoint waits briefly for the one background ECAPA job.
      let finalizedIdentity = {
        ...liveIdentityEvidenceRef.current,
      };

      if (completedSessionId) {
        try {
          const response = await fetch(
            `${API_BASE}/live-session/${encodeURIComponent(
              completedSessionId
            )}/finalize`,
            { method: "POST" }
          );

          if (response.ok) {
            const data =
              (await response.json()) as LiveFinalizeResult;

            const bestMatch =
              data.trust_circle?.best_match;

            if (bestMatch) {
              finalizedIdentity = {
                identity:
                  bestMatch.identity ?? null,
                similarityPercent:
                  Math.round(
                    (bestMatch.similarity_score ?? 0) *
                      100
                  ),
                trustedMatch:
                  bestMatch.same_speaker === true,
              };

              liveIdentityEvidenceRef.current =
                finalizedIdentity;

              // Keep the purple Layer 2 Trust Circle card synchronized with
              // the authoritative identity returned during STOP/finalization.
              setLiveCurrent((previous) => {
                if (!previous) {
                  return previous;
                }

                return {
                  ...previous,
                  live_identity: {
                    ...(previous.live_identity ?? {
                      status: "VERIFIED",
                      speech_collected_seconds:
                        data.speech_collected_seconds ?? 0,
                      minimum_speech_seconds: 8,
                      trust_circle: null,
                      verification_in_progress: false,
                    }),
                    status: "VERIFIED",
                    speech_collected_seconds:
                      data.speech_collected_seconds ??
                      previous.live_identity?.speech_collected_seconds ??
                      0,
                    trust_circle:
                      data.trust_circle ?? null,
                    verification_in_progress: false,
                  },
                };
              });
            }
          }
        } catch (error) {
          console.warn(
            "Live session finalization could not retrieve Trust Circle result:",
            error
          );
        }
      }

      // Freeze one authoritative frontend snapshot AFTER the backend
      // finalization attempt. Report and timeline use this exact same set.
      const completedChunks = [
        ...liveTimelineRef.current,
      ]
        .sort(
          (a, b) =>
            a.chunk_index - b.chunk_index
        )
        .slice(-30);

      liveTimelineRef.current =
        completedChunks;

      setLiveTimeline(completedChunks);

      const finalSummary =
        buildLiveSessionSummary(
          completedChunks,
          sessionDuration,
          finalizedIdentity
        );

      setLiveSummary(finalSummary);

      // Only now abort any request that exceeded the bounded wait.
      for (
        const controller of
        liveAbortControllersRef.current
      ) {
        try {
          controller.abort();
        } catch {
          // Ignore already-settled controllers.
        }
      }

      liveAbortControllersRef.current.clear();

    } finally {
      // Delete temporary backend audio/session memory only AFTER the
      // final Trust Circle result has been requested and the report built.
      if (completedSessionId) {
        void fetch(
          `${API_BASE}/live-session/${encodeURIComponent(
            completedSessionId
          )}`,
          { method: "DELETE" }
        ).catch(() => undefined);
      }

      liveSessionIdRef.current = null;
      setLiveProcessing(0);
      setLiveFinalizing(false);
      liveStoppingRef.current = false;
    }
  }

  async function analyzeAudio() {
    if (!file) {
      setError(
        "Please select an audio file first."
      );
      return;
    }

    if (
      identityMode === "specific" &&
      trustedIdentities.length > 0 &&
      !claimedIdentity
    ) {
      setError(
        "Select the claimed identity you want AIA to verify."
      );
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    setShowTechnicalDetails(false);

    try {
      const formData = new FormData();

      formData.append("file", file);

      if (
        identityMode === "specific" &&
        claimedIdentity
      ) {
        formData.append(
          "claimed_identity",
          claimedIdentity
        );
      }

      const response = await fetch(
        `${API_BASE}/analyze-audio`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Audio analysis failed."
        );
      }

      console.log("AIA result:", data);

      setResult(data);
      await loadAnalysisHistory();
      await loadAlertsAndEvents();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "Something went wrong."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const realPercent =
    result?.voice_authenticity
      .real_probability != null
      ? Math.round(
          result.voice_authenticity
            .real_probability * 100
        )
      : 0;

  const fakePercent =
    result?.voice_authenticity
      .fake_probability != null
      ? Math.round(
          result.voice_authenticity
            .fake_probability * 100
        )
      : 0;

  const speakerSimilarity =
    result?.speaker_verification
      ?.similarity_score ??
    result?.speaker_verification
      ?.similarity ??
    null;

  const speakerMatched =
    result?.speaker_verification
      ?.same_speaker ??
    result?.speaker_verification
      ?.match ??
    false;

  const speakerIdentity =
    result?.speaker_verification
      ?.identity ??
    result?.speaker_verification
      ?.claimed_identity ??
    claimedIdentity;

  const trustCircle =
    result?.trust_circle_search ?? null;

  const bestTrustMatch =
    trustCircle?.best_match ?? null;

  const rankedMatches =
    trustCircle?.matches ?? [];

  const automaticImpersonation =
    result?.risk_analysis.automatic_impersonation ??
    false;

  const suspectedIdentity =
    automaticImpersonation
      ? result?.risk_analysis.suspected_identity ??
        bestTrustMatch?.identity ??
        null
      : null;

  const timeline =
    result?.audio_integrity_timeline ?? null;

  const fusion =
    result?.evidence_fusion ?? null;

  const robustness =
    result?.robustness_analysis ?? null;

  const finalClassification =
    fusion?.classification ??
    fusion?.final_classification ??
    fusion?.verdict ??
    result?.risk_analysis.classification ??
    "INCONCLUSIVE";

  const finalRiskLevel =
    fusion?.risk_level ??
    result?.risk_analysis.risk_level ??
    "UNKNOWN";

  const finalConfidence =
    fusion?.confidence ?? "NOT REPORTED";

  const finalRecommendation =
    fusion?.recommendation ??
    result?.recommendation ??
    "Review the available evidence before making a decision.";

  const trustedIdentityMatch =
    fusion?.trusted_identity_match ??
    (bestTrustMatch?.same_speaker
      ? bestTrustMatch.identity
      : null);

  const identitySimilarity =
    fusion?.identity_similarity ??
    (bestTrustMatch?.same_speaker
      ? bestTrustMatch.similarity_score
      : null);

  const fusionReasons =
    Array.isArray(fusion?.reasons)
      ? fusion.reasons
      : [];

  const evidenceEntries =
    fusion?.evidence_matrix &&
    typeof fusion.evidence_matrix === "object"
      ? Object.entries(fusion.evidence_matrix)
      : [];

  const assessmentTone =
    finalRiskLevel.toUpperCase() === "CRITICAL"
      ? "border-red-500/30 bg-red-500/10"
      : finalRiskLevel.toUpperCase() === "HIGH"
      ? "border-orange-500/30 bg-orange-500/10"
      : finalRiskLevel.toUpperCase() === "MEDIUM"
      ? "border-amber-500/25 bg-amber-500/10"
      : finalRiskLevel.toUpperCase() === "LOW"
      ? "border-emerald-500/25 bg-emerald-500/10"
      : "border-white/10 bg-zinc-950";


  const recentLiveChunks =
    liveTimeline
      .filter(
        (chunk) =>
          chunk.risk_level !== "NO SPEECH" &&
          chunk.speech_detected !== false
      )
      .slice(-3);

  const recentWarningCount =
    recentLiveChunks.filter(
      (chunk) =>
        chunk.risk_level === "SUSPICIOUS" ||
        chunk.risk_level === "HIGH"
    ).length;

  const livePersistentWarning =
    liveActive &&
    recentLiveChunks.length >= 3 &&
    recentWarningCount >= 2;


  return (
    <main className="min-h-screen bg-black text-white">
      {/* NAVBAR */}
      <nav className="border-b border-white/10 bg-black/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-[0.25em]">
              AIA
            </h1>

            <p className="mt-1 text-xs text-zinc-500">
              Audio Integrity Analyzer
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                if (showLive && liveActiveRef.current) {
                  void stopLiveAnalysis();
                }

                setShowLive(!showLive);
                setShowHistory(false);
                setShowAlerts(false);
                setShowPrivacy(false);
                setLiveError("");
              }}
              className={`rounded-lg border px-3 py-2 text-xs transition ${
                liveActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : showLive
                  ? "border-white/20 bg-white/5 text-white"
                  : "border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {liveActive ? "● LIVE" : "LIVE"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (liveActiveRef.current) {
                  void stopLiveAnalysis();
                }

                setShowHistory(!showHistory);
                setShowLive(false);
                setShowAlerts(false);
                setShowPrivacy(false);
                setHistoryMessage("");
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5"
            >
              HISTORY
              {analysisHistory.length > 0
                ? ` (${analysisHistory.length})`
                : ""}
            </button>

            <button
              type="button"
              onClick={() => {
                if (liveActiveRef.current) {
                  void stopLiveAnalysis();
                }

                setShowAlerts(!showAlerts);
                setShowHistory(false);
                setShowPrivacy(false);
                setShowLive(false);
                setAlertsMessage("");
                setEventsMessage("");
              }}
              className={`rounded-lg border px-3 py-2 text-xs transition ${
                alerts.length > 0
                  ? "border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                  : "border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              ALERTS
              {alerts.length > 0
                ? ` (${alerts.length})`
                : ""}
            </button>

            <button
              type="button"
              onClick={() => {
                if (liveActiveRef.current) {
                  void stopLiveAnalysis();
                }

                setShowPrivacy(!showPrivacy);
                setShowHistory(false);
                setShowAlerts(false);
                setShowLive(false);
                setPrivacyMessage("");
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5"
            >
              PRIVACY
            </button>

            <div className="hidden items-center gap-2 text-xs text-zinc-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              SYSTEM ONLINE
            </div>
          </div>
        </div>
      </nav>

      {showLive && (
        <section className="border-b border-white/10 bg-zinc-950/70">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      liveActive
                        ? "animate-pulse bg-emerald-400"
                        : "bg-zinc-700"
                    }`}
                  />
                  <p className="text-xs tracking-[0.3em] text-zinc-500">
                    LIVE ANALYSIS — LAYER 1
                  </p>
                </div>

                <h2 className="mt-3 text-3xl font-semibold">
                  Near-real-time voice detection
                </h2>

                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">
                  Your microphone is checked in short 4-second chunks. Layer 1 checks
                  synthetic-voice evidence. Layer 2 temporarily collects usable
                  speech and checks it against your Trust Circle after enough
                  speech is available. Live audio is not saved to History.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                {!liveActive ? (
                  <button
                    type="button"
                    onClick={startLiveAnalysis}
                    className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
                  >
                    START LIVE ANALYSIS
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void stopLiveAnalysis()}
                    className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
                  >
                    ■ STOP ANALYSIS
                  </button>
                )}
              </div>
            </div>

            {liveError && (
              <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                {liveError}
              </div>
            )}

            {livePersistentWarning && (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xl">
                    ⚠
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-red-200">
                      SUSTAINED SYNTHETIC-VOICE WARNING
                    </p>
                    <p className="mt-2 text-sm leading-6 text-red-100/70">
                      Suspicious evidence appeared in at least two of the latest three audio chunks.
                      AIA is treating this as a persistent pattern instead of reacting to one isolated spike.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black p-6">
                <p className="text-[10px] tracking-[0.2em] text-zinc-600">
                  STATUS
                </p>
                <p className="mt-3 text-xl font-semibold">
                  {liveActive
                    ? "LISTENING"
                    : "READY"}
                </p>
                <p className="mt-2 text-xs text-zinc-600">
                  {liveActive
                    ? `Session ${formatLiveTime(liveElapsed)}`
                    : "Start when you are ready."}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black p-6">
                <p className="text-[10px] tracking-[0.2em] text-zinc-600">
                  CURRENT SYNTHETIC RISK
                </p>
                <p className="mt-3 text-4xl font-semibold">
                  {liveCurrent
                    ? liveCurrent.risk_level === "NO SPEECH"
                      ? "—"
                      : `${Math.round(liveCurrent.synthetic_score)}%`
                    : "—"}
                </p>
                <p
                  className={`mt-2 text-xs font-medium ${
                    liveCurrent?.risk_level === "HIGH"
                      ? "text-red-300"
                      : liveCurrent?.risk_level === "SUSPICIOUS"
                      ? "text-amber-300"
                      : liveCurrent?.risk_level === "SAFE"
                      ? "text-emerald-300"
                      : liveCurrent?.risk_level === "NO SPEECH"
                      ? "text-zinc-400"
                      : "text-zinc-600"
                  }`}
                >
                  {liveCurrent
                    ? liveCurrent.risk_level
                    : "WAITING FOR AUDIO"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black p-6">
                <p className="text-[10px] tracking-[0.2em] text-zinc-600">
                  CHUNKS ANALYZED
                </p>
                <p className="mt-3 text-4xl font-semibold">
                  {liveTimeline.length}
                </p>
                <p className="mt-2 text-xs text-zinc-600">
                  {liveProcessing > 0
                    ? `${liveProcessing} chunk${liveProcessing === 1 ? "" : "s"} analyzing...`
                    : liveActive
                    ? "Listening for the next chunk..."
                    : "No active processing"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs tracking-[0.2em] text-zinc-500">
                    LIVE RISK METER
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    {liveCurrent?.classification ??
                      "The first result appears after about four seconds."}
                  </p>
                </div>

                {liveCurrent && (
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      liveCurrent.risk_level === "HIGH"
                        ? "border-red-500/30 bg-red-500/10 text-red-200"
                        : liveCurrent.risk_level === "SUSPICIOUS"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    }`}
                  >
                    {liveCurrent.risk_level}
                  </span>
                )}
              </div>

              <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-white transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        liveCurrent?.risk_level === "NO SPEECH"
                          ? 0
                          : liveCurrent?.synthetic_score ?? 0
                      )
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 flex justify-between text-[10px] tracking-[0.14em] text-zinc-700">
                <span>0% GENUINE-SIDE</span>
                <span>100% SYNTHETIC-SIDE</span>
              </div>
            </div>

            {liveCurrent?.live_identity && (
              <div className="mt-4 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs tracking-[0.2em] text-violet-300">
                      LIVE TRUST CIRCLE — LAYER 2
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">
                      {liveCurrent.live_identity.status === "VERIFIED"
                        ? "Speaker verification active"
                        : "Collecting speaker evidence"}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-500">
                      AIA waits for enough real speech before checking identity. Similarity is evidence, not an identity probability.
                    </p>
                  </div>

                  <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
                    {liveCurrent.live_identity.status ?? "COLLECTING"}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] tracking-[0.16em] text-zinc-600">SPEECH COLLECTED</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {Math.round(liveCurrent.live_identity.speech_collected_seconds ?? 0)}s
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      First check at {Math.round(liveCurrent.live_identity.minimum_speech_seconds ?? 8)}s
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] tracking-[0.16em] text-zinc-600">CLOSEST TRUSTED IDENTITY</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {liveCurrent.live_identity.trust_circle?.best_match?.identity ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {liveCurrent.live_identity.trust_circle?.best_match
                        ? "Closest enrolled voice"
                        : "Waiting for Trust Circle check"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] tracking-[0.16em] text-zinc-600">SPEAKER SIMILARITY</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {liveCurrent.live_identity.trust_circle?.best_match
                        ? `${Math.round((liveCurrent.live_identity.trust_circle.best_match.similarity_score ?? 0) * 100)}%`
                        : "—"}
                    </p>
                    <p className={`mt-1 text-xs ${
                      liveCurrent.live_identity.trust_circle?.best_match?.same_speaker
                        ? "text-emerald-300"
                        : "text-zinc-600"
                    }`}>
                      {liveCurrent.live_identity.trust_circle?.best_match?.same_speaker
                        ? "Possible trusted-speaker match"
                        : "No trusted match confirmed"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!liveActive && liveSummary && (
              <div className={`mt-5 rounded-2xl border p-6 ${
                liveSummary.fusion_risk_level === "HIGH"
                  ? "border-red-500/30 bg-red-500/10"
                  : liveSummary.fusion_risk_level === "MEDIUM"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-emerald-500/25 bg-emerald-500/10"
              }`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs tracking-[0.24em] text-zinc-500">
                      AIA LIVE SECURITY ASSESSMENT — LAYER 2C
                    </p>
                    <h3 className="mt-3 text-2xl font-semibold">
                      {liveSummary.fusion_assessment}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-400">
                      Overall risk: {liveSummary.fusion_risk_level}
                    </p>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
                      {liveSummary.fusion_reason}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                      <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                        DURATION
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {formatLiveTime(liveSummary.duration_seconds)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                      <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                        AVG SYNTHETIC
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {liveSummary.average_synthetic_percent}%
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                      <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                        PEAK
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {liveSummary.peak_synthetic_percent}%
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-5">
                  <p className="text-[10px] tracking-[0.18em] text-zinc-600">
                    RECOMMENDED ACTION
                  </p>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    {liveSummary.fusion_recommendation}
                  </p>

                  {(liveSummary.trusted_identity ||
                    liveSummary.speaker_similarity_percent != null) && (
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      {liveSummary.trusted_identity && (
                        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-violet-200">
                          Closest identity: {liveSummary.trusted_identity}
                        </span>
                      )}
                      {liveSummary.speaker_similarity_percent != null && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-zinc-300">
                          Speaker similarity: {liveSummary.speaker_similarity_percent}%
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-zinc-400">
                        Similarity is evidence, not identity probability
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <button
                    type="button"
                    onClick={() =>
                      setShowReportBreakdown(
                        (current) => !current
                      )
                    }
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.03]"
                    aria-expanded={showReportBreakdown}
                  >
                    <div>
                      <p className="text-[10px] tracking-[0.18em] text-zinc-600">
                        HOW AIA REACHED THIS RESULT
                      </p>
                      <p className="mt-2 text-sm text-zinc-400">
                        View the speech and segment breakdown used for this session.
                      </p>
                    </div>

                    <span className="text-xl text-zinc-400">
                      {showReportBreakdown ? "⌃" : "⌄"}
                    </span>
                  </button>

                  {showReportBreakdown && (
                    <div className="border-t border-white/10 px-5 pb-5">
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                          <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                            LAYER 1 — VOICE INTEGRITY
                          </p>
                          <p className="mt-2 text-lg font-semibold">
                            {liveSummary.assessment}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            Average synthetic {liveSummary.average_synthetic_percent}% · Peak {liveSummary.peak_synthetic_percent}%
                          </p>
                        </div>

                        <div className="rounded-xl border border-violet-500/15 bg-black/40 p-4">
                          <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                            LAYER 2 — TRUST CIRCLE
                          </p>
                          <p className="mt-2 text-lg font-semibold">
                            {liveSummary.trusted_identity ?? "No trusted match"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            {liveSummary.speaker_similarity_percent != null
                              ? `${liveSummary.speaker_similarity_percent}% speaker similarity`
                              : "No completed speaker-verification evidence"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4">
                        <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                          LAYER 2C — COMBINED INTERPRETATION
                        </p>
                        <p className="mt-2 text-sm leading-6 text-zinc-300">
                          {liveSummary.fusion_reason}
                        </p>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            Segments analyzed
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {liveSummary.chunks_analyzed}
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Short audio windows checked during the session.
                          </p>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            Usable speech
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {liveSummary.usable_speech_chunks}
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Segments with enough speech to evaluate.
                          </p>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            No speech
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-zinc-300">
                            {liveSummary.no_speech_chunks}
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Ignored in the session risk calculation.
                          </p>
                        </div>

                        <div className="rounded-xl border border-emerald-500/15 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            Safe segments
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-emerald-300">
                            {liveSummary.safe_chunks}
                          </p>
                        </div>

                        <div className="rounded-xl border border-amber-500/15 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            Suspicious segments
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-amber-300">
                            {liveSummary.suspicious_chunks}
                          </p>
                        </div>

                        <div className="rounded-xl border border-red-500/15 bg-black/40 p-4">
                          <p className="text-xs text-zinc-500">
                            High-risk segments
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-red-300">
                            {liveSummary.high_chunks}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
                        <p className="text-xs leading-5 text-zinc-500">
                          These details are supporting evidence only. The main result above is designed for normal users, while this breakdown is available for users who want to inspect how the session was evaluated.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] tracking-[0.18em] text-zinc-600">
                    SESSION INTERPRETATION
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {liveSummary.persistent_warning
                      ? "A sustained suspicious pattern appeared across multiple nearby chunks."
                      : "No sustained suspicious pattern was found across nearby chunks."}
                  </p>

                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    {liveSummary.recommendation}
                  </p>
                </div>
              </div>
            )}

            {liveActive ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black p-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs tracking-[0.2em] text-zinc-500">
                      LIVE TIMELINE
                    </p>
                    <p className="mt-2 text-sm text-zinc-600">
                      Latest 30 analyzed chunks.
                    </p>
                  </div>
                </div>

                {liveTimeline.length === 0 ? (
                  <div className="mt-5 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-600">
                    No live chunks analyzed yet.
                  </div>
                ) : (
                  <div className="mt-5 space-y-2">
                    {[...liveTimeline]
                      .reverse()
                      .map((item) => (
                        <div
                          key={`${item.chunk_index}-${item.timestamp}`}
                          className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="text-sm font-medium text-zinc-300">
                              {formatLiveTime(item.start_seconds)}
                              {" – "}
                              {formatLiveTime(item.end_seconds)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-600">
                              Chunk #{item.chunk_index}
                            </p>
                            {item.noise_robustness_experiment &&
                              !item.noise_robustness_experiment.skipped && (
                              <p className="mt-2 text-xs text-sky-300/70">
                                Original {Math.round(
                                  item.noise_robustness_experiment.original_synthetic_score ?? 0
                                )}% · Cleaned {Math.round(
                                  item.noise_robustness_experiment.cleaned_synthetic_score ?? 0
                                )}%
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-4">
                            <p className="text-lg font-semibold">
                              {item.risk_level === "NO SPEECH"
                                ? "—"
                                : `${Math.round(item.synthetic_score)}%`}
                            </p>
                            <span
                              className={`min-w-24 rounded-full border px-3 py-1 text-center text-xs ${
                                item.risk_level === "HIGH"
                                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                                  : item.risk_level === "SUSPICIOUS"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                                  : item.risk_level === "NO SPEECH"
                                  ? "border-white/10 bg-white/5 text-zinc-400"
                                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              }`}
                            >
                              {item.risk_level}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : liveSummary ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black">
                <button
                  type="button"
                  onClick={() =>
                    setShowCompletedChunks(
                      (current) => !current
                    )
                  }
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-white/[0.03]"
                  aria-expanded={showCompletedChunks}
                >
                  <div>
                    <p className="text-xs tracking-[0.2em] text-zinc-500">
                      ANALYSIS SECONDS
                    </p>
                    <p className="mt-2 text-sm text-zinc-400">
                      {liveTimeline.length} analyzed chunks · click to {showCompletedChunks ? "hide" : "view"} the full timeline
                    </p>
                  </div>

                  <span className="text-xl text-zinc-400">
                    {showCompletedChunks ? "⌃" : "⌄"}
                  </span>
                </button>

                {showCompletedChunks && (
                  <div className="border-t border-white/10 px-6 pb-6">
                    {liveTimeline.length === 0 ? (
                      <div className="mt-5 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-600">
                        No analyzed chunks are available.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-2">
                        {[...liveTimeline]
                          .reverse()
                          .map((item) => (
                            <div
                              key={`${item.chunk_index}-${item.timestamp}`}
                              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="text-sm font-medium text-zinc-300">
                                  {formatLiveTime(item.start_seconds)}
                                  {" – "}
                                  {formatLiveTime(item.end_seconds)}
                                </p>
                                <p className="mt-1 text-xs text-zinc-600">
                                  Chunk #{item.chunk_index}
                                </p>
                                {item.noise_robustness_experiment &&
                                  !item.noise_robustness_experiment.skipped && (
                                  <p className="mt-2 text-xs text-sky-300/70">
                                    Original {Math.round(
                                      item.noise_robustness_experiment.original_synthetic_score ?? 0
                                    )}% · Cleaned {Math.round(
                                      item.noise_robustness_experiment.cleaned_synthetic_score ?? 0
                                    )}%
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-4">
                                <p className="text-lg font-semibold">
                                  {item.risk_level === "NO SPEECH"
                                ? "—"
                                : `${Math.round(item.synthetic_score)}%`}
                                </p>
                                <span
                                  className={`min-w-24 rounded-full border px-3 py-1 text-center text-xs ${
                                    item.risk_level === "HIGH"
                                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                                      : item.risk_level === "SUSPICIOUS"
                                      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                  }`}
                                >
                                  {item.risk_level}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black p-6">
                <p className="text-xs tracking-[0.2em] text-zinc-500">
                  LIVE TIMELINE
                </p>
                <p className="mt-2 text-sm text-zinc-600">
                  Start live analysis to view audio chunks here.
                </p>
              </div>
            )}

            <p className="mt-5 text-xs leading-5 text-zinc-600">
              Layer 1 verifies the live detection pipeline only. It does not
              yet claim full call-level identity verification or final forensic
              certainty from a single short chunk.
            </p>
          </div>
        </section>
      )}

      {showHistory && (
        <section className="border-b border-white/10 bg-zinc-950/70">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs tracking-[0.3em] text-zinc-500">
                  ANALYSIS HISTORY
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Previous voice checks
                </h2>
                <p className="mt-2 text-sm text-zinc-500">
                  Summary metadata only. AIA does not keep the uploaded analysis audio here.
                </p>
              </div>

              <button
                type="button"
                onClick={clearAnalysisHistory}
                disabled={analysisHistory.length === 0}
                className="rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                CLEAR HISTORY
              </button>
            </div>

            {historyMessage && (
              <p className="mt-4 text-sm text-zinc-400">
                {historyMessage}
              </p>
            )}

            {historyLoading ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                Loading analysis history...
              </div>
            ) : analysisHistory.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                No analyses have been saved yet.
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {analysisHistory.map((item) => (
                  <HistoryCard
                    key={item.id}
                    item={item}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {showAlerts && (
        <section className="border-b border-white/10 bg-zinc-950/70">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs tracking-[0.3em] text-zinc-500">
                  ALERTING + EVENT LOG
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Voice security activity
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  HIGH and CRITICAL assessments create active alerts.
                  Every completed analysis is also recorded in the local security event log.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black px-4 py-3">
                <p className="text-[10px] tracking-[0.16em] text-zinc-600">
                  ACTIVE ALERTS
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {alerts.length}
                </p>
              </div>
            </div>

            {alertsLoading ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                Loading alerts and security events...
              </div>
            ) : (
              <>
                <div className="mt-7">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs tracking-[0.22em] text-zinc-500">
                        ACTIVE ALERTS
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Generated only for HIGH or CRITICAL final risk.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={clearAlerts}
                      disabled={alerts.length === 0}
                      className="rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      CLEAR ALERTS
                    </button>
                  </div>

                  {alertsMessage && (
                    <p className="mt-3 text-sm text-zinc-400">
                      {alertsMessage}
                    </p>
                  )}

                  {alerts.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                      No active HIGH or CRITICAL alerts.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {alerts.map((alert) => (
                        <AlertCard
                          key={alert.id}
                          alert={alert}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-8 border-t border-white/10 pt-7">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs tracking-[0.22em] text-zinc-500">
                        SECURITY EVENT LOG
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Recent analysis events, including low-risk checks.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={clearSecurityEvents}
                      disabled={securityEvents.length === 0}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      CLEAR EVENT LOG
                    </button>
                  </div>

                  {eventsMessage && (
                    <p className="mt-3 text-sm text-zinc-400">
                      {eventsMessage}
                    </p>
                  )}

                  {securityEvents.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                      No security events recorded yet.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      {securityEvents.slice(0, 25).map((event) => (
                        <SecurityEventCard
                          key={event.id}
                          event={event}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {showPrivacy && (
        <section className="border-b border-white/10 bg-zinc-950/70">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div>
              <p className="text-xs tracking-[0.3em] text-zinc-500">
                PRIVACY
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                Your Data & Privacy
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                AIA protects your voice data. Uploaded audio is deleted after checking.
                Only the result is saved for the number of days you choose.
              </p>
            </div>

            {privacyLoading ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black p-5 text-sm text-zinc-500">
                Loading privacy settings...
              </div>
            ) : (
              <>
                <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <PrivacyStatusCard
                    label="Uploaded audio"
                    value="DELETED AFTER CHECKING"
                    note="Your uploaded audio is removed after AIA finishes checking it."
                  />
                  <PrivacyStatusCard
                    label="What we save"
                    value="RESULTS ONLY"
                    note="AIA saves the check result, not the uploaded audio."
                  />
                  <PrivacyStatusCard
                    label="Keep results for"
                    value={`${privacySettings.metadata_retention_days} DAYS`}
                    note="Old saved results are removed after this time."
                  />
                  <PrivacyStatusCard
                    label="Trusted voices"
                    value="SAVED ON THIS DEVICE"
                    note="Voices you add to Trust Circle stay until you remove them."
                  />
                </div>

                <div className="mt-6 rounded-2xl border border-white/10 bg-black p-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <p className="text-xs tracking-[0.2em] text-zinc-500">
                        HOW LONG SHOULD RESULTS BE SAVED?
                      </p>
                      <select
                        value={privacySettings.metadata_retention_days}
                        onChange={(event) =>
                          setPrivacySettings((current) => ({
                            ...current,
                            metadata_retention_days: Number(event.target.value),
                          }))
                        }
                        className="mt-3 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none focus:border-white/30"
                      >
                        <option value={1}>1 day</option>
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                      </select>
                      <p className="mt-2 text-xs leading-5 text-zinc-600">
                        This applies to History, Alerts and the Event Log.
                      </p>
                    </div>

                    <div>
                      <p className="text-xs tracking-[0.2em] text-zinc-500">
                        SAVE AUDIO FILE NAMES?
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setPrivacySettings((current) => ({
                            ...current,
                            store_filenames: !current.store_filenames,
                          }))
                        }
                        className={`mt-3 w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                          privacySettings.store_filenames
                            ? "border-white/20 bg-white/5 text-white"
                            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                        }`}
                      >
                        {privacySettings.store_filenames
                          ? "YES — SAVE FILE NAMES"
                          : "NO — HIDE FILE NAMES"}
                      </button>
                      <p className="mt-2 text-xs leading-5 text-zinc-600">
                        This choice applies to new results. Old results stay unchanged.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4">
                    <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">
                      YOUR UPLOADED AUDIO IS NOT SAVED
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      AIA deletes uploaded audio after the check is complete.
                      Trusted voices you add to Trust Circle are kept until you remove them.
                    </p>
                  </div>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={savePrivacySettings}
                      disabled={privacySaving}
                      className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {privacySaving ? "SAVING..." : "SAVE SETTINGS"}
                    </button>

                    <button
                      type="button"
                      onClick={purgeExpiredMetadata}
                      className="rounded-xl border border-white/10 px-5 py-3 text-sm text-zinc-300 transition hover:bg-white/5"
                    >
                      DELETE OLD RESULTS NOW
                    </button>
                  </div>

                  {privacyMessage && (
                    <p className="mt-4 text-sm text-zinc-400">
                      {privacyMessage}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-6 py-16">
        {/* HERO */}
        <div className="text-center">
          <p className="text-xs font-medium tracking-[0.35em] text-zinc-500">
            VOICE INTEGRITY VERIFICATION
          </p>

          <h2 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">
            Detect synthetic voices
            <br />
            before trust becomes risk.
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
            Analyze suspicious audio for
            synthetic speech, speaker identity,
            possible voice impersonation and
            forensic audio characteristics.
          </p>
        </div>

        {/* AUDIO UPLOAD */}
        <div className="mx-auto mt-14 max-w-3xl rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
          <label
            htmlFor="audio-file"
            className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-black px-6 text-center transition hover:border-white/40"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl">
              🎙
            </div>

            <h3 className="mt-5 text-lg font-medium">
              Select audio evidence
            </h3>

            <p className="mt-2 text-sm text-zinc-500">
              MP3, WAV, M4A, FLAC or OGG
            </p>

            {file && (
              <div className="mt-5 max-w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-300">
                <span className="block max-w-xl truncate">
                  {file.name}
                </span>
              </div>
            )}

            <input
              id="audio-file"
              type="file"
              accept=".mp3,.wav,.m4a,.flac,.ogg,audio/*"
              className="hidden"
              onChange={(event) => {
                const selected =
                  event.target.files?.[0] ||
                  null;

                setFile(selected);
                setResult(null);
                setError("");
                setShowTechnicalDetails(false);
              }}
            />
          </label>

          {/* IDENTITY ANALYSIS MODE */}
          <div className="mt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs tracking-[0.25em] text-zinc-500">
                  IDENTITY ANALYSIS MODE
                </p>

                <p className="mt-1 text-xs leading-5 text-zinc-600">
                  Let AIA automatically search every trusted voice,
                  or verify one specific claimed identity.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowEnrollment(
                    !showEnrollment
                  )
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5"
              >
                + ENROLL IDENTITY
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setIdentityMode("automatic");
                  setResult(null);
                  setError("");
                }}
                className={`rounded-2xl border p-5 text-left transition ${
                  identityMode === "automatic"
                    ? "border-white/40 bg-white text-black"
                    : "border-white/10 bg-black text-white hover:border-white/20"
                }`}
              >
                <p className="text-sm font-semibold">
                  Automatic Trust Circle Search
                </p>
                <p className={`mt-2 text-xs leading-5 ${
                  identityMode === "automatic"
                    ? "text-zinc-700"
                    : "text-zinc-600"
                }`}>
                  AIA compares the suspicious voice against every enrolled trusted identity.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIdentityMode("specific");
                  setResult(null);
                  setError("");
                }}
                className={`rounded-2xl border p-5 text-left transition ${
                  identityMode === "specific"
                    ? "border-white/40 bg-white text-black"
                    : "border-white/10 bg-black text-white hover:border-white/20"
                }`}
              >
                <p className="text-sm font-semibold">
                  Verify Specific Identity
                </p>
                <p className={`mt-2 text-xs leading-5 ${
                  identityMode === "specific"
                    ? "text-zinc-700"
                    : "text-zinc-600"
                }`}>
                  Use this when a caller claims to be a particular trusted person.
                </p>
              </button>
            </div>

            {identityMode === "automatic" && (
              <div className="mt-4 rounded-xl border border-white/10 bg-black px-4 py-4">
                <p className="text-sm font-medium text-zinc-200">
                  Automatic search enabled
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {trustedIdentities.length > 0
                    ? `${trustedIdentities.length} trusted ${
                        trustedIdentities.length === 1
                          ? "identity"
                          : "identities"
                      } available for comparison.`
                    : "No trusted identities are enrolled yet."}
                </p>
              </div>
            )}

            {identityMode === "specific" && (
              <div className="mt-4">
                <p className="mb-2 text-xs tracking-[0.2em] text-zinc-600">
                  CLAIMED IDENTITY
                </p>

                <select
                  value={claimedIdentity}
                  onChange={(event) => {
                    setClaimedIdentity(
                      event.target.value
                    );
                    setResult(null);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-4 text-sm text-white outline-none transition focus:border-white/30"
                >
                  <option value="">
                    Select trusted identity
                  </option>

                  {trustedIdentities.map(
                    (item) => (
                      <option
                        key={item.identity}
                        value={item.identity}
                      >
                        {item.identity} ({item.sample_count} sample{item.sample_count === 1 ? "" : "s"})
                      </option>
                    )
                  )}
                </select>
              </div>
            )}
          </div>

          {/* ENROLLMENT PANEL */}
          {showEnrollment && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-xs tracking-[0.25em] text-zinc-500">
                TRUST CIRCLE ENROLLMENT
              </p>

              <h3 className="mt-2 text-lg font-medium">
                Create identity or add a voice sample
              </h3>

              <input
                type="text"
                value={newIdentity}
                onChange={(event) =>
                  setNewIdentity(
                    event.target.value
                  )
                }
                placeholder="New identity or existing identity name"
                className="mt-5 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-white/30"
              />

              <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-white/15 bg-zinc-950 p-5 text-center transition hover:border-white/30">
                <p className="text-sm text-zinc-300">
                  {enrollmentFile
                    ? enrollmentFile.name
                    : "Select reference voice sample"}
                </p>

                <p className="mt-1 text-xs text-zinc-600">
                  New name = create identity. Existing name = add another sample.
                </p>

                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.flac,.ogg,audio/*"
                  className="hidden"
                  onChange={(event) =>
                    setEnrollmentFile(
                      event.target.files?.[0] ||
                        null
                    )
                  }
                />
              </label>

              <button
                type="button"
                onClick={enrollIdentity}
                disabled={
                  enrolling ||
                  !newIdentity.trim() ||
                  !enrollmentFile
                }
                className="mt-4 w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {enrolling
                  ? "ENROLLING..."
                  : "SAVE VOICE SAMPLE"}
              </button>

              {identityMessage && (
                <p className="mt-4 text-sm text-zinc-400">
                  {identityMessage}
                </p>
              )}

              {trustedIdentities.length >
                0 && (
                <div className="mt-6">
                  <p className="mb-3 text-xs tracking-[0.2em] text-zinc-600">
                    ENROLLED IDENTITIES
                  </p>

                  <div className="space-y-2">
                    {trustedIdentities.map(
                      (item) => (
                        <div
                          key={item.identity}
                          className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-4"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-medium text-zinc-200">
                                {item.identity}
                              </p>

                              <p className="mt-1 text-xs text-zinc-600">
                                {item.sample_count} voice sample{item.sample_count === 1 ? "" : "s"}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewIdentity(
                                    item.identity
                                  );
                                  setEnrollmentFile(
                                    null
                                  );
                                  setIdentityMessage(
                                    `Add another reference sample for ${item.identity}.`
                                  );
                                }}
                                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5"
                              >
                                + ADD SAMPLE
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  deleteIdentity(
                                    item.identity
                                  )
                                }
                                className="rounded-lg border border-red-500/10 px-3 py-2 text-xs text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300"
                              >
                                DELETE
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ANALYZE BUTTON */}
          <button
            onClick={analyzeAudio}
            disabled={
              loading ||
              !file ||
              (identityMode === "specific" &&
                trustedIdentities.length > 0 &&
                !claimedIdentity)
            }
            className="mt-5 w-full rounded-xl bg-white px-5 py-4 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {loading
              ? identityMode === "automatic"
                ? "SEARCHING TRUST CIRCLE..."
                : "VERIFYING VOICE..."
              : identityMode === "automatic"
                ? "ANALYZE + SEARCH TRUST CIRCLE"
                : "ANALYZE + VERIFY IDENTITY"}
          </button>

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* LOADING */}
        {loading && (
          <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-zinc-950 p-6">
            <p className="text-xs tracking-[0.3em] text-zinc-500">
              ANALYSIS IN PROGRESS
            </p>

            <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-900">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-white" />
            </div>

            <p className="mt-4 text-sm text-zinc-400">
              Normalizing audio, checking
              synthetic voice characteristics
              and evaluating forensic signals...
            </p>
          </div>
        )}

        {/* RESULTS */}
        {result && !loading && (
          <section className="mx-auto mt-10 max-w-5xl">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs tracking-[0.3em] text-zinc-500">
                  ANALYSIS REPORT
                </p>

                <h3 className="mt-2 text-2xl font-semibold">
                  Voice integrity result
                </h3>
              </div>

              <p className="max-w-xs truncate text-xs text-zinc-500">
                {result.filename}
              </p>
            </div>

            {(finalRiskLevel.toUpperCase() === "HIGH" ||
              finalRiskLevel.toUpperCase() === "CRITICAL") && (
              <div className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.22em] text-red-300">
                      SECURITY ALERT
                    </p>
                    <p className="mt-2 text-lg font-semibold text-red-100">
                      {finalClassification}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-red-200/70">
                      AIA classified this recording as {finalRiskLevel.toUpperCase()} risk.
                      Review the recommendation before taking any sensitive action.
                    </p>
                  </div>

                  <span className="w-fit rounded-full border border-red-500/20 bg-black/30 px-3 py-1.5 text-xs font-semibold text-red-200">
                    {finalRiskLevel.toUpperCase()}
                  </span>
                </div>
              </div>
            )}

            {/* AIA FINAL ASSESSMENT — SIMPLE VIEW */}
            <div className={`mb-4 rounded-3xl border p-6 md:p-7 ${assessmentTone}`}>
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">
                    AIA FINAL ASSESSMENT
                  </p>

                  <h4 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    {finalClassification}
                  </h4>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold">
                      RISK: {finalRiskLevel}
                    </span>

                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold">
                      CONFIDENCE: {finalConfidence}
                    </span>
                  </div>

                  {fusionReasons.length > 0 && (
                    <div className="mt-5 space-y-2">
                      {fusionReasons.slice(0, 2).map((reason, index) => (
                        <p
                          key={`${reason}-${index}`}
                          className="flex gap-2 text-sm leading-6 text-zinc-300"
                        >
                          <span className="text-zinc-500">•</span>
                          <span>{reason}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="min-w-44 rounded-2xl border border-white/10 bg-black/30 px-5 py-4">
                  <p className="text-xs text-zinc-500">
                    Synthetic score
                  </p>
                  <p className="mt-1 text-3xl font-semibold">
                    {fakePercent}%
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SimpleEvidence
                  label="Synthetic"
                  value={`${fakePercent}%`}
                />

                <SimpleEvidence
                  label="Trusted match"
                  value={trustedIdentityMatch ?? "None"}
                />

                <SimpleEvidence
                  label="Timeline"
                  value={
                    timeline
                      ? timeline.synthetic_segments > 0
                        ? `${timeline.synthetic_segments} synthetic`
                        : timeline.suspicious_segments > 0
                        ? `${timeline.suspicious_segments} suspicious`
                        : "No synthetic segments"
                      : "N/A"
                  }
                />

                <SimpleEvidence
                  label="Robustness"
                  value={
                    typeof robustness?.stability === "string"
                      ? robustness.stability.toUpperCase()
                      : "N/A"
                  }
                />
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5">
                <p className="text-xs tracking-[0.2em] text-zinc-500">
                  RECOMMENDATION
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-200">
                  {finalRecommendation}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowTechnicalDetails(
                    !showTechnicalDetails
                  )
                }
                className="mt-5 w-full rounded-xl border border-white/15 bg-black/30 px-5 py-3 text-xs font-semibold tracking-[0.16em] text-zinc-200 transition hover:border-white/30 hover:bg-white/5"
              >
                {showTechnicalDetails
                  ? "HIDE TECHNICAL DETAILS"
                  : "VIEW TECHNICAL DETAILS"}
              </button>
            </div>

            {showTechnicalDetails && (
              <div className="mt-4">
            {/* MAIN SCORES */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
                <p className="text-xs tracking-widest text-zinc-500">
                  GENUINE
                </p>

                <p className="mt-3 text-4xl font-semibold">
                  {realPercent}%
                </p>

                <div className="mt-6 h-2 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-white"
                    style={{
                      width: `${realPercent}%`,
                    }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
                <p className="text-xs tracking-widest text-zinc-500">
                  SYNTHETIC
                </p>

                <p className="mt-3 text-4xl font-semibold">
                  {fakePercent}%
                </p>

                <div className="mt-6 h-2 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-white"
                    style={{
                      width: `${fakePercent}%`,
                    }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
  <p className="text-xs tracking-widest text-zinc-500">
    FUSION RISK
  </p>

  <p className="mt-3 text-4xl font-semibold">
    {finalRiskLevel}
  </p>

  <p className="mt-5 text-sm text-zinc-500">
    Confidence: {finalConfidence}
  </p>
</div>
            </div>

            {/* AUTOMATIC TRUST CIRCLE SEARCH */}
            {trustCircle && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950 p-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs tracking-[0.3em] text-zinc-500">
                      AUTOMATIC TRUST CIRCLE SEARCH
                    </p>

                    <h4 className="mt-3 text-2xl font-semibold">
                      {bestTrustMatch
                        ? `Strongest trusted match: ${bestTrustMatch.identity}`
                        : trustCircle.status === "empty"
                          ? "Trust Circle is empty"
                          : "No trusted speaker match found"}
                    </h4>

                    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                      AIA compared this recording against all enrolled trusted voices.
                      Similarity scores are speaker-model scores, not identity probabilities.
                    </p>
                  </div>

                  <div className="min-w-48 rounded-xl border border-white/10 bg-black p-5">
                    <p className="text-xs text-zinc-500">
                      Identities scanned
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {rankedMatches.length}
                    </p>
                    <p className="mt-2 text-xs text-zinc-600">
                      Status: {trustCircle.status}
                    </p>
                  </div>
                </div>

                {rankedMatches.length > 0 && (
                  <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
                    {rankedMatches.map((match, index) => (
                      <div
                        key={`${match.identity}-${index}`}
                        className="grid grid-cols-[48px_1fr_auto_auto] items-center gap-3 border-b border-white/10 bg-black px-4 py-4 last:border-b-0"
                      >
                        <span className="text-xs text-zinc-600">
                          #{index + 1}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-200">
                          {match.identity}
                        </span>
                        <span className="font-mono text-sm text-zinc-400">
                          {match.similarity_score.toFixed(3)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-[10px] font-semibold tracking-wider ${
                          match.same_speaker
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-white/5 text-zinc-600"
                        }`}>
                          {match.same_speaker ? "MATCH" : "NO MATCH"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AUTOMATIC IMPERSONATION WARNING */}
            {automaticImpersonation && suspectedIdentity && (
              <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-7">
                <p className="text-xs tracking-[0.3em] text-red-300">
                  AUTOMATIC IMPERSONATION WARNING
                </p>
                <h4 className="mt-3 text-3xl font-semibold text-red-100">
                  Possible AI voice clone of {suspectedIdentity}
                </h4>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-red-200/70">
                  AIA automatically found a trusted-speaker match while the recording also showed strong synthetic-speech evidence.
                  The user did not need to specify the suspected identity.
                </p>
              </div>
            )}

            {/* SPEAKER VERIFICATION */}
            {result.speaker_verification && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950 p-7">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs tracking-[0.3em] text-zinc-500">
                      SPEAKER VERIFICATION
                    </p>

                    <h4 className="mt-3 text-2xl font-semibold">
                      {speakerMatched
                        ? `Possible match: ${speakerIdentity}`
                        : `No strong match with ${speakerIdentity}`}
                    </h4>
                  </div>

                  {speakerSimilarity !==
                    null && (
                    <div className="min-w-52 rounded-xl border border-white/10 bg-black p-5">
                      <p className="text-xs text-zinc-500">
                        Similarity Score
                      </p>

                      <p className="mt-2 text-3xl font-semibold">
                        {speakerSimilarity.toFixed(
                          3
                        )}
                      </p>

                      <p className="mt-2 text-xs text-zinc-600">
                        Speaker-model similarity,
                        not identity probability.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CLASSIFICATION */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950 p-7">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs tracking-[0.25em] text-zinc-500">
                    CLASSIFICATION
                  </p>

                  <h4 className="mt-3 text-2xl font-semibold">
                    {
                      finalClassification
                    }
                  </h4>

                  {suspectedIdentity && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Suspected trusted identity: {suspectedIdentity}
                    </p>
                  )}
                </div>

                <div className="max-w-xl">
                  <p className="text-xs tracking-[0.25em] text-zinc-500">
                    RECOMMENDATION
                  </p>

                  <p className="mt-3 text-sm leading-7 text-zinc-300">
                    {finalRecommendation}                  </p>
                </div>
              </div>
            </div>

            {/* POSSIBLE VOICE CLONE */}
            {!automaticImpersonation &&
              result.speaker_verification &&
              speakerMatched &&
              fakePercent >= 50 && (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-7">
                  <p className="text-xs tracking-[0.3em] text-red-300">
                    IMPERSONATION WARNING
                  </p>

                  <h4 className="mt-3 text-2xl font-semibold text-red-100">
                    Possible AI voice clone of{" "}
                    {speakerIdentity}
                  </h4>

                  <p className="mt-4 max-w-3xl text-sm leading-7 text-red-200/70">
                    The recording shows synthetic
                    voice evidence while also
                    matching an enrolled trusted
                    speaker. Do not rely on the
                    voice alone. Verify the
                    person's identity using
                    another trusted communication
                    channel.
                  </p>
                </div>
              )}

            {/* AUDIO INTEGRITY TIMELINE */}
            {timeline && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950 p-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs tracking-[0.3em] text-zinc-500">
                      AUDIO INTEGRITY TIMELINE
                    </p>

                    <h4 className="mt-3 text-2xl font-semibold">
                      Localized synthetic-speech evidence
                    </h4>

                    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                      AIA analyzes the normalized recording in approximately{" "}
                      {timeline.chunk_seconds}-second windows to show where
                      synthetic-speech evidence is strongest.
                    </p>
                  </div>

                  <div
                    className={`min-w-52 rounded-xl border p-5 ${
                      timeline.mixed_evidence
                        ? "border-amber-500/20 bg-amber-500/10"
                        : "border-white/10 bg-black"
                    }`}
                  >
                    <p className="text-xs text-zinc-500">
                      Mixed evidence
                    </p>

                    <p
                      className={`mt-2 text-xl font-semibold ${
                        timeline.mixed_evidence
                          ? "text-amber-200"
                          : "text-zinc-200"
                      }`}
                    >
                      {timeline.mixed_evidence
                        ? "DETECTED"
                        : "NOT DETECTED"}
                    </p>

                    <p className="mt-2 text-xs text-zinc-600">
                      {timeline.usable_segments} usable segment
                      {timeline.usable_segments === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                {timeline.segments.length > 0 ? (
                  <>
                    <div className="mt-7">
                      <div className="mb-3 flex items-center justify-between text-[11px] text-zinc-600">
                        <span>0s</span>
                        <span>
                          {timeline.segments[
                            timeline.segments.length - 1
                          ].end_seconds.toFixed(2)}
                          s
                        </span>
                      </div>

                      <div className="flex min-h-16 overflow-hidden rounded-xl border border-white/10 bg-black">
                        {timeline.segments.map((segment) => {
                          const totalDuration =
                            timeline.segments[
                              timeline.segments.length - 1
                            ]?.end_seconds || 1;

                          const width =
                            (segment.duration_seconds /
                              totalDuration) *
                            100;

                          const segmentClass =
                            segment.classification === "synthetic"
                              ? "bg-red-500/70 hover:bg-red-500"
                              : segment.classification ===
                                "suspicious"
                              ? "bg-amber-500/60 hover:bg-amber-500/80"
                              : segment.classification ===
                                "likely_genuine"
                              ? "bg-emerald-500/50 hover:bg-emerald-500/70"
                              : "bg-zinc-800 hover:bg-zinc-700";

                          const label =
                            segment.classification === "synthetic"
                              ? "AI"
                              : segment.classification ===
                                "suspicious"
                              ? "SUS"
                              : segment.classification ===
                                "likely_genuine"
                              ? "REAL"
                              : "N/A";

                          return (
                            <div
                              key={segment.segment_index}
                              className={`group relative flex min-w-[42px] items-center justify-center border-r border-black/30 px-1 transition last:border-r-0 ${segmentClass}`}
                              style={{
                                width: `${width}%`,
                              }}
                              title={`${segment.start_seconds.toFixed(
                                2
                              )}s – ${segment.end_seconds.toFixed(
                                2
                              )}s | ${
                                segment.fake_probability != null
                                  ? `${Math.round(
                                      segment.fake_probability *
                                        100
                                    )}% synthetic`
                                  : "analysis unavailable"
                              }`}
                            >
                              <span className="text-[10px] font-semibold tracking-wider text-white">
                                {label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />
                          Likely genuine
                        </span>

                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/60" />
                          Suspicious
                        </span>

                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-red-500/70" />
                          Synthetic
                        </span>

                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-800" />
                          Unavailable
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      <TimelineStat
                        label="LIKELY GENUINE"
                        value={timeline.likely_genuine_segments}
                      />

                      <TimelineStat
                        label="SUSPICIOUS"
                        value={timeline.suspicious_segments}
                      />

                      <TimelineStat
                        label="SYNTHETIC"
                        value={timeline.synthetic_segments}
                      />
                    </div>

                    <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
                      {timeline.segments.map((segment) => (
                        <div
                          key={`detail-${segment.segment_index}`}
                          className="grid gap-3 border-b border-white/10 bg-black px-4 py-4 last:border-b-0 sm:grid-cols-[100px_1fr_auto]"
                        >
                          <span className="font-mono text-xs text-zinc-500">
                            {segment.start_seconds.toFixed(2)}–
                            {segment.end_seconds.toFixed(2)}s
                          </span>

                          <span className="text-sm text-zinc-300">
                            {segment.classification ===
                            "likely_genuine"
                              ? "Likely genuine speech"
                              : segment.classification ===
                                "suspicious"
                              ? "Suspicious synthetic evidence"
                              : segment.classification ===
                                "synthetic"
                              ? "Strong synthetic evidence"
                              : "Segment analysis unavailable"}
                          </span>

                          <span className="font-mono text-xs text-zinc-500">
                            {segment.fake_probability != null
                              ? `${Math.round(
                                  segment.fake_probability * 100
                                )}% synthetic`
                              : "N/A"}
                          </span>
                        </div>
                      ))}
                    </div>

                    {timeline.strongest_synthetic_segment &&
                      timeline.strongest_synthetic_segment
                        .fake_probability != null && (
                        <div className="mt-5 rounded-xl border border-white/10 bg-black p-5">
                          <p className="text-xs tracking-[0.2em] text-zinc-600">
                            HIGHEST SYNTHETIC SCORE
                          </p>

                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <p className="text-lg font-semibold">
                              {timeline.strongest_synthetic_segment.start_seconds.toFixed(
                                2
                              )}
                              s –{" "}
                              {timeline.strongest_synthetic_segment.end_seconds.toFixed(
                                2
                              )}
                              s
                            </p>

                            <p className="text-sm text-zinc-400">
                              {Math.round(
                                timeline.strongest_synthetic_segment
                                  .fake_probability * 100
                              )}
                              % synthetic score
                            </p>
                          </div>
                        </div>
                      )}

                    {timeline.mixed_evidence && (
                      <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-5 py-4">
                        <p className="text-sm font-medium text-amber-200">
                          ⚠ Mixed audio evidence detected
                        </p>

                        <p className="mt-2 text-xs leading-5 text-amber-200/60">
                          This recording contains both likely-genuine
                          and strongly synthetic-scoring regions.
                          Review the highlighted time ranges before
                          making an identity or authenticity decision.
                        </p>
                      </div>
                    )}

                    <p className="mt-5 text-xs leading-5 text-zinc-600">
                      {timeline.note}
                    </p>
                  </>
                ) : (
                  <div className="mt-6 rounded-xl border border-white/10 bg-black px-4 py-4 text-sm text-zinc-400">
                    No timeline segments were available for this
                    recording.
                  </div>
                )}
              </div>
            )}

            {/* FORENSICS */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950 p-7">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs tracking-[0.3em] text-zinc-500">
                    FORENSIC AUDIO SIGNALS
                  </p>

                  <h4 className="mt-2 text-xl font-semibold">
                    Acoustic & prosodic
                    measurements
                  </h4>
                </div>

                <div className="text-xs text-zinc-500">
                  {
                    result.forensic_analysis
                      .duration_seconds
                  }
                  s
                  {" • "}
                  {
                    result.forensic_analysis
                      .sample_rate
                  }{" "}
                  Hz
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  name="Pitch Variation"
                  value={`${result.forensic_analysis.prosody.pitch_variation_hz} Hz`}
                  detail={`Mean pitch: ${result.forensic_analysis.prosody.pitch_mean_hz} Hz`}
                />

                <MetricCard
                  name="Energy Variation"
                  value={
                    result.forensic_analysis
                      .prosody.energy_variation
                  }
                  detail="Speech intensity variation"
                />

                <MetricCard
                  name="Silence Ratio"
                  value={`${Math.round(
                    result.forensic_analysis
                      .prosody.silence_ratio *
                      100
                  )}%`}
                  detail="Pause characteristics"
                />

                <MetricCard
                  name="Spectral Variation"
                  value={
                    result.forensic_analysis
                      .spectral
                      .spectral_variation
                  }
                  detail="Frequency-spectrum variation"
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <MetricCard
                  name="Spectral Centroid"
                  value={`${result.forensic_analysis.spectral.spectral_centroid_hz} Hz`}
                />

                <MetricCard
                  name="Spectral Flatness"
                  value={
                    result.forensic_analysis
                      .spectral
                      .spectral_flatness
                  }
                />

                <MetricCard
                  name="Zero Crossing Rate"
                  value={
                    result.forensic_analysis
                      .spectral
                      .zero_crossing_rate
                  }
                />
              </div>

              {/* SUPPORTING INDICATORS */}
              <div className="mt-6">
                <p className="text-xs tracking-[0.25em] text-zinc-500">
                  SUPPORTING INDICATORS
                </p>

                {result.forensic_analysis
                  .experimental_indicators
                  .length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {result.forensic_analysis.experimental_indicators.map(
                      (indicator, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                        >
                          ⚠ {indicator}
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-white/10 bg-black px-4 py-3 text-sm text-zinc-400">
                    No experimental forensic
                    indicators triggered.
                  </div>
                )}

                <p className="mt-4 text-xs leading-5 text-zinc-600">
                  Supporting indicators are
                  experimental acoustic
                  observations and should not be
                  interpreted as standalone proof
                  of synthetic speech.
                </p>
              </div>
            </div>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function PrivacyStatusCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-5">
      <p className="text-[10px] tracking-[0.18em] text-zinc-600">
        {label.toUpperCase()}
      </p>
      <p className="mt-2 text-lg font-semibold text-zinc-200">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-600">
        {note}
      </p>
    </div>
  );
}

function AlertCard({
  alert,
}: {
  alert: AlertRecord;
}) {
  const severity =
    alert.severity?.toUpperCase() || "HIGH";

  const isCritical = severity === "CRITICAL";
  const date = new Date(alert.timestamp);

  return (
    <div
      className={`rounded-2xl border p-5 ${
        isCritical
          ? "border-red-500/30 bg-red-500/10"
          : "border-orange-500/25 bg-orange-500/10"
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${
                isCritical
                  ? "border-red-500/25 bg-red-500/10 text-red-200"
                  : "border-orange-500/25 bg-orange-500/10 text-orange-200"
              }`}
            >
              {severity}
            </span>

            <span className="text-xs text-zinc-600">
              {Number.isNaN(date.getTime())
                ? alert.timestamp
                : date.toLocaleString()}
            </span>
          </div>

          <h3 className="mt-3 text-lg font-semibold">
            {alert.title}
          </h3>

          <p className="mt-1 truncate text-sm text-zinc-500">
            {alert.filename}
          </p>

          <p className="mt-3 text-sm leading-6 text-zinc-300">
            {alert.recommendation ||
              "Review the evidence before taking sensitive action."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[410px]">
          <AlertMetric
            label="Synthetic"
            value={`${Math.round(alert.synthetic_score)}%`}
          />
          <AlertMetric
            label="Confidence"
            value={alert.confidence || "N/A"}
          />
          <AlertMetric
            label="Trusted match"
            value={alert.trusted_identity || "None"}
          />
        </div>
      </div>
    </div>
  );
}

function AlertMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
      <p className="text-[9px] tracking-[0.14em] text-zinc-600">
        {label.toUpperCase()}
      </p>
      <p className="mt-1 truncate text-xs font-semibold text-zinc-300">
        {value}
      </p>
    </div>
  );
}

function SecurityEventCard({
  event,
}: {
  event: SecurityEventRecord;
}) {
  const risk =
    event.risk_level?.toUpperCase() || "UNKNOWN";

  const date = new Date(event.timestamp);

  return (
    <div className="rounded-xl border border-white/10 bg-black px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-semibold tracking-wider text-zinc-400">
              {risk}
            </span>
            <span className="text-[11px] text-zinc-600">
              {Number.isNaN(date.getTime())
                ? event.timestamp
                : date.toLocaleString()}
            </span>
          </div>

          <p className="mt-2 truncate text-sm font-medium text-zinc-300">
            {event.filename}
          </p>

          <p className="mt-1 text-xs text-zinc-600">
            {event.classification}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
          <span className="rounded-lg border border-white/10 px-2.5 py-1.5">
            Synthetic {Math.round(event.synthetic_score)}%
          </span>
          <span className="rounded-lg border border-white/10 px-2.5 py-1.5">
            {event.trusted_identity
              ? `Match: ${event.trusted_identity}`
              : "No trusted match"}
          </span>
        </div>
      </div>
    </div>
  );
}

function HistoryCard({
  item,
}: {
  item: HistoryRecord;
}) {
  const risk = item.risk_level?.toUpperCase() || "UNKNOWN";

  const tone =
    risk === "CRITICAL"
      ? "border-red-500/25"
      : risk === "HIGH"
      ? "border-orange-500/20"
      : risk === "MEDIUM"
      ? "border-amber-500/20"
      : risk === "LOW"
      ? "border-emerald-500/20"
      : "border-white/10";

  const date = new Date(item.timestamp);

  return (
    <div className={`rounded-2xl border bg-black p-5 ${tone}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-zinc-300">
              {risk}
            </span>
            <span className="text-xs text-zinc-600">
              {Number.isNaN(date.getTime())
                ? item.timestamp
                : date.toLocaleString()}
            </span>
          </div>

          <p className="mt-3 truncate text-sm font-medium text-zinc-300">
            {item.filename}
          </p>

          <p className="mt-1 text-lg font-semibold">
            {item.classification}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
          <HistoryMetric
            label="Synthetic"
            value={`${Math.round(item.synthetic_score)}%`}
          />
          <HistoryMetric
            label="Confidence"
            value={item.confidence || "N/A"}
          />
          <HistoryMetric
            label="Trusted match"
            value={item.trusted_identity || "None"}
          />
          <HistoryMetric
            label="Similarity"
            value={
              item.identity_similarity != null
                ? item.identity_similarity.toFixed(3)
                : "N/A"
            }
          />
        </div>
      </div>
    </div>
  );
}

function HistoryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3">
      <p className="text-[9px] tracking-[0.14em] text-zinc-600">
        {label.toUpperCase()}
      </p>
      <p className="mt-1 truncate text-xs font-semibold text-zinc-300">
        {value}
      </p>
    </div>
  );
}

function SimpleEvidence({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-4">
      <p className="text-[10px] tracking-[0.16em] text-zinc-600">
        {label.toUpperCase()}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-200">
        {value}
      </p>
    </div>
  );
}

function AssessmentMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
      <p className="text-[10px] tracking-[0.18em] text-zinc-600">
        {label}
      </p>

      <p className="mt-2 break-words text-xl font-semibold">
        {value}
      </p>

      {detail && (
        <p className="mt-2 text-xs leading-5 text-zinc-600">
          {detail}
        </p>
      )}
    </div>
  );
}

function formatEvidenceLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function formatEvidenceValue(value: unknown) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  if (typeof value === "boolean") {
    return value ? "YES" : "NO";
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4);
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function TimelineStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black p-5">
      <p className="text-[10px] tracking-[0.18em] text-zinc-600">
        {label}
      </p>

      <p className="mt-2 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  name,
  value,
  detail,
}: {
  name: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black p-5">
      <p className="text-xs text-zinc-500">
        {name}
      </p>

      <p className="mt-2 text-xl font-semibold">
        {value}
      </p>

      {detail && (
        <p className="mt-2 text-xs text-zinc-600">
          {detail}
        </p>
      )}
    </div>
  );
}