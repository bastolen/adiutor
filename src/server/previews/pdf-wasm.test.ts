/**
 * @file Tests for capping PDFium's memory: the maximum written into the
 * module holds once it runs, a module that starts above the cap or has no
 * memory of its own is refused, and PDFium itself compiles with the cap.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { lowerMemoryMaximum, pdfiumModule } from './pdf-wasm';

/**
 * A module that defines a memory and exports it as `memory`.
 *
 * @param initial - Its initial size, in pages.
 * @param maximum - Its maximum, in pages.
 * @returns The module's bytes.
 */
function moduleWithMemory(initial: number, maximum: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    // The magic number and the version.
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    // The memory section: one memory with a maximum.
    0x05,
    0x04,
    0x01,
    0x01,
    initial,
    maximum,
    // The export section: "memory", the memory at index 0.
    0x07,
    0x0a,
    0x01,
    0x06,
    0x6d,
    0x65,
    0x6d,
    0x6f,
    0x72,
    0x79,
    0x02,
    0x00,
  ]);
}

/**
 * The memory a module exports, once it runs.
 *
 * @param bytes - The module.
 * @returns Its memory.
 */
async function memoryOf(bytes: Uint8Array<ArrayBuffer>): Promise<WebAssembly.Memory> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const { memory } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('Expected a memory.');
  }
  return memory;
}

describe('lowerMemoryMaximum', () => {
  it('caps the memory a module may grow to', async () => {
    const memory = await memoryOf(lowerMemoryMaximum(moduleWithMemory(1, 100), 3));
    expect(memory.grow(2)).toBe(1);
    expect(() => memory.grow(1)).toThrow(RangeError);
  });

  it('keeps a lower maximum of the module’s own', async () => {
    const memory = await memoryOf(lowerMemoryMaximum(moduleWithMemory(1, 2), 100));
    expect(() => memory.grow(2)).toThrow(RangeError);
  });

  it('refuses a module that starts above the cap, or has no memory of its own', () => {
    expect(() => lowerMemoryMaximum(moduleWithMemory(5, 10), 3)).toThrow(/more memory/);
    expect(() => lowerMemoryMaximum(moduleWithMemory(1, 10).subarray(0, 8), 3)).toThrow(
      /no memory/,
    );
  });
});

describe('pdfiumModule', () => {
  it('compiles PDFium with its memory capped, once', async () => {
    const pdfium = await pdfiumModule(4096);
    expect(WebAssembly.Module.exports(pdfium).some((entry) => entry.kind === 'memory')).toBe(true);
    expect(await pdfiumModule(4096)).toBe(pdfium);
  });
});
