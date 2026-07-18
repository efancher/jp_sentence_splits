import { APP_NAME, WORKSHEET_SEPARATORS } from '../appConfig';
import type { AnalysisChunk, Sentence } from '../domain/types';
import { ichiMoeUrl } from './ichiMoe';

export interface WorksheetSentenceInput {
  sentence: Sentence;
  chunks: AnalysisChunk[];
  index?: number;
  sourceLabel?: string;
}

function targetWordLine(sentence: Sentence): string {
  if (!sentence.targetVocabulary.length) return '';
  return sentence.targetVocabulary.map((item) => item.expression).join(' · ');
}

export function summarizeChunks(chunks: AnalysisChunk[]): {
  chunk: string;
  role: string;
  lit: string;
} {
  return {
    chunk: chunks.map((item) => item.japanese).join(WORKSHEET_SEPARATORS.chunk),
    role: chunks.map((item) => item.role || '…').join(WORKSHEET_SEPARATORS.role),
    lit: chunks
      .map((item) => item.literalEnglish)
      .filter(Boolean)
      .join(WORKSHEET_SEPARATORS.lit),
  };
}

export function formatWorksheetBlock(input: WorksheetSentenceInput): string {
  const { sentence, chunks, index, sourceLabel = 'Satori Reader' } = input;
  const summary = summarizeChunks(chunks);
  const target = targetWordLine(sentence);
  const lines = [
    '═'.repeat(64),
    index != null
      ? `${APP_NAME.replace('Satori Glossbook', 'Satori gloss worksheet')} · #${index}`
      : 'Satori gloss worksheet',
  ];
  if (target) lines.push(`Target word: ${target}`);
  lines.push(`Source: ${sourceLabel}`);
  lines.push('');
  lines.push(`JP:    ${sentence.japanese}`);
  lines.push('');
  lines.push('# CHUNK — space particles / て links / clause boundaries');
  lines.push(`CHUNK: ${summary.chunk}`);
  lines.push('');
  lines.push('# ROLE — Aが / engine / を・に・で car / time / topic は / …');
  lines.push(`ROLE: ${summary.role}`);
  lines.push('');
  lines.push('# LIT — Japanese-order sticky English (not fluent EN)');
  lines.push(`LIT: ${summary.lit}`);
  lines.push('');
  lines.push(`EN:    ${sentence.translation || '(no English)'}`);
  lines.push('');
  lines.push(`ichi.moe: ${ichiMoeUrl(sentence.japanese)}`);
  lines.push('═'.repeat(64));
  return lines.join('\n');
}

export function formatWorksheetCollection(
  items: WorksheetSentenceInput[],
  format: 'txt' | 'md' = 'txt',
): string {
  const body = items
    .map((item, index) =>
      formatWorksheetBlock({
        ...item,
        index: item.index ?? index + 1,
      }),
    )
    .join('\n\n');
  if (format === 'md') {
    return `# Satori gloss worksheet\n\n\`\`\`text\n${body}\n\`\`\`\n`;
  }
  return body;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function shareText(title: string, text: string): Promise<boolean> {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
  }
}
