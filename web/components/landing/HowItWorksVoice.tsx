'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, SkipForward, Volume2 } from 'lucide-react';

type FlowStep = {
  id: string;
  title: string;
  detail: string;
  narration: string;
};

type Chapter = {
  id: string;
  title: string;
  subtitle: string;
  steps: FlowStep[];
};

const FLOW_STEPS: FlowStep[] = [
  {
    id: 'prompt',
    title: 'You Ask',
    detail: 'Write a task in plain language.',
    narration:
      'You ask Ultronios what you need in plain language — for example, fix a bug, or explain a file.',
  },
  {
    id: 'plan',
    title: 'Agent Plans',
    detail: 'Ultronios understands intent and chooses actions.',
    narration:
      'Ultronios understands your intent and plans the best actions before touching your code.',
  },
  {
    id: 'execute',
    title: 'Tools Execute',
    detail: 'It reads files, edits code, and runs commands.',
    narration:
      'The agent runs tools to read files, make updates, and execute terminal commands safely.',
  },
  {
    id: 'review',
    title: 'You Review',
    detail: 'See outputs, highlighted flow, and verify results.',
    narration:
      'You review the result, follow the highlighted flow, and decide if you want another iteration.',
  },
];

const README_STEPS: FlowStep[] = [
  {
    id: 'readme-flow',
    title: 'README Flowchart',
    detail: 'Direct run -> classify -> Claude -> fallback chain.',
    narration:
      'From the README flowchart, Ultronios first checks a direct command path, then classifies intent, then routes to Claude, and only then falls back if needed.',
  },
  {
    id: 'readme-usp',
    title: 'Core USP',
    detail: 'Autonomous coding, transparent tools, and lower cost.',
    narration:
      'The main USP is autonomous execution with clear tool visibility and lower token cost, so teams move faster with less manual steps.',
  },
  {
    id: 'readme-token',
    title: 'Token Strategy',
    detail: 'Haiku for read or run, Sonnet for write or debug.',
    narration:
      'Token usage stays low using regex classification, small tool sets, turn limits, and model routing — read and run use Haiku while write and debug use Sonnet.',
  },
  {
    id: 'readme-fallback',
    title: 'No Token Switch',
    detail: 'Automatic fallback to Ollama, Gemini, then Groq.',
    narration:
      'If Claude credits are unavailable, it switches automatically to configured fallbacks — typically Ollama first, then Gemini, then Groq.',
  },
  {
    id: 'readme-shell',
    title: 'Shell + Scripts',
    detail: 'Safe direct shell path can run with zero tokens.',
    narration:
      'For known run commands like run iOS or install pods, the direct shell path can execute locally with zero Claude tokens.',
  },
];

const CHAPTERS: Chapter[] = [
  {
    id: 'product',
    title: 'Product Flow',
    subtitle: 'How Ultronios works',
    steps: FLOW_STEPS,
  },
  {
    id: 'readme',
    title: 'README Explainer',
    subtitle: 'Flowchart, USP, tokens, fallback, and shell flow',
    steps: README_STEPS,
  },
];

// ─── Fallback: Web Speech API with best female voice ─────────────────────────

function pickFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const scored = voices
    .map((v) => {
      const n = v.name.toLowerCase();
      const l = v.lang.toLowerCase();
      let s = 0;

      if (l === 'en-us') s += 40;
      else if (l === 'en-gb') s += 38;
      else if (l.startsWith('en')) s += 30;
      else return { v, s: -1 };

      // Explicitly female voices first
      if (/google uk english female/i.test(n)) s += 80;
      if (/samantha/i.test(n)) s += 70;    // macOS Siri-quality female
      if (/karen/i.test(n)) s += 68;       // macOS AU female
      if (/victoria/i.test(n)) s += 65;    // macOS female
      if (/microsoft.*aria/i.test(n)) s += 72;  // Windows neural female
      if (/microsoft.*jenny/i.test(n)) s += 70; // Windows neural female
      if (/microsoft.*zira/i.test(n)) s += 50;  // Windows female
      if (/female/i.test(n)) s += 60;

      // Quality keywords
      if (/neural/i.test(n)) s += 50;
      if (/enhanced/i.test(n)) s += 45;
      if (/premium/i.test(n)) s += 43;
      if (/natural/i.test(n)) s += 40;
      if (/google us english/i.test(n)) s += 55;

      return { v, s };
    })
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s);

  return scored[0]?.v ?? null;
}

