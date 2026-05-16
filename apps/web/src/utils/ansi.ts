// Minimal ANSI escape code → HTML converter
// Handles SGR (Select Graphic Rendition) sequences for colors and text styling

const ANSI_COLORS: Record<number, string> = {
  30: '#1e1e1e', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#abb2bf',
  90: '#5c6370', 91: '#e06c75', 92: '#98c379', 93: '#e5c07b',
  94: '#61afef', 95: '#c678dd', 96: '#56b6c2', 97: '#ffffff',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#1e1e1e', 41: '#e06c75', 42: '#98c379', 43: '#e5c07b',
  44: '#61afef', 45: '#c678dd', 46: '#56b6c2', 47: '#abb2bf',
};

// Regex to match ANSI escape sequences (CSI sequences)
// Matches: ESC[ followed by params and a final letter
const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

export function ansiToHtml(text: string): string {
  let result = '';
  let openSpans = 0;
  let lastIndex = 0;

  // Replace HTML special chars first
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let match: RegExpExecArray | null;
  ANSI_REGEX.lastIndex = 0;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    // Append text before this escape sequence
    result += text.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;

    const params = match[1].split(';').map(Number);
    if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
      // Reset all
      while (openSpans > 0) { result += '</span>'; openSpans--; }
      continue;
    }

    for (const code of params) {
      if (code === 0) {
        while (openSpans > 0) { result += '</span>'; openSpans--; }
      } else if (code === 1) {
        result += '<span style="font-weight:bold">';
        openSpans++;
      } else if (code === 2) {
        result += '<span style="opacity:0.7">';
        openSpans++;
      } else if (code === 3) {
        result += '<span style="font-style:italic">';
        openSpans++;
      } else if (code === 4) {
        result += '<span style="text-decoration:underline">';
        openSpans++;
      } else if (ANSI_COLORS[code]) {
        result += `<span style="color:${ANSI_COLORS[code]}">`;
        openSpans++;
      } else if (ANSI_BG_COLORS[code]) {
        result += `<span style="background-color:${ANSI_BG_COLORS[code]}">`;
        openSpans++;
      }
    }
  }

  result += text.slice(lastIndex);
  while (openSpans > 0) { result += '</span>'; openSpans--; }

  return result;
}
