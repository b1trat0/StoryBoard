/**
 * jsdom shim for the native <dialog> element.
 *
 * The Dialog component uses `showModal()` and `close()` because that is the right
 * element: the browser handles the backdrop, the top layer, Escape, and focus
 * trapping. jsdom implements the element but not the modal behaviour, so any test
 * that opens a dialog throws `showModal is not a function`.
 *
 * This is a test-environment gap, not a product defect, so it is filled here rather
 * than by rewriting the component to something weaker. `open` is mirrored because
 * the component reads it back, and `returnValue` is set so `close()` settles the
 * same way the browser would.
 */
export function installDialogPolyfill(): void {
  const proto = globalThis.HTMLDialogElement?.prototype as HTMLDialogElement | undefined;
  if (proto === undefined || typeof proto.showModal === 'function') {
    return;
  }

  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };

  proto.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };

  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    this.open = false;
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    // The browser fires close on close(); a handler bound with addEventListener
    // depends on it, and the component uses onClose on the element.
    this.dispatchEvent(new Event('close'));
  };
}
