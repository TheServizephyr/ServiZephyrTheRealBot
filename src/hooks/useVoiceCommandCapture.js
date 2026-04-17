import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function isLocalhostHost(hostname = '') {
    const normalized = String(hostname || '').trim().toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isVoiceCaptureContextSecure() {
    if (typeof window === 'undefined') return true;
    if (window.isSecureContext) return true;
    return isLocalhostHost(window.location?.hostname);
}

async function probeMicrophoneDeviceAccess() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        return {
            ok: false,
            status: 'unavailable',
            errorName: 'NotSupportedError',
            message: 'Browser microphone APIs are unavailable.',
        };
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
            },
        });
        stream.getTracks().forEach((track) => track.stop());
        return {
            ok: true,
            status: 'granted',
            errorName: '',
            message: 'Microphone device access is available.',
        };
    } catch (error) {
        return {
            ok: false,
            status: 'denied',
            errorName: String(error?.name || 'UnknownError'),
            message: String(error?.message || 'Microphone device access failed.'),
        };
    }
}

function getCaptureErrorMessage(error = null) {
    const name = String(error?.name || '').trim();
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Microphone access blocked hai. Browser site permission aur system privacy settings check karo.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Mic device busy hai. Kisi aur app ne microphone hold kiya hua ho sakta hai.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'Mic device nahi mil raha. Ek working microphone connect karke phir try karo.';
    }
    return String(error?.message || 'Voice capture start nahi ho paaya.');
}

function getBestRecordingMimeType() {
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
        return '';
    }

    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];

    return candidates.find((candidate) => window.MediaRecorder.isTypeSupported?.(candidate)) || '';
}

function computeRms(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
    }
    return Math.sqrt(sum / Math.max(dataArray.length, 1));
}

