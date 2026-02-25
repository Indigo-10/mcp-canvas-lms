// src/text-extraction.ts

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
const { parseOfficeAsync } = require('officeparser') as { parseOfficeAsync: (buf: Buffer) => Promise<string> };

export type SupportedContentType = 'pdf' | 'docx' | 'pptx' | 'html' | 'text' | 'unsupported';

const MAX_EXTRACT_BYTES = 50 * 1024 * 1024; // 50 MB hard ceiling for extraction

export function detectContentType(contentType: string, filename: string): SupportedContentType {
  const ct = contentType.toLowerCase();
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (ct.includes('pdf') || ext === 'pdf') return 'pdf';
  if (ct.includes('wordprocessingml') || ct.includes('msword') || ext === 'docx' || ext === 'doc') return 'docx';
  if (ct.includes('presentationml') || ct.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ct.includes('text/html') || ext === 'html' || ext === 'htm') return 'html';
  if (ct.includes('text/plain') || ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json') return 'text';

  return 'unsupported';
}

export function stripHtml(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?(p|div|li|h[1-6]|tr|blockquote|section|article|header|footer|nav|main)[^>]*>/gi, '\n');

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#0?39;/gi, "'");
  text = text.replace(/&#x27;/gi, "'");
  text = text.replace(/&rsquo;/gi, '\u2019');
  text = text.replace(/&lsquo;/gi, '\u2018');
  text = text.replace(/&rdquo;/gi, '\u201C');
  text = text.replace(/&ldquo;/gi, '\u201D');
  text = text.replace(/&mdash;/gi, '\u2014');
  text = text.replace(/&ndash;/gi, '\u2013');
  text = text.replace(/&hellip;/gi, '\u2026');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export async function extractText(buffer: Buffer, type: SupportedContentType): Promise<string> {
  if (buffer.length > MAX_EXTRACT_BYTES) {
    throw new Error(`File too large for extraction (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max ${MAX_EXTRACT_BYTES / 1024 / 1024} MB)`);
  }

  switch (type) {
    case 'pdf': {
      const data = await pdfParse(buffer);
      return data.text;
    }
    case 'docx':
    case 'pptx': {
      return await parseOfficeAsync(buffer);
    }
    case 'html': {
      return stripHtml(buffer.toString('utf-8'));
    }
    case 'text': {
      return buffer.toString('utf-8');
    }
    case 'unsupported':
      throw new Error('Unsupported file type for text extraction');
  }
}
