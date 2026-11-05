/**
 * Copies text to the clipboard from the renderer.
 *
 * The async Clipboard API needs a secure context. Electron's packaged app is one,
 * but `vite dev` in a plain browser may not be, so the deprecated `execCommand`
 * path stays as a fallback. A copy button that silently does nothing is worse than
 * no button, so the caller is told whether it worked.
 *
 * @param text - Text to place on the clipboard.
 * @returns True when the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path; a denied permission is recoverable here.
  }

  try {
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', '');
    staging.style.position = 'fixed';
    staging.style.top = '-1000px';
    staging.style.opacity = '0';
    document.body.appendChild(staging);
    staging.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(staging);
    return copied;
  } catch {
    return false;
  }
}
