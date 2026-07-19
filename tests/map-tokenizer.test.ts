import { describe, expect, test } from 'vitest';
import { tokenizeMap } from '../src/map-tokenizer';

describe('map tokenizer', () => {
  test('tracks delimiters, comments, strings, and words with source positions', () => {
    const result = tokenizeMap('// entity 0\n{\n"classname" "worldspawn"\n( 1 -2 3.5e1 )\n}');

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map(token => [token.kind, token.value, token.line, token.column])).toEqual([
      ['comment', 'entity 0', 1, 1],
      ['brace-open', '{', 2, 1],
      ['string', 'classname', 3, 1],
      ['string', 'worldspawn', 3, 13],
      ['paren-open', '(', 4, 1],
      ['word', '1', 4, 3],
      ['word', '-2', 4, 5],
      ['word', '3.5e1', 4, 8],
      ['paren-close', ')', 4, 14],
      ['brace-close', '}', 5, 1],
      ['eof', '', 5, 2],
    ]);
  });

  test('supports escaped property values', () => {
    const result = tokenizeMap('"message" "say \\"hello\\"\\\\world"');

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.filter(token => token.kind === 'string').map(token => token.value)).toEqual([
      'message',
      'say "hello"\\world',
    ]);
  });

  test('reports an unterminated string at its opening quote', () => {
    const result = tokenizeMap('{\n"classname" "worldspawn\n}');

    expect(result.diagnostics).toEqual([{
      severity: 'error',
      line: 2,
      column: 13,
      message: 'Unterminated quoted string',
    }]);
  });

  test('tokenizes delimiters without requiring line boundaries', () => {
    const result = tokenizeMap('{{(0 1 2)}}');

    expect(result.tokens.map(token => token.kind)).toEqual([
      'brace-open',
      'brace-open',
      'paren-open',
      'word',
      'word',
      'word',
      'paren-close',
      'brace-close',
      'brace-close',
      'eof',
    ]);
  });
});
