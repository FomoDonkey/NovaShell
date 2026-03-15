import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";

interface DocBlock {
  type: "h1" | "h2" | "h3" | "paragraph" | "code" | "bullet" | "numbered" | "image";
  content: string;
  imageData?: string; // base64 PNG
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 14;
const CODE_LINE_H = 13;

function parseMarkdownToBlocks(md: string, screenshots: Map<string, string>): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join("\n");
      blocks.push({ type: "code", content: code });

      // Check if any screenshot matches a command in this code block
      for (const [cmd, data] of screenshots) {
        if (code.includes(cmd)) {
          blocks.push({ type: "image", content: `Terminal: ${cmd}`, imageData: data });
          screenshots.delete(cmd); // don't reuse
          break;
        }
      }
      continue;
    }

    // Image reference (skip - we handle screenshots separately)
    if (line.startsWith("![")) { i++; continue; }

    // Headers
    if (line.startsWith("### ")) { blocks.push({ type: "h3", content: line.slice(4) }); i++; continue; }
    if (line.startsWith("## ")) { blocks.push({ type: "h2", content: line.slice(3) }); i++; continue; }
    if (line.startsWith("# ")) { blocks.push({ type: "h1", content: line.slice(2) }); i++; continue; }

    // Bullet
    if (/^[-*] /.test(line)) { blocks.push({ type: "bullet", content: line.slice(2) }); i++; continue; }

    // Numbered
    if (/^\d+\. /.test(line)) { blocks.push({ type: "numbered", content: line.replace(/^\d+\.\s*/, "") }); i++; continue; }

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Paragraph - collect consecutive non-empty lines
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith("![") && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: paraLines.join(" ") });
  }

  return blocks;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, fontSize);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generatePdf(
  markdown: string,
  screenshots: Map<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);

  const blocks = parseMarkdownToBlocks(markdown, new Map(screenshots));

  // Remaining unmatched screenshots appended at end
  for (const [cmd, data] of screenshots) {
    blocks.push({ type: "h3", content: `Terminal: ${cmd}` });
    blocks.push({ type: "image", content: cmd, imageData: data });
  }

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNum = 1;

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN + 20) {
      // Footer on current page
      page.drawText(`— ${pageNum} —`, { x: PAGE_W / 2 - 20, y: 20, size: 8, font: helvetica, color: rgb(0.5, 0.5, 0.5) });
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      pageNum++;
    }
  };

  const drawParagraph = (text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, lineH: number, indent = 0) => {
    const lines = wrapText(text, font, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(lineH);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color });
      y -= lineH;
    }
  };

  // Title bar
  page.drawRectangle({ x: 0, y: PAGE_H - 35, width: PAGE_W, height: 35, color: rgb(0.05, 0.29, 0.43) });
  page.drawText("NovaShell — Session Report", { x: MARGIN, y: PAGE_H - 25, size: 14, font: helveticaBold, color: rgb(1, 1, 1) });
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dateStr, { x: PAGE_W - MARGIN - helvetica.widthOfTextAtSize(dateStr, 9), y: PAGE_H - 25, size: 9, font: helvetica, color: rgb(0.8, 0.8, 0.8) });
  y = PAGE_H - MARGIN - 20;

  for (const block of blocks) {
    switch (block.type) {
      case "h1":
        ensureSpace(30);
        y -= 12;
        page.drawText(block.content, { x: MARGIN, y, size: 18, font: helveticaBold, color: rgb(0.05, 0.29, 0.43) });
        y -= 8;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.05, 0.29, 0.43) });
        y -= 10;
        break;

      case "h2":
        ensureSpace(25);
        y -= 10;
        page.drawText(block.content, { x: MARGIN, y, size: 14, font: helveticaBold, color: rgb(0.1, 0.35, 0.5) });
        y -= 4;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        y -= 8;
        break;

      case "h3":
        ensureSpace(20);
        y -= 8;
        page.drawText(block.content, { x: MARGIN, y, size: 11, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
        y -= 8;
        break;

      case "paragraph":
        ensureSpace(LINE_H);
        drawParagraph(block.content, helvetica, 10, rgb(0.15, 0.15, 0.15), LINE_H);
        y -= 4;
        break;

      case "bullet":
        ensureSpace(LINE_H);
        page.drawText("\u2022", { x: MARGIN + 4, y, size: 10, font: helvetica, color: rgb(0.05, 0.29, 0.43) });
        drawParagraph(block.content, helvetica, 10, rgb(0.15, 0.15, 0.15), LINE_H, 16);
        y -= 2;
        break;

      case "numbered":
        ensureSpace(LINE_H);
        drawParagraph(block.content, helvetica, 10, rgb(0.15, 0.15, 0.15), LINE_H, 16);
        y -= 2;
        break;

      case "code": {
        const codeLines = block.content.split("\n");
        const blockH = codeLines.length * CODE_LINE_H + 16;
        ensureSpace(Math.min(blockH, 200));
        y -= 4;
        const boxY = y - blockH + CODE_LINE_H;
        page.drawRectangle({ x: MARGIN, y: boxY - 4, width: CONTENT_W, height: blockH, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
        for (const codeLine of codeLines) {
          const truncated = codeLine.length > 90 ? codeLine.slice(0, 87) + "..." : codeLine;
          page.drawText(truncated, { x: MARGIN + 8, y, size: 9, font: courier, color: rgb(0.1, 0.1, 0.1) });
          y -= CODE_LINE_H;
        }
        y -= 8;
        break;
      }

      case "image": {
        if (!block.imageData) break;
        try {
          // Extract raw base64 from data URI
          const raw = block.imageData.replace(/^data:image\/png;base64,/, "");
          const imgBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
          const img = await doc.embedPng(imgBytes);
          const scale = Math.min(CONTENT_W / img.width, 280 / img.height, 1);
          const imgW = img.width * scale;
          const imgH = img.height * scale;
          ensureSpace(imgH + 20);
          y -= 4;
          // Border around image
          page.drawRectangle({ x: MARGIN - 1, y: y - imgH - 1, width: imgW + 2, height: imgH + 2, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5, color: rgb(0, 0, 0) });
          page.drawImage(img, { x: MARGIN, y: y - imgH, width: imgW, height: imgH });
          y -= imgH + 12;
        } catch {
          // Skip invalid images silently
        }
        break;
      }
    }
  }

  // Final page footer
  page.drawText(`— ${pageNum} —`, { x: PAGE_W / 2 - 20, y: 20, size: 8, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

  return doc.save();
}
