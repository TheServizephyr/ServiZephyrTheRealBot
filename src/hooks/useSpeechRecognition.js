import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function getSpeechRecognitionCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isLocalhostHost(hostname = '') {
    const normalized = String(hostname || '').trim().toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isSpeechRecognitionContextSecure() {
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

function getRecognitionErrorMessage(errorCode = '', fallbackMessage = '') {
    const normalizedCode = String(errorCode || '').trim().toLowerCase();

    if (normalizedCode === 'not-allowed' || normalizedCode === 'service-not-allowed') {
        return 'Microphone access blocked hai. Browser site permission aur system privacy settings check karo.';
    }
    if (normalizedCode === 'audio-capture') {
        return 'Mic device nahi mil raha ya kisi aur app ne use lock kar rakha hai.';
    }
    if (normalizedCode === 'network') {
        return 'Voice recognition service abhi response nahi de rahi. Thodi der baad phir try karo.';
    }
    if (normalizedCode === 'no-speech' || normalizedCode === 'aborted') {
        return '';
    }

    const fallback = String(fallbackMessage || '').trim();
    return fallback || (normalizedCode ? `Voice capture error: ${normalizedCode.replace(/-/g, ' ')}` : 'Voice recognition could not start.');
}

export function useSpeechRecognition({
    lang = 'en-IN',
    onFinalResult,
} = {}) {
    const recognitionRef = useRef(null);
    const onFinalResultRef = useRef(onFinalResult);
    const shouldRestartRef = useRef(false);
    const manuallyStoppedRef = useRef(false);
    const langRef = useRef(lang);

    const [interimTranscript, setInterimTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState('');
    const [permissionState, setPermissionState] = useState('unknown');
    const [lastErrorCode, setLastErrorCode] = useState('');
    const [microphoneProbe, setMicrophoneProbe] = useState({
        status: 'unknown',
        errorName: '',
        message: '',
    });

    useEffect(() => {
        langRef.current = lang;
    }, [lang]);

    useEffect(() => {
        onFinalResultRef.current = onFinalResult;
    }, [onFinalResult]);

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

    const isSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

    const stopListening = useCallback(() => {
        manuallyStoppedRef.current = true;
        shouldRestartRef.current = false;
        setInterimTranscript('');
        try {
            recognitionRef.current?.stop();
        } catch {
            // Ignore stop failures from already-closed recognizers
        }
        setIsListening(false);
    }, []);

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

    const ensureRecognition = useCallback(() => {
        if (recognitionRef.current) return recognitionRef.current;
        const SpeechRecognitionCtor = getSpeechRecognitionCtor();
        if (!SpeechRecognitionCtor) return null;

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        recognition.lang = langRef.current || 'en-IN';

        recognition.onstart = () => {
            setError('');
            setIsListening(true);
            setPermissionState('granted');
        };

        recognition.onresult = (event) => {
            let nextInterim = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcript = String(event.results[i]?.[0]?.transcript || '').trim();
                if (!transcript) continue;
                if (event.results[i].isFinal) {
                    const alternatives = Array.from(event.results[i] || [])
                        .map((alternative) => ({
                            transcript: String(alternative?.transcript || '').trim(),
                            confidence: Number(alternative?.confidence || 0),
                        }))
                        .filter((alternative) => alternative.transcript);

                    onFinalResultRef.current?.(transcript, {
                        confidence: Number(event.results[i]?.[0]?.confidence || 0),
                        alternatives,
                    });
                } else {
                    nextInterim = `${nextInterim} ${transcript}`.trim();
                }
            }
            setInterimTranscript(nextInterim);
        };

        recognition.onerror = (event) => {
            const errorCode = String(event?.error || '').trim().toLowerCase();
            setLastErrorCode(errorCode);
            if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
                void runMicrophoneProbe().then((probe) => {
                    if (probe?.ok) {
                        const serviceBlockedMessage = errorCode === 'service-not-allowed'
                            ? 'Mic allowed hai, lekin browser speech recognition service blocked ya disabled lag rahi hai.'
                            : 'Mic allowed hai, lekin browser ne speech recognition request reject kar di.';
                        setError(`${serviceBlockedMessage} Chrome ya Edge stable me test karo.`);
                        return;
                    }
                    setPermissionState('denied');
                    setError('Microphone access blocked hai. Browser site permission aur system privacy settings check karo.');
                });
                return;
            }

            const message = getRecognitionErrorMessage(errorCode, event?.message);
            if (message) {
                setError(message);
            }
        };

        recognition.onend = () => {
            setInterimTranscript('');
            setIsListening(false);
            if (!manuallyStoppedRef.current && shouldRestartRef.current) {
                try {
                    recognition.lang = langRef.current || 'en-IN';
                    recognition.start();
                } catch {
                    setError('Voice recognition could not restart automatically.');
                }
            }
        };

        recognitionRef.current = recognition;
        return recognition;
    }, [runMicrophoneProbe]);

    const startListening = useCallback(() => {
        if (!isSupported) {
            setError('Voice recognition is not supported in this browser.');
            return false;
        }

        if (!isSpeechRecognitionContextSecure()) {
            setError('Voice billing ke liye HTTPS ya localhost secure context chahiye.');
            return false;
        }

        const recognition = ensureRecognition();
        if (!recognition) {
            setError('Voice recognition is not available right now.');
            return false;
        }

        manuallyStoppedRef.current = false;
        shouldRestartRef.current = true;
        setError('');
        setLastErrorCode('');
        setInterimTranscript('');

        try {
            recognition.lang = langRef.current || 'en-IN';
            recognition.start();
            return true;
        } catch (startError) {
            const message = String(startError?.message || '');
            if (!message.toLowerCase().includes('already started')) {
                setError(getRecognitionErrorMessage('', message));
                setIsListening(false);
                return false;
            }
            return true;
        }
    }, [ensureRecognition, isSupported]);

    const toggleListening = useCallback(async () => {
        if (isListening) {
            stopListening();
            return false;
        }
        return startListening();
    }, [isListening, startListening, stopListening]);

    useEffect(() => () => {
        shouldRestartRef.current = false;
        manuallyStoppedRef.current = true;
        try {
            recognitionRef.current?.stop();
        } catch {
            // ignore
        }
    }, []);

    return {
        isSupported,
        isListening,
        interimTranscript,
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
