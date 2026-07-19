export type MapTokenKind =
  | 'brace-open'
  | 'brace-close'
  | 'paren-open'
  | 'paren-close'
  | 'string'
  | 'word'
  | 'comment'
  | 'eof';

export interface MapToken {
  kind: MapTokenKind;
  value: string;
  line: number;
  column: number;
  offset: number;
  endOffset: number;
}

export interface MapTokenizeDiagnostic {
  severity: 'error';
  line: number;
  column: number;
  message: string;
}

export interface MapTokenizeResult {
  tokens: MapToken[];
  diagnostics: MapTokenizeDiagnostic[];
}

const SINGLE_CHARACTER_TOKENS: Record<string, MapTokenKind> = {
  '{': 'brace-open',
  '}': 'brace-close',
  '(': 'paren-open',
  ')': 'paren-close',
};

export function tokenizeMap(source: string): MapTokenizeResult {
  const tokens: MapToken[] = [];
  const diagnostics: MapTokenizeDiagnostic[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const advance = (): string => {
    const character = source[offset++];
    if (character === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return character;
  };

  const push = (kind: MapTokenKind, value: string, startLine: number, startColumn: number, startOffset: number): void => {
    tokens.push({ kind, value, line: startLine, column: startColumn, offset: startOffset, endOffset: offset });
  };

  while (offset < source.length) {
    const character = source[offset];
    if (/\s/.test(character)) {
      advance();
      continue;
    }

    const startLine = line;
    const startColumn = column;
    const startOffset = offset;
    const singleCharacterKind = SINGLE_CHARACTER_TOKENS[character];
    if (singleCharacterKind) {
      advance();
      push(singleCharacterKind, character, startLine, startColumn, startOffset);
      continue;
    }

    if (character === '/' && source[offset + 1] === '/') {
      advance();
      advance();
      let value = '';
      while (offset < source.length && source[offset] !== '\n') value += advance();
      push('comment', value.trim(), startLine, startColumn, startOffset);
      continue;
    }

    if (character === '"') {
      advance();
      let value = '';
      let terminated = false;
      while (offset < source.length) {
        const current = advance();
        if (current === '"') {
          terminated = true;
          break;
        }
        if (current === '\\' && offset < source.length) {
          const escaped = advance();
          value += escaped === 'n' ? '\n' : escaped;
        } else {
          value += current;
        }
      }
      push('string', value, startLine, startColumn, startOffset);
      if (!terminated) {
        diagnostics.push({
          severity: 'error',
          line: startLine,
          column: startColumn,
          message: 'Unterminated quoted string',
        });
      }
      continue;
    }

    let value = '';
    while (offset < source.length) {
      const current = source[offset];
      if (/\s/.test(current) || SINGLE_CHARACTER_TOKENS[current] ||
          (current === '/' && source[offset + 1] === '/')) break;
      value += advance();
    }
    if (value.length > 0) {
      push('word', value, startLine, startColumn, startOffset);
      continue;
    }

    // Always make progress even if a future delimiter was not handled above.
    advance();
  }

  tokens.push({
    kind: 'eof',
    value: '',
    line,
    column,
    offset,
    endOffset: offset,
  });
  return { tokens, diagnostics };
}
