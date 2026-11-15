/**
 * Orders a book's chapters by the episode number in their titles
 * ("Episode 12", "#12", "No. 12", "第12回", "Ep12 …"), for series like Slow
 * Japanese where reordering by hand is tedious.
 */

const NUMBER_PATTERNS: RegExp[] = [
  /(?:episode|ep\.?|no\.?|#|第)\s*(\d+)/i,
  /(\d+)\s*(?:回|話)/,
];

/** Full-width digits to ASCII so "第１２回" parses. */
function toAsciiDigits(text: string): string {
  return text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

/** The episode number in a chapter title, or undefined when none is recognisable. */
export function episodeNumberFromTitle(title: string): number | undefined {
  const text = toAsciiDigits(title);
  for (const pattern of NUMBER_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  const bare = /\d+/.exec(text);
  return bare ? Number(bare[0]) : undefined;
}

/**
 * Chapter ids ordered by episode number ascending. Ties and chapters with no
 * number keep their current relative order; unnumbered ones go last.
 */
export function chapterIdsByEpisodeNumber(
  chapters: readonly { id: string; title: string; position: number }[],
): string[] {
  return chapters
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((chapter, index) => ({ chapter, index, number: episodeNumberFromTitle(chapter.title) }))
    .sort((a, b) => {
      if (a.number === undefined && b.number === undefined) return a.index - b.index;
      if (a.number === undefined) return 1;
      if (b.number === undefined) return -1;
      return a.number - b.number || a.index - b.index;
    })
    .map((entry) => entry.chapter.id);
}
