export function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

export function matches(item, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const variants = item.answerVariants;
  const answers = variants && typeof variants === 'object' && !Array.isArray(variants)
    ? Object.values(variants).filter(value => typeof value === 'string') : [];
  const fields = [item.question, item.questionZh, item.answer, ...answers, item.outline,
    ...(Array.isArray(item.tags) ? item.tags : [])];
  return normalize(fields.filter(value => typeof value === 'string').join(' ')).includes(needle);
}

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function sourceSegments(text) {
  if (segmenter) return segmenter.segment(text);
  let index = 0;
  return Array.from(text, segment => {
    const result = { segment, index };
    index += segment.length;
    return result;
  });
}

// Keep original source ranges when compatibility characters expand, a composed
// Japanese character contains multiple code points, or whitespace is collapsed.
function normalizedRanges(text) {
  let compatible = '';
  const compatibleRanges = [];
  for (const { segment, index } of sourceSegments(text)) {
    const normalized = segment.normalize('NFKC');
    compatible += normalized;
    for (let unit = 0; unit < normalized.length; unit += 1) {
      compatibleRanges.push({ start: index, end: index + segment.length });
    }
  }
  const folded = compatible.toLowerCase();
  const foldedRanges = [];
  let sourceIndex = 0;
  for (const point of compatible) {
    const range = compatibleRanges[sourceIndex];
    for (let unit = 0; unit < point.toLowerCase().length; unit += 1) foldedRanges.push(range);
    sourceIndex += point.length;
  }
  let normalized = '';
  const ranges = [];
  for (let index = 0; index < folded.length; index += 1) {
    const character = /\s/.test(folded[index]) ? ' ' : folded[index];
    const range = foldedRanges[index];
    if (character === ' ' && normalized.endsWith(' ')) {
      ranges[ranges.length - 1].end = range.end;
      continue;
    }
    normalized += character;
    ranges.push({ ...range });
  }
  return { normalized, ranges };
}

export function highlight(value, query) {
  const text = String(value ?? '');
  const needle = normalize(query);
  if (!needle || !normalize(text).includes(needle)) return escapeHtml(text);
  const { normalized, ranges } = normalizedRanges(text);
  const matches = [];
  let cursor = 0;
  for (let index; (index = normalized.indexOf(needle, cursor)) !== -1; cursor = index + needle.length) {
    const start = ranges[index].start;
    const end = ranges[index + needle.length - 1].end;
    const previous = matches[matches.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else matches.push({ start, end });
  }
  cursor = 0;
  let html = '';
  for (const { start, end } of matches) {
    html += escapeHtml(text.slice(cursor, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>';
    cursor = end;
  }
  return html + escapeHtml(text.slice(cursor));
}