export function useVoiceCommandCapture({
    onSegmentReady,
    onDebugEvent,
    silenceDurationMs = 850,
    minSpeechDurationMs = 320,
    maxSegmentDurationMs = 7000,
    baseSpeechThreshold = 0.028,
    keepDeviceWarmMs = 0,
} = {}) {
    const onSegmentReadyRef = useRef(onSegmentReady);
    const onDebugEventRef = useRef(onDebugEvent);
    const streamRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const sourceRef = useRef(null);
    const analyserBufferRef = useRef(null);
    const animationFrameRef = useRef(null);
    const chunksRef = useRef([]);
    const continueListeningRef = useRef(false);
    const isListeningRef = useRef(false);
    const noiseFloorRef = useRef(0.008);
    const speechThresholdRef = useRef(baseSpeechThreshold);
    const calibrationEndsAtRef = useRef(0);
    const hasSpeechRef = useRef(false);
    const lastVoiceAtRef = useRef(0);
    const segmentStartedAtRef = useRef(0);
    const pendingUploadsRef = useRef(0);
    const uploadChainRef = useRef(Promise.resolve());
    const warmCleanupTimeoutRef = useRef(null);

    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [error, setError] = useState('');
    const [permissionState, setPermissionState] = useState('unknown');
    const [lastErrorCode, setLastErrorCode] = useState('');
    const [microphoneProbe, setMicrophoneProbe] = useState({
        status: 'unknown',
        errorName: '',
        message: '',
    });

    useEffect(() => {
        onSegmentReadyRef.current = onSegmentReady;
    }, [onSegmentReady]);

    useEffect(() => {
        onDebugEventRef.current = onDebugEvent;
    }, [onDebugEvent]);

    useEffect(() => {
        let cancelled = false;
        async function checkPermission() {
            if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
            try {
                const status = await navigator.permissions.query({ name: 'microphone' });
                if (!cancelled) {
                    setPermissionState(status.state || 'unknown');
                }
                status.onchange = () => {
                    if (!cancelled) {
                        setPermissionState(status.state || 'unknown');
                    }
                };
            } catch {
                if (!cancelled) {
                    setPermissionState('unknown');
                }
            }
        }

        checkPermission();
        return () => {
            cancelled = true;
        };
    }, []);

    const isSupported = useMemo(() => (
        typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined' &&
        !!navigator?.mediaDevices?.getUserMedia
    ), []);

    const setListeningState = useCallback((nextValue) => {
        isListeningRef.current = nextValue;
        setIsListening(nextValue);
    }, []);

    const cleanupMediaGraph = useCallback(async () => {
        if (warmCleanupTimeoutRef.current) {
            clearTimeout(warmCleanupTimeoutRef.current);
            warmCleanupTimeoutRef.current = null;
        }

        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (sourceRef.current) {
            try {
                sourceRef.current.disconnect();
            } catch {
                // ignore disconnect errors
            }
            sourceRef.current = null;
        }

        analyserRef.current = null;
        analyserBufferRef.current = null;

        if (audioContextRef.current) {
            try {
                await audioContextRef.current.close();
            } catch {
                // ignore close failures
            }
            audioContextRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        mediaRecorderRef.current = null;
        chunksRef.current = [];
        hasSpeechRef.current = false;
        lastVoiceAtRef.current = 0;
        segmentStartedAtRef.current = 0;
    }, []);

    const scheduleWarmCleanup = useCallback(() => {
        if (!(Number(keepDeviceWarmMs) > 0)) {
            void cleanupMediaGraph();
            return;
        }

        if (warmCleanupTimeoutRef.current) {
            clearTimeout(warmCleanupTimeoutRef.current);
        }

        warmCleanupTimeoutRef.current = setTimeout(() => {
            warmCleanupTimeoutRef.current = null;
            void cleanupMediaGraph();
        }, Number(keepDeviceWarmMs));
    }, [cleanupMediaGraph, keepDeviceWarmMs]);

    const runMicrophoneProbe = useCallback(async () => {
        const result = await probeMicrophoneDeviceAccess();
        setMicrophoneProbe({
            status: result.status,
            errorName: result.errorName,
            message: result.message,
        });
        if (result.ok) {
            setPermissionState('granted');
        } else if (result.status === 'denied') {
            setPermissionState('denied');
        }
        return result;
    }, []);

    const emitDebugEvent = useCallback((type, detail = {}) => {
        onDebugEventRef.current?.({
            type,
            at: Date.now(),
            ...detail,
        });
    }, []);

    const enqueueUpload = useCallback((audioBlob) => {
        if (!(audioBlob instanceof Blob)) {
            emitDebugEvent('segment-dropped', {
                reason: 'missing-audio',
                size: 0,
                mimeType: '',
            });
            return;
        }

        if (audioBlob.size < 1024) {
            emitDebugEvent('segment-dropped', {
                reason: 'audio-too-small',
                size: audioBlob.size,
                mimeType: audioBlob.type || 'audio/webm',
            });
            return;
        }

        emitDebugEvent('segment-queued', {
            size: audioBlob.size,
            mimeType: audioBlob.type || 'audio/webm',
        });

        pendingUploadsRef.current += 1;
        setIsTranscribing(true);

        uploadChainRef.current = uploadChainRef.current
            .catch(() => undefined)
            .then(async () => {
                try {
                    await onSegmentReadyRef.current?.(audioBlob, {
                        mimeType: audioBlob.type || 'audio/webm',
                        size: audioBlob.size,
                    });
                } catch (uploadError) {
                    emitDebugEvent('segment-upload-error', {
                        message: String(uploadError?.message || 'Voice segment transcribe nahi ho paaya.'),
                    });
                    setLastErrorCode('transcribe-error');
                    setError(String(uploadError?.message || 'Voice segment transcribe nahi ho paaya.'));
                } finally {
                    pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1);
                    if (pendingUploadsRef.current === 0) {
                        setIsTranscribing(false);
                    }
                }
            });
    }, [emitDebugEvent]);

    const beginRecorderSegment = useCallback(() => {
        if (!streamRef.current || !isListeningRef.current) return false;

        const mimeType = getBestRecordingMimeType();
        const recorder = mimeType
            ? new MediaRecorder(streamRef.current, { mimeType })
            : new MediaRecorder(streamRef.current);

        chunksRef.current = [];
        hasSpeechRef.current = false;
        lastVoiceAtRef.current = 0;
        segmentStartedAtRef.current = Date.now();

        recorder.ondataavailable = (event) => {
            if (event.data?.size > 0) {
                chunksRef.current.push(event.data);
            }
        };

        recorder.onstop = () => {
            const blob = chunksRef.current.length > 0
                ? new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
                : null;
            const shouldContinue = continueListeningRef.current && isListeningRef.current;
            const hadSpeech = hasSpeechRef.current;
            chunksRef.current = [];

            if (blob && hadSpeech) {
                enqueueUpload(blob);
            } else if (!hadSpeech) {
                emitDebugEvent('segment-dropped', {
                    reason: 'no-speech-detected',
                    size: Number(blob?.size || 0),
                    mimeType: recorder.mimeType || mimeType || 'audio/webm',
                });
            } else if (!blob) {
                emitDebugEvent('segment-dropped', {
                    reason: 'empty-segment',
                    size: 0,
                    mimeType: recorder.mimeType || mimeType || 'audio/webm',
                });
            }

            if (shouldContinue && streamRef.current) {
                beginRecorderSegment();
                return;
            }

            scheduleWarmCleanup();
        };

        recorder.onerror = (event) => {
            setLastErrorCode(String(event?.error?.name || event?.name || 'recording-error').toLowerCase());
            setError('Voice recorder me problem aayi. Mic ko dubara start karo.');
            continueListeningRef.current = false;
            setListeningState(false);
            void cleanupMediaGraph();
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        return true;
    }, [cleanupMediaGraph, emitDebugEvent, enqueueUpload, scheduleWarmCleanup, setListeningState]);

    const finalizeCurrentSegment = useCallback((shouldContinue) => {
        continueListeningRef.current = shouldContinue;
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            try {
                recorder.stop();
                return;
            } catch {
                // fall through to cleanup
            }
        }

        if (!shouldContinue) {
            setListeningState(false);
            void cleanupMediaGraph();
        } else {
            beginRecorderSegment();
        }
    }, [beginRecorderSegment, cleanupMediaGraph, setListeningState]);

    const monitorSpeech = useCallback(() => {
        if (!isListeningRef.current || !analyserRef.current || !analyserBufferRef.current) {
            return;
        }

        const analyser = analyserRef.current;
        const buffer = analyserBufferRef.current;
        analyser.getByteTimeDomainData(buffer);

        const rms = computeRms(buffer);
        const now = Date.now();

        if (now < calibrationEndsAtRef.current && !hasSpeechRef.current) {
            noiseFloorRef.current = (noiseFloorRef.current * 0.85) + (rms * 0.15);
        } else if (!hasSpeechRef.current && rms < speechThresholdRef.current) {
            noiseFloorRef.current = (noiseFloorRef.current * 0.92) + (rms * 0.08);
        }

        speechThresholdRef.current = Math.max(baseSpeechThreshold, noiseFloorRef.current * 3.1);
        const isSpeechFrame = rms >= speechThresholdRef.current;

        if (isSpeechFrame) {
            if (!hasSpeechRef.current) {
                emitDebugEvent('speech-detected', {
                    rms,
                    threshold: speechThresholdRef.current,
                });
            }
            hasSpeechRef.current = true;
            lastVoiceAtRef.current = now;
        }

        const segmentAge = segmentStartedAtRef.current ? (now - segmentStartedAtRef.current) : 0;
        const silenceAge = lastVoiceAtRef.current ? (now - lastVoiceAtRef.current) : 0;
        const recorder = mediaRecorderRef.current;

        if (
            recorder &&
            recorder.state === 'recording' &&
            hasSpeechRef.current &&
            segmentAge >= minSpeechDurationMs &&
            silenceAge >= silenceDurationMs
        ) {
            finalizeCurrentSegment(true);
            return;
        }

        if (recorder && recorder.state === 'recording' && segmentAge >= maxSegmentDurationMs) {
            finalizeCurrentSegment(true);
            return;
        }

        animationFrameRef.current = requestAnimationFrame(monitorSpeech);
    }, [baseSpeechThreshold, emitDebugEvent, finalizeCurrentSegment, maxSegmentDurationMs, minSpeechDurationMs, silenceDurationMs]);

    const startListening = useCallback(async () => {
        if (!isSupported) {
            setError('Voice billing is not supported in this browser.');
            return false;
        }

        if (!isVoiceCaptureContextSecure()) {
            setError('Voice billing ke liye HTTPS ya localhost secure context chahiye.');
            return false;
        }

        setError('');
        setLastErrorCode('');

        try {
            if (warmCleanupTimeoutRef.current) {
                clearTimeout(warmCleanupTimeoutRef.current);
                warmCleanupTimeoutRef.current = null;
            }

            if (streamRef.current && audioContextRef.current && analyserRef.current && sourceRef.current) {
                try {
                    if (audioContextRef.current.state === 'suspended') {
                        await audioContextRef.current.resume();
                    }
                } catch {
                    // ignore resume errors and continue with existing graph
                }

                noiseFloorRef.current = 0.008;
                speechThresholdRef.current = baseSpeechThreshold;
                calibrationEndsAtRef.current = Date.now() + 900;
                continueListeningRef.current = true;
                setPermissionState('granted');
                setListeningState(true);
                emitDebugEvent('stream-reused', {
                    keepWarmMs: Number(keepDeviceWarmMs || 0),
                });

                beginRecorderSegment();
                animationFrameRef.current = requestAnimationFrame(monitorSpeech);
                return true;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
            });

            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) {
                throw new Error('AudioContext is not supported in this browser.');
            }

            const audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.82;
            source.connect(analyser);

            streamRef.current = stream;
            audioContextRef.current = audioContext;
            sourceRef.current = source;
            analyserRef.current = analyser;
            analyserBufferRef.current = new Uint8Array(analyser.fftSize);

            noiseFloorRef.current = 0.008;
            speechThresholdRef.current = baseSpeechThreshold;
            calibrationEndsAtRef.current = Date.now() + 900;
            continueListeningRef.current = true;
            setPermissionState('granted');
            setListeningState(true);
            emitDebugEvent('stream-opened', {
                keepWarmMs: Number(keepDeviceWarmMs || 0),
            });

            beginRecorderSegment();
            animationFrameRef.current = requestAnimationFrame(monitorSpeech);
            return true;
        } catch (captureError) {
            emitDebugEvent('capture-error', {
                message: getCaptureErrorMessage(captureError),
                errorName: String(captureError?.name || 'capture-error'),
            });
            setPermissionState('denied');
            setLastErrorCode(String(captureError?.name || 'capture-error').toLowerCase());
            setError(getCaptureErrorMessage(captureError));
            setListeningState(false);
            return false;
        }
    }, [baseSpeechThreshold, beginRecorderSegment, emitDebugEvent, isSupported, keepDeviceWarmMs, monitorSpeech, setListeningState]);

    const stopListening = useCallback(() => {
        continueListeningRef.current = false;
        setListeningState(false);
        finalizeCurrentSegment(false);
    }, [finalizeCurrentSegment, setListeningState]);

    const toggleListening = useCallback(async () => {
        if (isListeningRef.current) {
            stopListening();
            return false;
        }
        return startListening();
    }, [startListening, stopListening]);

    useEffect(() => () => {
        continueListeningRef.current = false;
        setListeningState(false);
        void cleanupMediaGraph();
    }, [cleanupMediaGraph, setListeningState]);

    return {
        isSupported,
        isListening,
        isTranscribing,
        error,
        permissionState,
        lastErrorCode,
        microphoneProbe,
        startListening,
        stopListening,
        toggleListening,
        runMicrophoneProbe,
        clearError: () => setError(''),
    };
}
