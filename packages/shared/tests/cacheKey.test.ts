import { describe, expect, it } from 'vitest';
import { deriveCacheKey } from '../src/cache/cacheKey';

describe('deriveCacheKey', () => {
  it('is stable for identical inputs', () => {
    const input = {
      nodeType: 'trim' as const,
      params: { start: 1, end: 5 },
      upstream: [{ handle: null, sourceNodeId: 'a', outputId: 'out-a' }],
    };
    expect(deriveCacheKey(input)).toBe(deriveCacheKey(input));
  });

  it('is independent of the order upstream entries are passed in (insertion-order independence)', () => {
    const upstreamA = [
      { handle: 'in-0', sourceNodeId: 'clip-1', outputId: 'out-1' },
      { handle: 'in-1', sourceNodeId: 'clip-2', outputId: 'out-2' },
    ];
    const upstreamB = [...upstreamA].reverse();

    const keyA = deriveCacheKey({ nodeType: 'concat', params: {}, upstream: upstreamA });
    const keyB = deriveCacheKey({ nodeType: 'concat', params: {}, upstream: upstreamB });

    expect(keyA).toBe(keyB);
  });

  it('is sensitive to which handle each upstream output is connected to', () => {
    const swapped = [
      { handle: 'in-0', sourceNodeId: 'clip-2', outputId: 'out-2' },
      { handle: 'in-1', sourceNodeId: 'clip-1', outputId: 'out-1' },
    ];
    const original = [
      { handle: 'in-0', sourceNodeId: 'clip-1', outputId: 'out-1' },
      { handle: 'in-1', sourceNodeId: 'clip-2', outputId: 'out-2' },
    ];

    const keyOriginal = deriveCacheKey({ nodeType: 'concat', params: {}, upstream: original });
    const keySwapped = deriveCacheKey({ nodeType: 'concat', params: {}, upstream: swapped });

    expect(keyOriginal).not.toBe(keySwapped);
  });

  it('changes when params change', () => {
    const base = { nodeType: 'textToImage' as const, upstream: [] };
    const keyA = deriveCacheKey({ ...base, params: { prompt: 'a cat', ratio: '1:1' } });
    const keyB = deriveCacheKey({ ...base, params: { prompt: 'a dog', ratio: '1:1' } });
    expect(keyA).not.toBe(keyB);
  });

  it('changes when node type changes, even with identical params', () => {
    const params = { prompt: 'a cat', ratio: '1:1' };
    const keyA = deriveCacheKey({ nodeType: 'textToImage', params, upstream: [] });
    const keyB = deriveCacheKey({ nodeType: 'imageToVideo', params, upstream: [] });
    expect(keyA).not.toBe(keyB);
  });

  it('proves the headline caching property: editing shot 3 leaves shots 1-2 byte-identical', () => {
    // Linear graph: shot1 (imageInput) -> shot2 (imageToVideo) -> shot3 (trim)
    const shot1KeyA = deriveCacheKey({
      nodeType: 'imageInput',
      params: { sourceName: 'a.png', sourceSize: 100, sourceLastModified: 1 },
      upstream: [],
    });

    const shot2KeyA = deriveCacheKey({
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9' },
      upstream: [{ handle: null, sourceNodeId: 'shot1', outputId: shot1KeyA }],
    });

    const shot3KeyA = deriveCacheKey({
      nodeType: 'trim',
      params: { start: 0, end: 2 },
      upstream: [{ handle: null, sourceNodeId: 'shot2', outputId: shot2KeyA }],
    });

    // Now edit shot3's params only. shot1/shot2 are recomputed from unchanged inputs.
    const shot1KeyB = deriveCacheKey({
      nodeType: 'imageInput',
      params: { sourceName: 'a.png', sourceSize: 100, sourceLastModified: 1 },
      upstream: [],
    });
    const shot2KeyB = deriveCacheKey({
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9' },
      upstream: [{ handle: null, sourceNodeId: 'shot1', outputId: shot1KeyB }],
    });
    const shot3KeyB = deriveCacheKey({
      nodeType: 'trim',
      params: { start: 0, end: 3 }, // <- only this changed
      upstream: [{ handle: null, sourceNodeId: 'shot2', outputId: shot2KeyB }],
    });

    expect(shot1KeyB).toBe(shot1KeyA);
    expect(shot2KeyB).toBe(shot2KeyA);
    expect(shot3KeyB).not.toBe(shot3KeyA);
  });

  it('derives ImageInput identity from name/size/lastModified without hashing bytes', () => {
    const fileA = { sourceName: 'photo.png', sourceSize: 1024, sourceLastModified: 1700000000000 };
    const fileB = { sourceName: 'photo.png', sourceSize: 1024, sourceLastModified: 1700000000001 };

    const keyA1 = deriveCacheKey({ nodeType: 'imageInput', params: fileA, upstream: [] });
    const keyA2 = deriveCacheKey({ nodeType: 'imageInput', params: { ...fileA }, upstream: [] });
    const keyB = deriveCacheKey({ nodeType: 'imageInput', params: fileB, upstream: [] });

    expect(keyA1).toBe(keyA2);
    expect(keyA1).not.toBe(keyB);
  });
});
