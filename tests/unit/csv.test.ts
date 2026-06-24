import { describe, it, expect } from 'vitest';
import { inferTierIdFromRow, parseCsv, parseCsvToObjects, parseGoogleFormsRegistrations, parseIndiaFormsTimestamp } from '../../src/lib/csv';

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

describe('Google Forms registration CSV', () => {
  const consent = 'By signing up for this trip, I acknowledge and understand that adventure activities involve inherent risks.\n\nMore terms';
  const header = ['Timestamp','What do we call you?','Email ID','WhatsApp No.','Emergency Contact','Gender','How old are you?',
    'Which city are you based out of currently?',"What’s your instagram handle?",'Why are you joining this trip?',
    'What stay option do you prefer?',consent,'Status'];
  const quote = (v:string) => `"${v.replaceAll('"','""')}"`;
  const csv = [header.map(quote).join(','),
    ['5/17/2026 16:59:33','Old Name','USER@EXAMPLE.COM','9876543210','9876543211','Female','28','Pune','@user','Reason','Double Sharing','I agree to the terms and conditions','Confirmed'].map(quote).join(','),
    ['5/18/2026 5:01:02','Latest Name','user@example.com','9876543210','9876543211','Female','28','Pune','@user','Reason','Triple Sharing','I agree to the terms and conditions',''].map(quote).join(','),
    ['bad','Invalid','invalid@example.com','9876543210','9876543211','Male','30','Delhi','','','Unknown','','Maybe'].map(quote).join(',')].join('\n');

  it('strictly converts India timestamps to UTC', () => {
    expect(parseIndiaFormsTimestamp('5/17/2026 16:59:33')).toBe('2026-05-17 11:29:33');
    expect(parseIndiaFormsTimestamp('2026-05-17 16:59:33')).toBeNull();
  });
  it('maps tiers/status/consent and supersedes the earlier duplicate', () => {
    const rows=parseGoogleFormsRegistrations(csv)!;
    expect(rows[0].superseded).toBe(true);
    expect(rows[1]).toMatchObject({full_name:'Latest Name',email:'user@example.com',tier_id:'triple',status:'lead',consent_at:'2026-05-17 23:31:02'});
    expect(rows[2].error).toContain('Invalid timestamp');
    expect(rows[2].error).toContain('Unknown stay option');
    expect(rows[2].error).toContain('Unknown status');
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

describe('inferTierIdFromRow', () => {
  it('reads the tier from common CSV column names', () => {
    expect(inferTierIdFromRow({ tier_id: 'double' })).toBe('double');
    expect(inferTierIdFromRow({ occupancy: 'triple' })).toBe('triple');
    expect(inferTierIdFromRow({ 'What stay option do you prefer?': 'double' })).toBe('double');
  });

  it('returns an empty string when no tier column is present', () => {
    expect(inferTierIdFromRow({ full_name: 'Asha' })).toBe('');
  });
});
