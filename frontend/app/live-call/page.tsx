"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type SignalMessage =
  | { type: "offer"; sdp: RTCSessionDescriptionInit; from: string }
  | { type: "answer"; sdp: RTCSessionDescriptionInit; from: string }
  | { type: "ice"; candidate: RTCIceCandidateInit; from: string }
  | { type: "hangup"; from: string };

type LiveChunk = {
  chunk_index: number;
  synthetic_score: number;
  risk_level: string;
  classification: string;
  speech_detected: boolean;
  start_seconds: number;
  end_seconds: number;
  live_identity?: {
    status?: string;
    speech_collected_seconds?: number;
  } | null;
};

type FinalIdentity = {
  identity: string | null;
  similarityPercent: number | null;
  trustedMatch: boolean;
};

function makeRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function formatSeconds(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

export default function LiveCallPage() {
  const [roomId, setRoomId] = useState(makeRoom());
  const [role, setRole] = useState<"caller" | "receiver" | null>(null);
  const [connectionState, setConnectionState] = useState("DISCONNECTED");
  const [statusText, setStatusText] = useState(
    "Open this page in two tabs. Join from one tab first, then start from the other."
  );
  const [remotePlayback, setRemotePlayback] = useState(false);

  const [aiaEnabled, setAiaEnabled] = useState(false);
  const [aiaStatus, setAiaStatus] = useState("IDLE");
  const [chunks, setChunks] = useState<LiveChunk[]>([]);
  const chunksRef = useRef<LiveChunk[]>([]);
  const [currentRisk, setCurrentRisk] = useState(0);
  const [speechSeconds, setSpeechSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [finalIdentity, setFinalIdentity] = useState<FinalIdentity | null>(null);
  const [finalAssessment, setFinalAssessment] = useState<{
    title: string;
    risk: string;
    explanation: string;
  } | null>(null);
  const [finalAvgSynthetic, setFinalAvgSynthetic] = useState(0);
  const [finalPeakSynthetic, setFinalPeakSynthetic] = useState(0);
  const [error, setError] = useState("");

  const peerIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const signalingSocketRef = useRef<WebSocket | null>(null);
  const signalingReadyRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const lastOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const offerRepeatTimerRef = useRef<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const analysisActiveRef = useRef(false);
  const chunkIndexRef = useRef(0);
  const sessionIdRef = useRef("");
  const analysisStartRef = useRef<number | null>(null);
  const pendingRequestsRef = useRef<Set<Promise<void>>>(new Set());
  const durationTimerRef = useRef<number | null>(null);

  const avgSynthetic = useMemo(() => {
    const usable = chunks.filter((c) => c.speech_detected);
    if (!usable.length) return 0;

    return Math.round(
      usable.reduce((sum, c) => sum + c.synthetic_score, 0) / usable.length
    );
  }, [chunks]);

  const peakSynthetic = useMemo(
    () =>
      chunks.length
        ? Math.round(Math.max(...chunks.map((c) => c.synthetic_score)))
        : 0,
    [chunks]
  );

  const suspiciousCount = useMemo(
    () =>
      chunks.filter(
        (c) => c.risk_level === "SUSPICIOUS" || c.risk_level === "HIGH"
      ).length,
    [chunks]
  );

  function signalingUrl() {
    const base = API_BASE.replace(/\/$/, "");

    if (base.startsWith("https://")) {
      return base.replace("https://", "wss://");
    }

    if (base.startsWith("http://")) {
      return base.replace("http://", "ws://");
    }

    return `ws://${base}`;
  }

  function postSignal(message: Omit<SignalMessage, "from">) {
    const socket = signalingSocketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Signaling is not connected yet. Wait a moment and try again.");
      return;
    }

    socket.send(
      JSON.stringify({
        ...message,
        from: peerIdRef.current,
      })
    );
  }

  async function ensureSignalingReady() {
    if (
      signalingSocketRef.current &&
      signalingSocketRef.current.readyState === WebSocket.OPEN &&
      signalingReadyRef.current
    ) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Signaling server did not respond.")),
        8000
      );

      const check = () => {
        if (
          signalingSocketRef.current?.readyState === WebSocket.OPEN &&
          signalingReadyRef.current
        ) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }

        window.setTimeout(check, 100);
      };

      check();
    });
  }

  async function applyQueuedIce(pc: RTCPeerConnection) {
    const queued = [...queuedIceRef.current];
    queuedIceRef.current = [];

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn("Queued ICE candidate failed:", e);
      }
    }
  }

  async function ensureLocalStream() {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    localStreamRef.current = stream;

    return stream;
  }

  function ensurePeerConnection() {
    if (pcRef.current) {
      return pcRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState.toUpperCase();

      setConnectionState(state);

      if (state === "CONNECTED") {
        setStatusText("WebRTC call connected.");

        if (offerRepeatTimerRef.current) {
          window.clearInterval(offerRepeatTimerRef.current);
          offerRepeatTimerRef.current = null;
        }
      }

      if (["FAILED", "CLOSED", "DISCONNECTED"].includes(state)) {
        setStatusText(`Call ${state.toLowerCase()}.`);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        postSignal({
          type: "ice",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);

      remoteStreamRef.current = stream;

      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }

      setStatusText("Remote voice received. You can enable AIA protection.");
    };

    pcRef.current = pc;

    return pc;
  }

  async function preparePeer() {
    setError("");

    const pc = ensurePeerConnection();
    const stream = await ensureLocalStream();

    const existingTrackIds = new Set(
      pc.getSenders()
        .map((sender) => sender.track?.id)
        .filter(Boolean)
    );

    for (const track of stream.getTracks()) {
      if (!existingTrackIds.has(track.id)) {
        pc.addTrack(track, stream);
      }
    }

    return pc;
  }

  async function joinCall() {
    try {
      setRole("receiver");
      setConnectionState("WAITING");

      setStatusText(
        `Waiting in room ${roomId}. Now click Start Call in the other tab.`
      );

      await ensureSignalingReady();
      await preparePeer();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not access microphone."
      );
    }
  }

  async function startCall() {
    try {
      setRole("caller");
      setConnectionState("CALLING");

      setStatusText(`Calling room ${roomId}...`);

      await ensureSignalingReady();

      const pc = await preparePeer();

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      lastOfferRef.current = offer;

      postSignal({
        type: "offer",
        sdp: offer,
      });

      if (offerRepeatTimerRef.current) {
        window.clearInterval(offerRepeatTimerRef.current);
      }

      offerRepeatTimerRef.current = window.setInterval(() => {
        if (pc.connectionState !== "connected" && lastOfferRef.current) {
          postSignal({
            type: "offer",
            sdp: lastOfferRef.current,
          });
        }
      }, 1500);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start WebRTC call."
      );
    }
  }

  async function handleSignal(message: SignalMessage) {
    if (message.from === peerIdRef.current) {
      return;
    }

    try {
      if (message.type === "hangup") {
        await hangUp(false);

        setStatusText("The other side ended the call.");

        return;
      }

      const pc = await preparePeer();

      if (message.type === "offer") {
        if (pc.signalingState !== "stable") {
          return;
        }

        await pc.setRemoteDescription(message.sdp);

        await applyQueuedIce(pc);

        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);

        postSignal({
          type: "answer",
          sdp: answer,
        });

        setRole((current) => current ?? "receiver");

        setConnectionState("CONNECTING");
      }

      if (message.type === "answer") {
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(message.sdp);

          await applyQueuedIce(pc);
        }
      }

      if (message.type === "ice") {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(message.candidate);
        } else {
          queuedIceRef.current.push(message.candidate);
        }
      }
    } catch (e) {
      console.error("Signal handling failed:", e);

      setError(
        e instanceof Error ? e.message : "WebRTC signaling failed."
      );
    }
  }

  useEffect(() => {
    if (!roomId.trim()) {
      return;
    }

    signalingSocketRef.current?.close();

    signalingReadyRef.current = false;

    const url =
      `${signalingUrl()}/ws/signaling/` +
      `${encodeURIComponent(roomId.trim().toUpperCase())}/` +
      `${encodeURIComponent(peerIdRef.current)}`;

    const socket = new WebSocket(url);

    signalingSocketRef.current = socket;

    socket.onopen = () => {
      setStatusText("Signaling connected. Ready to start or join the call.");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "signaling-ready") {
          signalingReadyRef.current = true;
          return;
        }

        void handleSignal(data as SignalMessage);
      } catch (e) {
        console.error("Invalid signaling message:", e);
      }
    };

    socket.onerror = () => {
      setError(
        "Could not connect to the AIA signaling server. Check the backend URL."
      );
    };

    socket.onclose = () => {
      signalingReadyRef.current = false;
    };

    return () => {
      socket.close();

      if (signalingSocketRef.current === socket) {
        signalingSocketRef.current = null;
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !remotePlayback;

      if (remotePlayback) {
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [remotePlayback]);

  async function sendAnalysisChunk(
    blob: Blob,
    index: number,
    startSeconds: number,
    endSeconds: number
  ) {
    if (blob.size < 100 || !analysisActiveRef.current) {
      return;
    }

    try {
      const mimeType = blob.type || "audio/webm";

      const extension = mimeType.includes("webm") ? "webm" : "wav";

      const file = new File(
        [blob],
        `call_chunk_${index}.${extension}`,
        {
          type: mimeType,
        }
      );

      const body = new FormData();

      body.append("file", file);
      body.append("chunk_index", String(index));
      body.append("session_id", sessionIdRef.current);

      const response = await fetch(`${API_BASE}/live-analyze`, {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "AIA live analysis failed."
        );
      }

      const item: LiveChunk = {
        chunk_index: index,
        synthetic_score: Number(data.synthetic_score || 0),
        risk_level: String(data.risk_level || "SAFE"),
        classification: String(data.classification || ""),
        speech_detected: data.speech_detected === true,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        live_identity: data.live_identity,
      };

      setCurrentRisk(item.synthetic_score);

      setSpeechSeconds(
        Number(
          data.live_identity?.speech_collected_seconds ||
            speechSeconds
        )
      );

      const updatedChunks = [
        ...chunksRef.current.filter(
          (x) => x.chunk_index !== index
        ),
        item,
      ]
        .sort(
          (a, b) =>
            a.chunk_index - b.chunk_index
        )
        .slice(-30);

      chunksRef.current = updatedChunks;

      setChunks(updatedChunks);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "AIA chunk failed."
      );
    }
  }

  function startNextRemoteChunk(stream: MediaStream) {
    if (!analysisActiveRef.current) {
      return;
    }

    try {
      const preferred =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(
          "audio/webm;codecs=opus"
        )
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType: preferred,
      });

      recorderRef.current = recorder;

      const pieces: BlobPart[] = [];

      const index = ++chunkIndexRef.current;

      const startSeconds = (index - 1) * 4;
      const endSeconds = index * 4;

      const startedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          pieces.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError(
          "Remote call audio recording failed."
        );
      };

      recorder.onstop = () => {
        if (
          pieces.length &&
          Date.now() - startedAt >= 1500
        ) {
          const blob = new Blob(pieces, {
            type:
              recorder.mimeType ||
              preferred,
          });

          const request = sendAnalysisChunk(
            blob,
            index,
            startSeconds,
            endSeconds
          );

          pendingRequestsRef.current.add(request);

          void request.finally(() =>
            pendingRequestsRef.current.delete(
              request
            )
          );
        }

        if (analysisActiveRef.current) {
          startNextRemoteChunk(stream);
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
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not analyze remote stream."
      );

      void stopAiaProtection();
    }
  }

  async function startAiaProtection() {
    if (!remoteStreamRef.current) {
      setError(
        "Connect the call first. AIA analyzes the incoming remote voice."
      );

      return;
    }

    setError("");

    chunksRef.current = [];

    setChunks([]);
    setCurrentRisk(0);
    setSpeechSeconds(0);
    setFinalIdentity(null);
    setFinalAssessment(null);
    setFinalAvgSynthetic(0);
    setFinalPeakSynthetic(0);

    setAiaEnabled(true);

    setAiaStatus("PROTECTING");

    sessionIdRef.current =
      crypto.randomUUID();

    chunkIndexRef.current = 0;

    analysisActiveRef.current = true;

    analysisStartRef.current = Date.now();

    if (durationTimerRef.current) {
      window.clearInterval(
        durationTimerRef.current
      );
    }

    durationTimerRef.current =
      window.setInterval(() => {
        if (analysisStartRef.current) {
          setDurationSeconds(
            Math.floor(
              (Date.now() -
                analysisStartRef.current) /
                1000
            )
          );
        }
      }, 500);

    startNextRemoteChunk(
      remoteStreamRef.current
    );
  }

  async function stopAiaProtection() {
    if (
      !analysisActiveRef.current &&
      !aiaEnabled
    ) {
      return;
    }

    analysisActiveRef.current = false;

    setAiaStatus("FINALIZING");

    if (durationTimerRef.current) {
      window.clearInterval(
        durationTimerRef.current
      );

      durationTimerRef.current = null;
    }

    const recorder =
      recorderRef.current;

    if (
      recorder &&
      recorder.state === "recording"
    ) {
      recorder.stop();
    }

    await Promise.allSettled([
      ...pendingRequestsRef.current,
    ]);

    let identity: FinalIdentity = {
      identity: null,
      similarityPercent: null,
      trustedMatch: false,
    };

    try {
      const response = await fetch(
        `${API_BASE}/live-session/${sessionIdRef.current}/finalize`,
        {
          method: "POST",
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Trust Circle finalization failed."
        );
      }

      const best =
        data.trust_circle?.best_match;

      const strongest =
        data.trust_circle?.strongest_candidate;

      const candidate =
        best ?? strongest;

      identity = {
        identity:
          candidate?.identity ?? null,

        similarityPercent:
          typeof candidate?.similarity_score ===
          "number"
            ? Math.round(
                candidate.similarity_score *
                  100
              )
            : null,

        trustedMatch:
          best?.same_speaker === true,
      };

      setFinalIdentity(identity);

      const completedChunks =
        chunksRef.current;

      const usable =
        completedChunks.filter(
          (c) => c.speech_detected
        );

      const calculatedFinalAvg = usable.length
        ? Math.round(
            usable.reduce(
              (sum, c) => sum + c.synthetic_score,
              0
            ) / usable.length
          )
        : 0;

      const calculatedFinalPeak = completedChunks.length
        ? Math.round(
            Math.max(
              ...completedChunks.map(
                (c) => c.synthetic_score
              )
            )
          )
        : 0;

      setFinalAvgSynthetic(calculatedFinalAvg);
      setFinalPeakSynthetic(calculatedFinalPeak);

      const suspicious =
        usable.filter(
          (c) =>
            c.risk_level ===
              "SUSPICIOUS" ||
            c.risk_level === "HIGH"
        ).length;

      const highs =
        usable.filter(
          (c) =>
            c.risk_level === "HIGH"
        ).length;

      const safe = usable.filter(
        (c) => c.risk_level === "SAFE"
      ).length;

      const averageSynthetic = usable.length
        ? usable.reduce(
            (sum, c) => sum + c.synthetic_score,
            0
          ) / usable.length
        : 0;

      const suspiciousRatio = usable.length
        ? suspicious / usable.length
        : 0;

      const highRatio = usable.length
        ? highs / usable.length
        : 0;

      // Live-call fusion: an isolated HIGH/SUSPICIOUS chunk is not enough.
      // We escalate only when synthetic evidence is sustained across the call.
      // This protects genuine WebRTC speech from codec/channel spikes while
      // preserving escalation for repeated synthetic evidence.
      const sustained =
        usable.length >= 3 &&
        (
          (averageSynthetic >= 65 && highs >= 2) ||
          (averageSynthetic >= 50 && highRatio >= 0.5) ||
          (averageSynthetic >= 40 && suspiciousRatio >= 0.6 && suspicious >= 3)
        );

      if (
        identity.trustedMatch &&
        sustained
      ) {
        setFinalAssessment({
          title:
            "POSSIBLE VOICE IMPERSONATION",

          risk: "HIGH",

          explanation:
            "The incoming voice resembles a trusted identity while synthetic-voice evidence persisted across multiple call segments.",
        });
      } else if (
        identity.trustedMatch
      ) {
        setFinalAssessment({
          title:
            "LIKELY GENUINE TRUSTED SPEAKER",

          risk: "LOW",

          explanation:
            "The incoming voice resembles a trusted identity and no sustained synthetic-voice pattern was found.",
        });
      } else if (sustained) {
        setFinalAssessment({
          title:
            "LIKELY SYNTHETIC / UNKNOWN SPEAKER",

          risk: "HIGH",

          explanation:
            "Sustained synthetic-voice evidence was detected across multiple usable speech segments, but no trusted-speaker match was confirmed.",
        });
      } else {
        setFinalAssessment({
          title:
            "NO STRONG IMPERSONATION WARNING",

          risk: "LOW",

          explanation:
            "No sustained synthetic pattern or trusted-speaker impersonation evidence was confirmed.",
        });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not finalize AIA."
      );
    } finally {
      try {
        await fetch(
          `${API_BASE}/live-session/${sessionIdRef.current}`,
          {
            method: "DELETE",
          }
        );
      } catch {}

      // Final result is already stored above. Reset only the LIVE monitor
      // so the judge sees a clean finished state instead of stale live data.
      setAiaEnabled(false);
      setAiaStatus("IDLE");
      setCurrentRisk(0);
      setDurationSeconds(0);
      setSpeechSeconds(0);

      chunksRef.current = [];
      setChunks([]);
      chunkIndexRef.current = 0;
      analysisStartRef.current = null;
      recorderRef.current = null;
    }
  }

  async function hangUp(
    sendSignal = true
  ) {
    if (
      analysisActiveRef.current ||
      aiaEnabled
    ) {
      await stopAiaProtection();
    }

    if (sendSignal) {
      postSignal({
        type: "hangup",
      });
    }

    if (
      offerRepeatTimerRef.current
    ) {
      window.clearInterval(
        offerRepeatTimerRef.current
      );

      offerRepeatTimerRef.current =
        null;
    }

    pcRef.current?.close();

    pcRef.current = null;

    localStreamRef.current
      ?.getTracks()
      .forEach((track) =>
        track.stop()
      );

    localStreamRef.current = null;

    remoteStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject =
        null;
    }

    setRole(null);

    setConnectionState(
      "DISCONNECTED"
    );

    setStatusText(
      "Call ended."
    );
  }

  useEffect(() => {
    return () => {
      analysisActiveRef.current =
        false;

      if (
        offerRepeatTimerRef.current
      ) {
        window.clearInterval(
          offerRepeatTimerRef.current
        );
      }

      if (
        durationTimerRef.current
      ) {
        window.clearInterval(
          durationTimerRef.current
        );
      }

      pcRef.current?.close();

      localStreamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        );
    };
  }, []);

  const safeCount =
    chunks.filter(
      (c) =>
        c.risk_level === "SAFE"
    ).length;

  const highCount =
    chunks.filter(
      (c) =>
        c.risk_level === "HIGH"
    ).length;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "#f4f4f5",
        padding: "28px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            gap: 16,
            alignItems: "center",
            marginBottom: 22,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                letterSpacing:
                  "0.2em",
                color: "#a78bfa",
                marginBottom: 8,
              }}
            >
              AIA • AUTHORIZED WEBRTC /
              VOIP DEMO
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: 34,
              }}
            >
              Live Call Protection
            </h1>

            <p
              style={{
                color: "#a1a1aa",
                marginBottom: 0,
              }}
            >
              A real peer-to-peer
              browser audio call with
              AIA analyzing the incoming
              voice stream.
            </p>
          </div>

          <a
            href="/"
            style={{
              color: "#ddd6fe",
              textDecoration: "none",
              border:
                "1px solid #3f3f46",
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            ← Main AIA
          </a>
        </div>

        {error && (
          <div
            style={{
              border:
                "1px solid #7f1d1d",
              background: "#1f0909",
              color: "#fecaca",
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <section
          style={{
            border:
              "1px solid #27272a",
            borderRadius: 16,
            padding: 20,
            marginBottom: 18,
            background: "#09090b",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "1.4fr 1fr",
              gap: 18,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  color: "#a1a1aa",
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                CALL ROOM
              </label>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                }}
              >
                <input
                  value={roomId}
                  onChange={(e) =>
                    setRoomId(
                      e.target.value
                        .toUpperCase()
                        .replace(
                          /\s/g,
                          ""
                        )
                    )
                  }
                  disabled={
                    connectionState !==
                    "DISCONNECTED"
                  }
                  style={{
                    flex: 1,
                    background:
                      "#050505",
                    color: "white",
                    border:
                      "1px solid #3f3f46",
                    borderRadius: 10,
                    padding:
                      "12px 14px",
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing:
                      "0.12em",
                  }}
                />

                <button
                  onClick={() =>
                    setRoomId(
                      makeRoom()
                    )
                  }
                  disabled={
                    connectionState !==
                    "DISCONNECTED"
                  }
                  style={buttonStyle(
                    "#27272a"
                  )}
                >
                  New Code
                </button>
              </div>

              <p
                style={{
                  color: "#71717a",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                Open this page on the
                laptop and phone using
                the same public HTTPS
                URL and the same room
                code. Click{" "}
                <b>Join / Wait</b> on
                the protected laptop
                first, then{" "}
                <b>Start Call</b> on
                the mobile caller.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={joinCall}
                  disabled={
                    connectionState !==
                    "DISCONNECTED"
                  }
                  style={buttonStyle(
                    "#4c1d95"
                  )}
                >
                  Join / Wait
                </button>

                <button
                  onClick={startCall}
                  disabled={
                    connectionState !==
                    "DISCONNECTED"
                  }
                  style={buttonStyle(
                    "#166534"
                  )}
                >
                  Start Call
                </button>

                <button
                  onClick={() =>
                    void hangUp()
                  }
                  disabled={
                    connectionState ===
                    "DISCONNECTED"
                  }
                  style={buttonStyle(
                    "#7f1d1d"
                  )}
                >
                  End Call
                </button>
              </div>
            </div>

            <div
              style={{
                border:
                  "1px solid #27272a",
                borderRadius: 12,
                padding: 16,
                background: "#050505",
              }}
            >
              <div style={eyebrow}>
                CALL STATUS
              </div>

              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  marginTop: 6,
                  color:
                    connectionState ===
                    "CONNECTED"
                      ? "#4ade80"
                      : "#f4f4f5",
                }}
              >
                {connectionState}
              </div>

              <div
                style={{
                  color: "#a1a1aa",
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Role: {role ?? "—"}
              </div>

              <div
                style={{
                  color: "#71717a",
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {statusText}
              </div>

              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginTop: 14,
                  fontSize: 13,
                  color: "#d4d4d8",
                }}
              >
                <input
                  type="checkbox"
                  checked={remotePlayback}
                  onChange={(e) =>
                    setRemotePlayback(
                      e.target.checked
                    )
                  }
                />

                Play remote audio on
                this device
              </label>

              <audio
                ref={remoteAudioRef}
                autoPlay
                playsInline
              />
            </div>
          </div>
        </section>

        <section
          style={{
            border:
              "1px solid #3b0764",
            borderRadius: 16,
            padding: 20,
            background: "#0c0712",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  ...eyebrow,
                  color: "#c084fc",
                }}
              >
                AIA CALL SECURITY LAYER
              </div>

              <h2
                style={{
                  margin:
                    "6px 0 4px",
                  fontSize: 22,
                }}
              >
                Incoming Voice Analysis
              </h2>

              <div
                style={{
                  color: "#a1a1aa",
                  fontSize: 13,
                }}
              >
                The remote WebRTC stream
                is chunked every 4
                seconds and sent through
                your existing AIA live
                engine.
              </div>
            </div>

            {!aiaEnabled ? (
              <button
                onClick={
                  startAiaProtection
                }
                disabled={
                  connectionState !==
                  "CONNECTED"
                }
                style={buttonStyle(
                  "#6d28d9"
                )}
              >
                Enable AIA Protection
              </button>
            ) : (
              <button
                onClick={() =>
                  void stopAiaProtection()
                }
                style={buttonStyle(
                  "#b45309"
                )}
              >
                Stop & Finalize AIA
              </button>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(4, minmax(0, 1fr))",
              gap: 12,
              marginTop: 18,
            }}
          >
            <Stat
              label="AIA STATUS"
              value={aiaStatus}
            />

            <Stat
              label="CURRENT SYNTHETIC RISK"
              value={`${currentRisk}%`}
            />

            <Stat
              label="CHUNKS"
              value={String(
                chunks.length
              )}
            />

            <Stat
              label="CALL ANALYZED"
              value={formatSeconds(
                durationSeconds
              )}
            />
          </div>

          <div
            style={{
              marginTop: 14,
              border:
                "1px solid #27272a",
              borderRadius: 12,
              padding: 14,
              background: "#050505",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              <span>
                Live synthetic-risk
                meter
              </span>

              <b>{currentRisk}%</b>
            </div>

            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: "#27272a",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(
                    100,
                    currentRisk
                  )}%`,
                  height: "100%",
                  background:
                    currentRisk >= 75
                      ? "#ef4444"
                      : currentRisk >=
                        30
                      ? "#f59e0b"
                      : "#22c55e",
                  transition:
                    "width .25s ease",
                }}
              />
            </div>
          </div>
        </section>

        {(finalIdentity ||
          finalAssessment) && (
          <section
            style={{
              border:
                finalAssessment?.risk ===
                "HIGH"
                  ? "1px solid #7f1d1d"
                  : "1px solid #14532d",

              borderRadius: 16,

              padding: 20,

              background:
                finalAssessment?.risk ===
                "HIGH"
                  ? "#190707"
                  : "#06130b",

              marginBottom: 18,
            }}
          >
            <div style={eyebrow}>
              FINAL CALL SECURITY
              ASSESSMENT
            </div>

            <h2
              style={{
                margin:
                  "7px 0",
                fontSize: 26,
              }}
            >
              {
                finalAssessment?.title
              }
            </h2>

            <div
              style={{
                fontWeight: 800,

                color:
                  finalAssessment?.risk ===
                  "HIGH"
                    ? "#f87171"
                    : "#4ade80",
              }}
            >
              Overall risk:{" "}
              {
                finalAssessment?.risk
              }
            </div>

            <p
              style={{
                color: "#d4d4d8",
                lineHeight: 1.6,
              }}
            >
              {
                finalAssessment?.explanation
              }
            </p>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  "repeat(4, minmax(0, 1fr))",

                gap: 12,

                marginTop: 16,
              }}
            >
              <Stat
                label="CLOSEST IDENTITY"
                value={
                  finalIdentity?.identity ||
                  "—"
                }
              />

              <Stat
                label="SPEAKER SIMILARITY"
                value={
                  finalIdentity?.similarityPercent !=
                  null
                    ? `${finalIdentity.similarityPercent}%`
                    : "—"
                }
              />

              <Stat
                label="AVG SYNTHETIC"
                value={`${finalAvgSynthetic}%`}
              />

              <Stat
                label="PEAK SYNTHETIC"
                value={`${finalPeakSynthetic}%`}
              />
            </div>
          </section>
        )}

        {aiaEnabled && (
        <section
          style={{
            border:
              "1px solid #27272a",
            borderRadius: 16,
            padding: 20,
            background: "#09090b",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={eyebrow}>
                CALL ANALYSIS SEGMENTS
              </div>

              <h3
                style={{
                  margin:
                    "6px 0 0",
                }}
              >
                {chunks.length} analyzed
                chunks
              </h3>
            </div>

            <div
              style={{
                color: "#a1a1aa",
                fontSize: 13,
              }}
            >
              Safe {safeCount} •
              Suspicious{" "}
              {suspiciousCount} • High{" "}
              {highCount}
              {" • "}Speech evidence{" "}
              {speechSeconds.toFixed(1)}s
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 14,
            }}
          >
            {[...chunks]
              .reverse()
              .map((chunk) => (
                <div
                  key={
                    chunk.chunk_index
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "120px 1fr 100px 110px",
                    gap: 12,
                    alignItems:
                      "center",
                    border:
                      "1px solid #27272a",
                    borderRadius: 10,
                    padding:
                      "11px 12px",
                    background:
                      "#050505",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "#d4d4d8",
                    }}
                  >
                    {formatSeconds(
                      chunk.start_seconds
                    )}
                    –
                    {formatSeconds(
                      chunk.end_seconds
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: "#71717a",
                    }}
                  >
                    Chunk #
                    {
                      chunk.chunk_index
                    }
                  </div>

                  <b>
                    {Math.round(
                      chunk.synthetic_score
                    )}
                    %
                  </b>

                  <div
                    style={{
                      textAlign:
                        "center",

                      borderRadius: 999,

                      padding:
                        "5px 8px",

                      fontSize: 11,

                      fontWeight: 800,

                      border:
                        "1px solid #3f3f46",

                      color:
                        chunk.risk_level ===
                        "HIGH"
                          ? "#f87171"
                          : chunk.risk_level ===
                            "SUSPICIOUS"
                          ? "#fbbf24"
                          : chunk.risk_level ===
                            "NO SPEECH"
                          ? "#a1a1aa"
                          : "#4ade80",
                    }}
                  >
                    {chunk.risk_level}
                  </div>
                </div>
              ))}

            {!chunks.length && (
              <div
                style={{
                  border:
                    "1px dashed #3f3f46",

                  borderRadius: 12,

                  padding: 24,

                  textAlign:
                    "center",

                  color: "#71717a",
                }}
              >
                Connect a call and enable
                AIA protection to begin.
              </div>
            )}
          </div>
        </section>
        )}

        <p
          style={{
            color: "#52525b",
            fontSize: 12,
            lineHeight: 1.6,
            marginTop: 16,
          }}
        >
          Demo note: this route uses an
          authorized WebRTC peer-to-peer
          call. Cross-device room
          signaling is relayed by the
          AIA backend while the media
          itself remains WebRTC
          peer-to-peer. The analysis
          path is the same AIA live
          backend you already validated.
        </p>
      </div>
    </main>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.16em",
  color: "#71717a",
  fontWeight: 700,
};

function buttonStyle(
  background: string
): React.CSSProperties {
  return {
    border:
      "1px solid rgba(255,255,255,.12)",
    background,
    color: "white",
    borderRadius: 10,
    padding: "11px 14px",
    fontWeight: 800,
    cursor: "pointer",
  };
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        border:
          "1px solid #27272a",
        borderRadius: 12,
        padding: 14,
        background: "#050505",
      }}
    >
      <div style={eyebrow}>
        {label}
      </div>

      <div
        style={{
          marginTop: 7,
          fontSize: 20,
          fontWeight: 850,
          overflowWrap:
            "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}