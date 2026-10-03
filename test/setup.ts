import { timingSafeEqual } from 'node:crypto';

/**
 * `crypto.subtle.timingSafeEqual` is a Workers-only addition to WebCrypto.
 * Node does not have it, so the tests borrow the equivalent from node:crypto.
 */
const subtle = globalThis.crypto.subtle as typeof globalThis.crypto.subtle & {
  timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
};
if (typeof subtle.timingSafeEqual !== 'function') {
  subtle.timingSafeEqual = (a: ArrayBufferView, b: ArrayBufferView) =>
    timingSafeEqual(
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
    );
}
