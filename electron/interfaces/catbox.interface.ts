/**
 * Third-party image host contract.
 *
 * Catbox is the default host: no API key, permanent retention, and a single
 * documented endpoint. Imgur is deliberately not supported as a default because
 * it requires a registered Client ID, which is a credential the author would
 * have to create and manage for no benefit over Catbox.
 *
 * The app stores the resulting URL, never the response body, so the interface
 * returns only what the database needs.
 */

export type IllustrationHostName = 'catbox' | 'imgbb';

export interface ImageHost {
  readonly name: IllustrationHostName;
  /**
   * Uploads one local file.
   *
   * @param filePath - Absolute path to an existing readable image file
   * @returns The permanent public URL of the uploaded image
   * @throws When the file is missing, unreadable, too large, or the host rejects
   *   the upload. The message must be safe to show the author.
   */
  upload(filePath: string): Promise<string>;
}

export interface CatboxConfig {
  endpoint: string;
  /** Catbox rejects files above 200 MB; the app's own limit is stricter. */
  maxBytes: number;
}

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

const DEFAULT_CATBOX_ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php';
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Catbox implementation.
 *
 * Uses the global fetch and FormData rather than a multipart dependency: Node's
 * runtime already provides both, and adding a package for one request would be
 * a dependency bought for nothing.
 */
export function createCatboxHost(config?: Partial<CatboxConfig>): ImageHost {
  const endpoint = config?.endpoint ?? DEFAULT_CATBOX_ENDPOINT;
  const maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    name: 'catbox',

    async upload(filePath: string): Promise<string> {
      const file = await readImageFile(filePath, maxBytes);

      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', file);

      let response: Response;
      try {
        response = await fetch(endpoint, { method: 'POST', body: form });
      } catch (err) {
        throw new ImageUploadError(
          `Could not reach the image host (${String(err)}). Check your internet connection.`,
        );
      }

      if (!response.ok) {
        throw new ImageUploadError(
          `The image host refused the upload (HTTP ${response.status}). Nothing was lost: the local file is still on disk.`,
        );
      }

      const body = (await response.text()).trim();

      // Catbox answers a successful upload with a bare URL, and a failure with a
      // short sentence. Distinguishing the two is the whole of this parse.
      if (!isHttpUrl(body)) {
        throw new ImageUploadError(
          `The image host did not accept the file: ${truncate(body, 200)}`,
        );
      }

      return body;
    },
  };
}

async function readImageFile(filePath: string, maxBytes: number): Promise<File> {
  const { readFile, stat } = await import('node:fs/promises');

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new ImageUploadError('That image path is not a file.');
    }
    size = info.size;
  } catch (err) {
    if (err instanceof ImageUploadError) {
      throw err;
    }
    throw new ImageUploadError(
      'That image file could not be found. It may have been moved or deleted.',
    );
  }

  if (size > maxBytes) {
    throw new ImageUploadError(
      `That image is ${formatMb(size)}. The host accepts up to ${formatMb(maxBytes)}.`,
    );
  }

  const bytes = await readFile(filePath);
  return new File([bytes], basename(filePath), { type: detectImageType(bytes) });
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last === undefined || last.length === 0 ? 'image' : last;
}

/**
 * Determines the content type from the file signature.
 *
 * Uploading with the wrong content type gets the file served with the wrong
 * Content-Type by some hosts, which breaks the image in the exported HTML.
 */
function detectImageType(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}