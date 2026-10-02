import { afterEach, describe, expect, it } from 'vitest';
import { describeError, getBridge } from '../../src/lib/bridge';
import type { StoryBoardBridge } from '../../src/lib/bridge';

/**
 * Renderer bridge detection.
 *
 * The one failure that matters here is a silent one. If the preload script did
 * not attach, every call in the app throws "cannot read property of undefined"
 * and the author is told the database is broken when it is not. getBridge exists
 * to turn that into a message about how the app was started, so these tests pin
 * the three cases: no window, window without a bridge, window with a bridge.
 *
 * Node has no DOM, so `window` is installed and removed by hand rather than
 * pulling in a DOM emulator for three assertions.
 */

type MutableGlobal = typeof globalThis & { window?: unknown };

const mutableGlobal = globalThis as MutableGlobal;

/** Installs a fake window, or removes it when value is undefined. */
function setWindow(value: unknown): void {
  if (value === undefined) {
    delete mutableGlobal.window;
    return;
  }
  mutableGlobal.window = value;
}

afterEach(() => {
  setWindow(undefined);
});

describe('getBridge', () => {
  it('returns null outside a browser context, so a Node import cannot throw', () => {
    expect(getBridge()).toBeNull();
  });

  it('returns null when a window exists without the preload bridge attached', () => {
    // This is what `npm run dev` looks like when opened in a plain browser tab.
    setWindow({});
    expect(getBridge()).toBeNull();
  });

  it('returns null when the bridge key is present but undefined', () => {
    setWindow({ storyboard: undefined });
    expect(getBridge()).toBeNull();
  });

  it('returns the bridge the preload script attached', () => {
    const bridge = { entities: {} } as unknown as StoryBoardBridge;
    setWindow({ storyboard: bridge });
    expect(getBridge()).toBe(bridge);
  });
});

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('Alias already belongs to Aelith'))).toBe(
      'Alias already belongs to Aelith',
    );
  });

  it('passes a thrown string through unchanged', () => {
    expect(describeError('database is not running')).toBe('database is not running');
  });

  it('falls back to a readable sentence for anything else', () => {
    // A rejected value can be an object, null, or undefined. Rendering those as
    // "[object Object]" in the UI would be worse than admitting nothing is known.
    expect(describeError({ code: '23505' })).toBe('Something went wrong.');
    expect(describeError(null)).toBe('Something went wrong.');
    expect(describeError(undefined)).toBe('Something went wrong.');
  });
});