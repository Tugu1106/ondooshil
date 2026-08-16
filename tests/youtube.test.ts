import { describe, expect, it } from 'vitest';

import { parseIso8601Duration, parseVideoId } from '@/lib/youtube';

/**
 * URL parsing and duration parsing (spec §10). Pure functions, so the whole matrix of
 * link shapes people actually paste can be checked without spending API quota.
 */

const ID = 'dQw4w9WgXcQ';

describe('parseVideoId', () => {
  it('accepts all five documented forms', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('takes the single video and discards the playlist', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}&list=PLabc123&index=4`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}?list=PLabc123`)).toBe(ID);
  });

  it('strips other extra parameters', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s&feature=share`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}?t=90`)).toBe(ID);
  });

  it('tolerates a missing scheme and surrounding whitespace', () => {
    expect(parseVideoId(`  youtube.com/watch?v=${ID}  `)).toBe(ID);
    expect(parseVideoId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('accepts the mobile and music hosts', () => {
    expect(parseVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('rejects a playlist link with no video', () => {
    expect(parseVideoId('https://www.youtube.com/playlist?list=PLabc123')).toBeNull();
  });

  it('rejects channels, searches and non-YouTube links', () => {
    expect(parseVideoId('https://www.youtube.com/@someone')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/results?search_query=music')).toBeNull();
    expect(parseVideoId('https://vimeo.com/123456')).toBeNull();
    expect(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejects malformed ids and empty input', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=tooshort')).toBeNull();
    expect(parseVideoId('https://youtu.be/way-too-long-to-be-an-id')).toBeNull();
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('   ')).toBeNull();
    expect(parseVideoId('not a url at all')).toBeNull();
  });

  it('does not treat a bare id as a link', () => {
    // Spec §10 enumerates the accepted forms; a bare id is not one of them.
    expect(parseVideoId(ID)).toBeNull();
  });
});

describe('parseIso8601Duration', () => {
  it('parses the shapes YouTube returns', () => {
    expect(parseIso8601Duration('PT3M34S')).toBe(214);
    expect(parseIso8601Duration('PT19S')).toBe(19);
    expect(parseIso8601Duration('PT10M')).toBe(600);
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601Duration('PT2H')).toBe(7200);
  });

  it('returns 0 for a live broadcast, which the caller rejects', () => {
    // Live streams report P0D. A null duration would freeze the timeline permanently,
    // which is exactly why they are refused at add time.
    expect(parseIso8601Duration('P0D')).toBe(0);
  });

  it('returns null for anything it cannot parse', () => {
    expect(parseIso8601Duration('')).toBeNull();
    expect(parseIso8601Duration('PT')).toBeNull();
    expect(parseIso8601Duration('3:34')).toBeNull();
    expect(parseIso8601Duration('nonsense')).toBeNull();
  });
});
