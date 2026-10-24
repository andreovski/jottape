import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Ditado do pedido. Com transcrição no servidor, grava o áudio (MediaRecorder) e manda; sem ela, usa
// o reconhecimento de voz do navegador (Chrome e Safari). Sem nenhum dos dois, o botão some e fica o
// ditado do teclado do celular.

/** Um pedido falado não passa disso. */
export const MAX_SECONDS = 60;

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

/** O que cada erro do reconhecimento de voz quer dizer, para o usuário saber o que fazer. */
const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Permita o microfone para ditar o pedido.',
  'service-not-allowed':
    'O navegador não liberou o reconhecimento de voz (no Safari do Mac, ele depende da Siri ligada). Use o ditado do teclado ou escreva o pedido.',
  network:
    'O reconhecimento de voz deste navegador não respondeu (no Brave e em alguns navegadores ele não existe). Tente no Chrome ou no Safari, ou escreva o pedido.',
  'audio-capture': 'Nenhum microfone encontrado.',
  'language-not-supported': 'Este navegador não reconhece voz em português.',
};

const canRecord = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export type VoiceMode = 'server' | 'browser' | null;

export function voiceMode(serverTranscription: boolean): VoiceMode {
  if (serverTranscription && canRecord()) return 'server';
  if (speechRecognition()) return 'browser';
  return null;
}

interface Options {
  mode: VoiceMode;
  /** Áudio gravado (modo servidor). */
  onAudio: (audio: Blob, seconds: number) => void;
  /** Texto parcial e final (modo navegador), com os segundos de fala até ali. */
  onText: (text: string, final: boolean, seconds: number) => void;
}

export function useVoice({ mode, onAudio, onText }: Options) {
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // O microfone aberto (só no modo servidor), para a onda da gravação.
  const [stream, setStream] = useState<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onAudio, onText });
  useEffect(() => {
    callbacks.current = { onAudio, onText };
  });

  // Fecha o microfone se a tela sair no meio da gravação.
  useEffect(() => () => stopRef.current?.(), []);

  async function startServer() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Permita o microfone para ditar o pedido.');
      return;
    }
    const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    let cancelled = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      clearInterval(timer);
      clearTimeout(limit);
      setListening(false);
      stopRef.current = null;
      finishRef.current = null;
      if (cancelled) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      // Toque sem querer: menos de meio segundo não vira pedido.
      if (elapsed < 0.5 || chunks.length === 0) return;
      callbacks.current.onAudio(new Blob(chunks, { type: recorder.mimeType || type }), elapsed);
    };
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    const limit = setTimeout(() => recorder.stop(), MAX_SECONDS * 1000);
    stopRef.current = () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    };
    finishRef.current = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.start();
    setSeconds(0);
    setStream(stream);
    setListening(true);
  }

  function startBrowser() {
    const Recognition = speechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    // Contínuo: uma pausa no meio da frase não encerra; o usuário toca em enviar quando acabar.
    recognition.continuous = true;
    let text = '';
    let cancelled = false;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    recognition.onresult = (event) => {
      text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join('');
      callbacks.current.onText(text, false, (Date.now() - startedAt) / 1000);
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        toast('Não ouvi nada. Toque no microfone e fale o pedido.');
        return;
      }
      toast.error(
        RECOGNITION_ERRORS[event.error] ?? 'O ditado parou. Tente de novo ou escreva o pedido.'
      );
    };
    recognition.onend = () => {
      clearInterval(timer);
      setListening(false);
      stopRef.current = null;
      finishRef.current = null;
      if (!cancelled && text.trim()) {
        callbacks.current.onText(text.trim(), true, (Date.now() - startedAt) / 1000);
      }
    };
    stopRef.current = () => {
      cancelled = true;
      recognition.stop();
    };
    finishRef.current = () => recognition.stop();
    try {
      recognition.start();
    } catch {
      clearInterval(timer);
      toast.error('O ditado não começou. Tente de novo.');
      return;
    }
    setSeconds(0);
    setListening(true);
  }

  return {
    listening,
    seconds,
    stream,
    /** Começa a ouvir. */
    start: async () => {
      if (listening || !mode) return;
      if (mode === 'server') await startServer();
      else startBrowser();
    },
    /** Para e manda o que ouviu. */
    finish: () => finishRef.current?.(),
    /** Para e joga fora. */
    cancel: () => stopRef.current?.(),
  };
}
