import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvToObjects } from '../../src/lib/csv';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('name,note\n"Rao, Asha","hi, there"')).toEqual([
      ['name', 'note'],
      ['Rao, Asha', 'hi, there'],
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsv('q\n"she said ""hi"""')).toEqual([['q'], ['she said "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('q\n"line1\nline2"')).toEqual([['q'], ['line1\nline2']]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops a single trailing empty line', () => {
    expect(parseCsv('a\n1\n')).toEqual([['a'], ['1']]);
  });
});

describe('parseCsvToObjects', () => {
  it('keys cells by lowercased header', () => {
    const rows = parseCsvToObjects('Full_Name,Email\nAsha,asha@example.com');
    expect(rows).toEqual([{ full_name: 'Asha', email: 'asha@example.com' }]);
  });

  it('trims cells and skips fully-blank lines', () => {
    const rows = parseCsvToObjects('name,email\n  Asha ,asha@x.com\n,\nBo,bo@x.com');
    expect(rows).toEqual([
      { name: 'Asha', email: 'asha@x.com' },
      { name: 'Bo', email: 'bo@x.com' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsvToObjects('')).toEqual([]);
  });

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsvToObjects('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});
