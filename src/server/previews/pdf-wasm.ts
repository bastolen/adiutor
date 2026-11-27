/**
 * @file PDFium, built to WebAssembly (`@embedpdf/pdfium`: the MIT wrapper of
 * BSD-licensed PDFium, built without JavaScript or XFA), compiled once per
 * process with its memory capped: the module defines its own memory, so its
 * maximum is lowered in the bytes before they're compiled, and a PDF that
 * wants more fails inside the module instead of taking the server's memory.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** The id of a WebAssembly module's memory section. */
const MEMORY_SECTION = 5;

/** A memory's flags with a maximum (and nothing else: not shared, not 64-bit). */
const HAS_MAXIMUM = 1;

/* eslint-disable no-bitwise -- LEB128 numbers are made of 7-bit groups and a continuation bit. */

/**
 * Reads an unsigned LEB128 number.
 *
 * @param bytes - The module.
 * @param start - Where the number starts.
 * @returns The number, and where what follows it starts.
 * @throws {Error} When it runs past the end.
 */
function readLeb(bytes: Uint8Array, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let at = start;
  for (;;) {
    const byte = bytes[at];
    if (byte === undefined || shift > 35) {
      throw new Error('Not a WebAssembly module PDFium can be loaded from.');
    }
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    at += 1;
    if ((byte & 0x80) === 0) {
      return [result, at];
    }
  }
}

/**
 * Writes an unsigned LEB128 number.
 *
 * @param value - The number.
 * @returns Its bytes.
 */
function leb(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest > 0) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (rest > 0);
  return out;
}

/* eslint-enable no-bitwise */

/**
 * Lowers the maximum of the memory a WebAssembly module defines, by
 * rewriting its memory section.
 *
 * @param bytes - The module.
 * @param maxPages - The new maximum, in pages of 64 KiB.
 * @returns The module with that maximum (or its own, when that's lower).
 * @throws {Error} When the module has no memory of its own with a maximum, or starts with more
 *   than `maxPages`.
 */
export function lowerMemoryMaximum(bytes: Uint8Array, maxPages: number): Uint8Array<ArrayBuffer> {
  // Past the magic number and the version.
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at];
    const [size, start] = readLeb(bytes, at + 1);
    if (id === MEMORY_SECTION) {
      const [count, flagsAt] = readLeb(bytes, start);
      if (count !== 1 || bytes[flagsAt] !== HAS_MAXIMUM) {
        throw new Error('PDFium’s memory isn’t one with a maximum.');
      }
      const [initial, maximumAt] = readLeb(bytes, flagsAt + 1);
      const [maximum] = readLeb(bytes, maximumAt);
      if (initial > maxPages) {
        throw new Error('PDFium starts with more memory than its cap.');
      }
      const body = [1, HAS_MAXIMUM, ...leb(initial), ...leb(Math.min(maximum, maxPages))];
      const section = [MEMORY_SECTION, ...leb(body.length), ...body];
      const after = bytes.subarray(start + size);
      const patched = new Uint8Array(at + section.length + after.length);
      patched.set(bytes.subarray(0, at), 0);
      patched.set(section, at);
      patched.set(after, at + section.length);
      return patched;
    }
    at = start + size;
  }
  throw new Error('PDFium has no memory of its own.');
}

/** PDFium compiled, by its memory cap. */
const compiled = new Map<number, Promise<WebAssembly.Module>>();

/**
 * PDFium, compiled once per memory cap, for workers to instantiate. A
 * compile that fails is tried again on the next call.
 *
 * @param maxPages - Its memory cap, in pages of 64 KiB.
 * @returns The compiled module.
 * @throws {Error} When the module can't be found or compiled (the server is missing it).
 */
export function pdfiumModule(maxPages: number): Promise<WebAssembly.Module> {
  let compiling = compiled.get(maxPages);
  if (!compiling) {
    compiling = (async () => {
      // Resolved at run time from the package (which stays outside the bundle), never bundled.
      const path = createRequire(import.meta.url).resolve(
        /* turbopackIgnore: true */ '@embedpdf/pdfium/pdfium.wasm',
      );
      return WebAssembly.compile(lowerMemoryMaximum(await readFile(path), maxPages));
    })();
    compiled.set(maxPages, compiling);
    compiling.catch(() => compiled.delete(maxPages));
  }
  return compiling;
}