function speakWithFallback(
  text: string,
  voice: SpeechSynthesisVoice | null,
  onEnd: () => void,
  onError: () => void,
): void {
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.rate   = 0.88;
  utterance.pitch  = 1.05;  // slight up for more feminine tone
  utterance.volume = 1.0;
  utterance.onend  = onEnd;
  utterance.onerror = onError;
  window.speechSynthesis.speak(utterance);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HowItWorksVoice() {
  const [chapterId, setChapterId]     = useState<Chapter['id']>('product');
  const [activeStep, setActiveStep]   = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [isLoading, setIsLoading]     = useState(false);
  const [usingOpenAI, setUsingOpenAI] = useState<boolean | null>(null); // null = not checked yet

  // Fallback Web Speech state
  const [fallbackVoice, setFallbackVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [fallbackReady, setFallbackReady] = useState(false);

  const cancelledRef  = useRef(false);
  const audioRef      = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef    = useRef<string | null>(null);

  const activeChapter = useMemo(
    () => CHAPTERS.find((c) => c.id === chapterId) ?? CHAPTERS[0],
    [chapterId],
  );

  const hasSpeech = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    [],
  );

  // Load fallback Web Speech voices
  useEffect(() => {
    if (!hasSpeech) return;
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setFallbackVoice(pickFemaleVoice(voices));
        setFallbackReady(true);
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [hasSpeech]);

  // Probe whether the TTS API is available (has OPENAI_API_KEY)
  useEffect(() => {
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })
      .then((r) => setUsingOpenAI(r.status !== 503))
      .catch(() => setUsingOpenAI(false));
  }, []);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    cleanupAudio();
    if (hasSpeech) window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsLoading(false);
  }, [hasSpeech, cleanupAudio]);

  const speakStep = useCallback(
    async (index: number) => {
      cancelledRef.current = false;
      cleanupAudio();
      if (hasSpeech) window.speechSynthesis.cancel();

      const steps    = activeChapter.steps;
      const step     = steps[Math.min(index, steps.length - 1)];
      const text     = step.narration;

      const advance = () => {
        if (cancelledRef.current) return;
        const next = index + 1;
        if (next < steps.length) {
          setTimeout(() => {
            if (!cancelledRef.current) setActiveStep(next);
          }, 350);
        } else {
          setIsPlaying(false);
          setActiveStep(0);
        }
      };

      // ── OpenAI TTS path ──────────────────────────────────────────────────
      if (usingOpenAI) {
        setIsLoading(true);
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });

          if (cancelledRef.current) return;

          if (!res.ok) throw new Error(`TTS error ${res.status}`);

          const blob    = await res.blob();
          const url     = URL.createObjectURL(blob);
          blobUrlRef.current = url;

          const audio   = new Audio(url);
          audioRef.current = audio;
          setIsLoading(false);

          audio.onended = advance;
          audio.onerror = () => { setIsLoading(false); advance(); };
          await audio.play();
        } catch {
          if (!cancelledRef.current) {
            setIsLoading(false);
            advance();
          }
        }
        return;
      }

      // ── Fallback: Web Speech API ─────────────────────────────────────────
      if (hasSpeech && fallbackReady) {
        speakWithFallback(text, fallbackVoice, advance, () => setIsPlaying(false));
      }
    },
    [usingOpenAI, hasSpeech, fallbackReady, fallbackVoice, activeChapter.steps, cleanupAudio],
  );

  const start = useCallback(() => {
    if (usingOpenAI === null) return; // still probing
    setIsPlaying(true);
  }, [usingOpenAI]);

  const nextStep = useCallback(() => {
    const next = (activeStep + 1) % activeChapter.steps.length;
    setActiveStep(next);
    if (isPlaying) speakStep(next);
  }, [activeStep, isPlaying, speakStep, activeChapter.steps.length]);

  useEffect(() => {
    if (!isPlaying) return;
    speakStep(activeStep);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, isPlaying]);

  useEffect(() => { return () => { stop(); }; }, [stop]);

  const voiceLabel = usingOpenAI
    ? 'OpenAI · Nova (neural female)'
    : fallbackVoice
      ? fallbackVoice.name.replace(/\s*\(.*?\)/, '').trim()
      : null;

  const canPlay = usingOpenAI !== null && (usingOpenAI || (hasSpeech && fallbackReady));

  return (
    <section className="w-full max-w-5xl mt-5 md:mt-6 pointer-events-auto">
      <div className="landing-flow-card p-3 md:p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="landing-kicker text-[10px] tracking-[0.24em] uppercase mb-1">
              Guided Tour
            </p>
            <h3 className="text-base md:text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {activeChapter.title}
            </h3>
            <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {activeChapter.subtitle}
            </p>
            {voiceLabel && (
              <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                🎙 {voiceLabel}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg p-0.5 w-full sm:w-auto" style={{ border: '1px solid var(--border)' }}>
              {CHAPTERS.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => {
                    stop();
                    setChapterId(chapter.id);
                    setActiveStep(0);
                  }}
                  className={`landing-flow-btn flex-1 sm:flex-none justify-center ${chapterId === chapter.id ? 'is-selected' : ''}`}
                  title={chapter.title}
                >
                  {chapter.id === 'product' ? 'Product' : 'README'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={isPlaying ? stop : start}
              disabled={!canPlay || isLoading}
              className="landing-flow-btn flex-1 sm:flex-none justify-center"
              title={isPlaying ? 'Pause narration' : 'Play narration'}
            >
              {isLoading
                ? <Loader2 size={15} className="animate-spin" />
                : isPlaying
                  ? <Pause size={15} />
                  : <Play size={15} />}
              {isLoading ? 'Loading…' : isPlaying ? 'Pause' : 'Play voice'}
            </button>
            <button
              type="button"
              onClick={nextStep}
              className="landing-flow-btn flex-1 sm:flex-none justify-center"
              title="Go to next step"
            >
              <SkipForward size={15} />
              Next
            </button>
          </div>
        </div>

        <div className={`mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 ${activeChapter.id === 'readme' ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
          {activeChapter.steps.map((step, idx) => {
            const active = idx === activeStep;
            return (
              <div
                key={step.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveStep(idx);
                  if (isPlaying) speakStep(idx);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveStep(idx);
                    if (isPlaying) speakStep(idx);
                  }
                }}
                className={`landing-flow-step cursor-pointer ${active ? 'is-active' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    0{idx + 1}
                  </span>
                  {active && (isPlaying || isLoading) && (
                    <span className="text-[11px] flex items-center gap-1 text-indigo-300">
                      {isLoading
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Volume2 size={12} className="animate-pulse" />}
                      {isLoading ? 'loading' : 'speaking'}
                    </span>
                  )}
                </div>
                <h4 className="mt-1 text-xs md:text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {step.title}
                </h4>
                <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>
                  {step.detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
