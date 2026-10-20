import { getTranscriptionConfig } from '@/lib/env';

// Áudio do microfone para texto, pela API da OpenAI. O app manda o arquivo como veio do
// MediaRecorder (webm no Chrome, mp4 no Safari).

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

const EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
};

export const AUDIO_TYPES = Object.keys(EXTENSION);

export async function transcribe(audio: Buffer, contentType: string): Promise<string> {
  const config = getTranscriptionConfig();
  if (!config) throw new Error('OPENAI_API_KEY não configurada');

  const type = contentType.split(';')[0].trim();
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `pedido.${EXTENSION[type] ?? 'webm'}`);
  form.append('model', config.model);
  form.append('language', 'pt');
  form.append('response_format', 'json');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`transcrição ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}
