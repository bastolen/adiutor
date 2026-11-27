/**
 * @file The worker thread that draws a PDF's first page with PDFium
 * (`draw-pdf.ts` starts it): from the module the main thread compiled with
 * its memory capped (`pdf-wasm.ts`), it loads a PDF without a password,
 * draws page 1 on white so its longest side is the size it's asked for, and
 * answers with the pixels (RGBA, rows packed). A PDF it can't draw is
 * `failed`; one that broke PDFium itself (its memory ran out) is `broken`
 * too, and the main thread stops this worker. Loaded by Node itself outside
 * Next.js (the tests, the jobs' command), so it imports nothing of the app.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { init } from '@embedpdf/pdfium';

/** What the main thread hands over when it starts the worker. */
interface StartData {
  /** PDFium, compiled with its memory capped. */
  wasm: WebAssembly.Module;
}

/** A PDF to draw. */
interface PdfToDraw {
  /** The file. */
  pdf: Uint8Array;
  /** The longest side of the drawing, in pixels. */
  side: number;
}

/**
 * How the page is drawn: `FPDF_ANNOT` (0x01, annotations too: a form's
 * filled fields, stamps) and `FPDF_REVERSE_BYTE_ORDER` (0x10, RGBA rather
 * than BGRA).
 */
const RENDER_FLAGS = 0x11;

/** White, as PDFium writes a colour (ARGB). */
const WHITE = 0xffffffff;

const { wasm } = workerData as StartData;

const loading = init({
  /**
   * Instantiates the module the main thread compiled.
   *
   * @param imports - What the module imports.
   * @param done - Takes the instance.
   * @returns Nothing yet: the instance comes through `done`.
   */
  instantiateWasm: (imports, done) => {
    void WebAssembly.instantiate(wasm, imports).then((instance) => done(instance));
    return {};
  },
  /** Emscripten's messages (a heap that can't grow, say) go nowhere: the answer says it failed. */
  print: () => {},
  /** The same for its errors. */
  printErr: () => {},
});

/**
 * Draws a PDF's first page.
 *
 * @param pdfium - PDFium.
 * @param message - The PDF, and the size to draw it at.
 * @returns The pixels, or `null` when it can't be drawn.
 */
function drawFirstPage(
  pdfium: Awaited<typeof loading>,
  message: PdfToDraw,
): { width: number; height: number; data: Uint8Array<ArrayBuffer> } | null {
  const { pdf, side } = message;
  const runtime = pdfium.pdfium;
  const pointer = runtime.wasmExports.malloc(pdf.length);
  if (!pointer) {
    return null;
  }
  let document = 0;
  let page = 0;
  let bitmap = 0;
  try {
    runtime.HEAPU8.set(pdf, pointer);
    // No password: a PDF that needs one can't be drawn.
    document = pdfium.FPDF_LoadMemDocument(pointer, pdf.length, '');
    if (!document || pdfium.FPDF_GetPageCount(document) < 1) {
      return null;
    }
    page = pdfium.FPDF_LoadPage(document, 0);
    if (!page) {
      return null;
    }
    const pageWidth = pdfium.FPDF_GetPageWidthF(page);
    const pageHeight = pdfium.FPDF_GetPageHeightF(page);
    if (!(pageWidth > 0 && pageHeight > 0 && Number.isFinite(pageWidth + pageHeight))) {
      return null;
    }
    const scale = side / Math.max(pageWidth, pageHeight);
    const width = Math.max(1, Math.round(pageWidth * scale));
    const height = Math.max(1, Math.round(pageHeight * scale));
    bitmap = pdfium.FPDFBitmap_Create(width, height, 0);
    if (!bitmap) {
      return null;
    }
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, WHITE);
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_FLAGS);
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap);
    const stride = pdfium.FPDFBitmap_GetStride(bitmap);
    const row = width * 4;
    const data = new Uint8Array(row * height);
    for (let y = 0; y < height; y += 1) {
      data.set(runtime.HEAPU8.subarray(buffer + y * stride, buffer + y * stride + row), y * row);
    }
    return { width, height, data };
  } finally {
    if (bitmap) {
      pdfium.FPDFBitmap_Destroy(bitmap);
    }
    if (page) {
      pdfium.FPDF_ClosePage(page);
    }
    if (document) {
      pdfium.FPDF_CloseDocument(document);
    }
    runtime.wasmExports.free(pointer);
  }
}

parentPort?.on('message', (message: PdfToDraw) => {
  void loading.then((pdfium) => {
    let drawn;
    try {
      drawn = drawFirstPage(pdfium, message);
    } catch {
      // PDFium aborted (its memory ran out): it can't be used again.
      parentPort?.postMessage({ failed: true, broken: true });
      return;
    }
    if (drawn) {
      parentPort?.postMessage({ bitmap: drawn }, [drawn.data.buffer]);
    } else {
      parentPort?.postMessage({ failed: true });
    }
  });
});

void loading.then((pdfium) => {
  pdfium.PDFiumExt_Init();
  parentPort?.postMessage({ ready: true });
});
