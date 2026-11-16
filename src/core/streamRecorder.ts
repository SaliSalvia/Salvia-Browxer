import { apiUrl } from './nativeBridge';

/**
 * Real playback capture for `blob:`/MSE streams that can never be fetched as a file.
 *
 * The media is played through the same-origin proxy (`/api/media/fetch`), so the
 * element is not cross-origin tainted and `captureStream()` is allowed. Nothing is
 * fabricated: if the runtime or the stream cannot be captured, the caller gets a
 * `null` handle and reports an honest failure instead of inventing a file.
 */
export interface StreamRecorderHandle {
  readonly mimeType: string;
  stop: () => Promise<{ blob: Blob; mimeType: string } | null>;
  cancel: () => void;
}

interface StartOptions {
  onBytes: (bytes: number) => void;
  referer?: string | null;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

const HIDDEN_STYLE = [
  'position:fixed',
  'left:-2px',
  'top:-2px',
  'width:2px',
  'height:2px',
  'opacity:0',
  'pointer-events:none',
].join(';');

type CaptureCapableElement = HTMLVideoElement & {
  captureStream?: (frameRequestRate?: number) => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function captureStreamOf(element: CaptureCapableElement): MediaStream | null {
  if (typeof element.captureStream === 'function') return element.captureStream(30);
  if (typeof element.mozCaptureStream === 'function') return element.mozCaptureStream();
  return null;
}

export function isStreamRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const Recorder = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (typeof Recorder !== 'function') return false;
  return typeof (HTMLMediaElement.prototype as CaptureCapableElement).captureStream === 'function';
}

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      reject(new Error('Media element failed to load'));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

export async function startStreamRecording(
  mediaUrl: string,
  options: StartOptions
): Promise<StreamRecorderHandle | null> {
  if (!isStreamRecordingSupported()) return null;

  const element = document.createElement('video') as CaptureCapableElement;
  element.muted = true;
  element.defaultMuted = true;
  element.playsInline = true;
  element.preload = 'auto';
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('style', HIDDEN_STYLE);

  const referer = options.referer ? `&referer=${encodeURIComponent(options.referer)}` : '';
  element.src = apiUrl(`/api/media/fetch?url=${encodeURIComponent(mediaUrl)}${referer}`);
  document.body.appendChild(element);

  const cleanup = () => {
    element.pause();
    element.removeAttribute('src');
    element.load();
    if (element.parentNode) element.parentNode.removeChild(element);
  };

  try {
    await waitForEvent(element, 'loadedmetadata', 20000);
  } catch {
    cleanup();
    return null;
  }

  const stream = captureStreamOf(element);
  if (!stream) {
    cleanup();
    return null;
  }

  const mimeType =
    MIME_CANDIDATES.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch {
        return false;
      }
    }) ?? '';

  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    cleanup();
    return null;
  }

  const chunks: Blob[] = [];
  let bytes = 0;
  let finished = false;

  recorder.addEventListener('dataavailable', (event: BlobEvent) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
      bytes += event.data.size;
      options.onBytes(bytes);
    }
  });

  try {
    recorder.start(1000);
    await element.play();
  } catch {
    try {
      recorder.stop();
    } catch {
      // ignore
    }
    cleanup();
    return null;
  }

  const stop = (): Promise<{ blob: Blob; mimeType: string } | null> =>
    new Promise((resolve) => {
      if (finished) {
        resolve(null);
        return;
      }
      finished = true;
      const finalize = () => {
        cleanup();
        if (chunks.length === 0 || bytes === 0) {
          resolve(null);
          return;
        }
        const outputMime = recorder.mimeType || mimeType || 'video/webm';
        resolve({ blob: new Blob(chunks, { type: outputMime }), mimeType: outputMime });
      };
      recorder.addEventListener('stop', finalize, { once: true });
      try {
        recorder.requestData();
        recorder.stop();
      } catch {
        finalize();
      }
    });

  const cancel = () => {
    if (finished) return;
    finished = true;
    try {
      recorder.stop();
    } catch {
      // ignore
    }
    cleanup();
  };

  return { mimeType: recorder.mimeType || mimeType, stop, cancel };
}
