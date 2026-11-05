import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RuleViolationError } from '../lib/errors.js';

/**
 * The DeepSeek API key at rest.
 *
 * Encrypted with the OS keystore through Electron's `safeStorage` (DPAPI on Windows),
 * never stored in the repository, never in a plain settings file, never sent over IPC.
 * The renderer can ask whether a key exists and can replace or clear it; it can never
 * read it back.
 *
 * `crypto` is injected so this is testable without Electron and so the app can tell the
 * author plainly when encryption is unavailable on the machine.
 */

export interface KeyCrypto {
  isAvailable(): boolean;
  /** Returns a base64 string, safe to write into a JSON file. */
  encrypt(value: string): string;
  decrypt(payload: string): string;
}

export interface AiKeyStore {
  status(): Promise<{ isConfigured: boolean; isEncryptionAvailable: boolean }>;
  get(): Promise<string | null>;
  set(apiKey: string): Promise<void>;
  clear(): Promise<void>;
}

export function createAiKeyStore(input: {
  filePath: string;
  crypto: KeyCrypto;
}): AiKeyStore {
  async function read(): Promise<string | null> {
    try {
      const raw = await readFile(input.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { key?: unknown }).key !== 'string'
      ) {
        return null;
      }
      return input.crypto.decrypt((parsed as { key: string }).key);
    } catch (err) {
      // Missing, corrupt or undecryptable all mean "no usable key", which is a state
      // the author can fix; it is not a crash.
      if (isMissing(err) || err instanceof SyntaxError) {
        return null;
      }
      return null;
    }
  }

  return {
    async status() {
      return {
        isConfigured: (await read()) !== null,
        isEncryptionAvailable: input.crypto.isAvailable(),
      };
    },

    get() {
      return read();
    },

    async set(apiKey) {
      const trimmed = apiKey.trim();
      if (trimmed.length === 0) {
        throw new RuleViolationError('Paste a DeepSeek API key first.');
      }
      if (!input.crypto.isAvailable()) {
        throw new RuleViolationError(
          'This machine cannot encrypt a key, so it will not be stored. The AI features stay off.',
        );
      }

      await mkdir(path.dirname(input.filePath), { recursive: true });
      const partial = `${input.filePath}.partial`;
      await writeFile(
        partial,
        JSON.stringify({ key: input.crypto.encrypt(trimmed) }),
        'utf8',
      );
      await rename(partial, input.filePath);
    },

    async clear() {
      try {
        await unlink(input.filePath);
      } catch (err) {
        if (!isMissing(err)) {
          throw err;
        }
      }
    },
  };
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
