/**
 * Turning whatever the mint flow produced — a File, a data: URL or an absolute
 * http(s) URL — into the ImagePart values the providers accept.
 *
 * This and client.ts are the only impure modules in src/ai, so everything that
 * can be pure (the data-URL split, the base64 codec, the size arithmetic) is
 * exported separately and tested without a browser. No React, no antd, no
 * settings access.
 */

import { ImagePart, InlineImagePart, aiError, isAiError } from './types';

/** Both providers reject inline images well above this; 4 MB of base64 is
 *  already a ~5.4 MB request line. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]*)$/;

/** btoa is fed one chunk at a time. Spreading a whole image's bytes into
 *  String.fromCharCode overflows the argument stack under the es5 target. */
const CHUNK_SIZE = 0x8000;

const READ_FAILED =
  'Could not read the image from that URL (the host may not allow ' +
  'cross-origin reads). Upload the file instead, or switch to OpenAI.';

export function isDataUrl(s: string): boolean {
  return DATA_URL_RE.test(s);
}

export function splitDataUrl(s: string): { mimeType: string; base64: string } {
  const m = DATA_URL_RE.exec(s);
  if (!m) {
    throw aiError('image', 'That image is not a base64 data URL.');
  }
  return { mimeType: m[1], base64: m[2] };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, bytes.length);
    const chunk: number[] = [];
    for (let i = start; i < end; i++) {
      chunk.push(bytes[i]);
    }
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) {
    return 0;
  }
  let padding = 0;
  if (b64.charAt(len - 1) === '=') {
    padding++;
  }
  if (b64.charAt(len - 2) === '=') {
    padding++;
  }
  return Math.floor((len * 3) / 4) - padding;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(aiError('image', 'That file could not be read as an image.'));
      }
    };
    reader.onerror = () =>
      reject(aiError('image', 'That file could not be read as an image.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize to fit maxEdgePx and re-encode as JPEG. Every failure path — no
 * canvas (jsdom), a decode error, a tainted canvas — resolves with the input
 * unchanged: a failed resize must degrade to sending the original bytes, never
 * to failing the run. This function never rejects.
 */
export function downscaleDataUrl(
  dataUrl: string,
  maxEdgePx: number,
): Promise<string> {
  return new Promise<string>(resolve => {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      if (
        maxEdgePx <= 0 ||
        typeof document === 'undefined' ||
        typeof Image === 'undefined'
      ) {
        resolve(dataUrl);
        return;
      }
      canvas = document.createElement('canvas');
      // Probed before the image is loaded, not inside onload: an environment
      // without a canvas is also one where the load event may never arrive, and
      // this promise must not hang waiting for it.
      ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.toDataURL !== 'function') {
        resolve(dataUrl);
        return;
      }
    } catch (e) {
      resolve(dataUrl);
      return;
    }

    const target = canvas;
    const context = ctx;
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          const longest = Math.max(w, h);
          if (longest <= 0 || longest <= maxEdgePx) {
            resolve(dataUrl);
            return;
          }
          const scale = maxEdgePx / longest;
          target.width = Math.max(1, Math.round(w * scale));
          target.height = Math.max(1, Math.round(h * scale));
          context.drawImage(img, 0, 0, target.width, target.height);
          resolve(target.toDataURL('image/jpeg', 0.9));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (e) {
      resolve(dataUrl);
    }
  });
}

export function resolveImage(
  source: string | File,
  label: string,
  opts: {
    maxEdgePx: number;
    supportsRemoteImageUrl: boolean;
    fetchImpl?: typeof fetch;
  },
): Promise<ImagePart> {
  if (typeof File !== 'undefined' && source instanceof File) {
    return fileToDataUrl(source)
      .then(dataUrl => downscaleDataUrl(dataUrl, opts.maxEdgePx))
      .then(resized => inlineFromDataUrl(resized, label));
  }

  if (typeof source === 'string') {
    if (isDataUrl(source)) {
      return downscaleDataUrl(source, opts.maxEdgePx).then(resized =>
        inlineFromDataUrl(resized, label),
      );
    }
    if (isHttpUrl(source)) {
      if (opts.supportsRemoteImageUrl) {
        // No fetch at all: this is the path that keeps UploadStep's absolute
        // arweave URL working for OpenAI, which reads the URL itself.
        const remote: ImagePart = { kind: 'remote', url: source, label };
        return Promise.resolve(remote);
      }
      return fetchInline(source, label, opts.fetchImpl);
    }
  }

  return Promise.reject(aiError('image', 'Unsupported image source.'));
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function inlinePart(
  mimeType: string,
  base64: string,
  label: string,
): InlineImagePart {
  if (base64ByteLength(base64) > MAX_IMAGE_BYTES) {
    throw aiError(
      'image',
      'That image is still larger than 4 MB after downscaling. ' +
        'Use a smaller file.',
    );
  }
  return { kind: 'inline', mimeType, base64, label };
}

function inlineFromDataUrl(dataUrl: string, label: string): InlineImagePart {
  const split = splitDataUrl(dataUrl);
  return inlinePart(split.mimeType, split.base64, label);
}

function fetchInline(
  url: string,
  label: string,
  fetchImpl?: typeof fetch,
): Promise<ImagePart> {
  return Promise.resolve()
    .then(() => {
      const doFetch =
        fetchImpl ||
        (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
      return doFetch(url);
    })
    .then(res => {
      if (!res.ok) {
        throw aiError('image', READ_FAILED, { status: res.status });
      }
      return res.blob();
    })
    .then(blob =>
      blob.arrayBuffer().then(buf => {
        const base64 = bytesToBase64(new Uint8Array(buf));
        return inlinePart(blob.type || 'image/jpeg', base64, label);
      }),
    )
    .catch(e => {
      // An AiError already carries the precise message (an over-size image, a
      // non-ok status); only opaque failures get the generic CORS wording.
      throw isAiError(e) ? e : aiError('image', READ_FAILED);
    });
}
