/**
 * Extract text structure from a reference PDF to use as AI template.
 * Uses pdfjs-dist (Mozilla PDF.js) for reliable cross-platform text extraction.
 */
export async function extractPdfStructure(pdfBytes: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  // Configure worker — use bundled worker via CDN fallback for Tauri compatibility
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];

  for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Group text items by their vertical position and font size
    const items = textContent.items
      .filter((item) => "str" in item && (item as { str: string }).str.trim().length > 0)
      .map((item) => {
        const ti = item as { str: string; transform: number[]; height?: number };
        return {
          text: ti.str,
          fontSize: Math.abs(ti.transform?.[0]) || ti.height || 12,
          y: ti.transform?.[5] || 0,
        };
      });

    if (items.length === 0) continue;

    // Determine font size thresholds for heading detection
    const sizes = items.map((it) => it.fontSize);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    const lines: string[] = [];
    let currentY = -1;
    let currentLine = "";

    for (const item of items) {
      if (currentY !== -1 && Math.abs(item.y - currentY) > 3) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = "";
      }
      currentLine += (currentLine ? " " : "") + item.text;
      currentY = item.y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    // Build page description
    const pageDesc: string[] = [`Page ${i}:`];
    for (const item of items) {
      if (item.fontSize > avgSize * 1.3 && item.text.trim().length > 2) {
        pageDesc.push(`  [HEADING] "${item.text.trim()}"`);
      }
    }
    // Add first few lines as context
    for (const line of lines.slice(0, 8)) {
      if (line.length > 3) {
        pageDesc.push(`  ${line.slice(0, 120)}`);
      }
    }

    pages.push(pageDesc.join("\n"));
  }

  return `REFERENCE DOCUMENT STRUCTURE (${pdf.numPages} pages):\n\n${pages.join("\n\n")}`;
}
