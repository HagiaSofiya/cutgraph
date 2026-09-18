import { describe, expect, it } from 'vitest';
import {
  graphFromDocument,
  imageInputCount,
  parseGraphFile,
  serializeGraphFile,
} from '../src/state/graphFile';
import { makeEdge, makeGraph, makeNode, makeResult } from './helpers';

function validGraph() {
  return makeGraph(
    [
      makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a cat', ratio: '1:1', model: 'gen4_image' } }),
      makeNode({ id: 'b', type: 'trim', params: { start: 0, end: 2 } }),
    ],
    [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
  );
}

describe('serializeGraphFile', () => {
  it('round-trips a graph through the file format', () => {
    const parsed = parseGraphFile(serializeGraphFile(validGraph()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.document.nodes).sort()).toEqual(['a', 'b']);
    expect(parsed.document.edges.ab.source).toBe('a');
    expect(parsed.document.nodes.a.params).toEqual({ prompt: 'a cat', ratio: '1:1', model: 'gen4_image' });
  });

  it('leaves runtime state and results out of the file entirely', () => {
    const graph = validGraph();
    graph.nodes.a = { ...graph.nodes.a, status: 'succeeded', result: makeResult('out-a'), jobId: 'job-1' };
    graph.resultCache['out-a'] = makeResult('out-a');

    const text = serializeGraphFile(graph);
    expect(text).not.toContain('succeeded');
    expect(text).not.toContain('job-1');
    expect(text).not.toContain('resultCache');
  });
});

describe('parseGraphFile', () => {
  it('rejects non-JSON', () => {
    expect(parseGraphFile('not json at all')).toEqual({ ok: false, error: 'That file is not valid JSON.' });
  });

  it('rejects JSON that is not a cutgraph graph file', () => {
    const result = parseGraphFile(JSON.stringify({ hello: 'world' }));
    expect(result).toEqual({ ok: false, error: 'That is not a cutgraph graph file.' });
  });

  it('rejects a file whose node params do not match its node type', () => {
    const result = parseGraphFile(
      JSON.stringify({
        format: 'cutgraph.graph',
        version: 1,
        document: {
          nodes: { a: { id: 'a', type: 'trim', position: { x: 0, y: 0 }, params: { start: 5, end: 1 } } },
          edges: {},
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('trim node "a"');
  });

  it('rejects an edge pointing at a node the file does not contain', () => {
    // The reducer guards this on EDGE_ADDED but not on a wholesale replace, so without this
    // check the target would land permanently blocked with nothing on screen to explain it.
    const result = parseGraphFile(
      JSON.stringify({
        format: 'cutgraph.graph',
        version: 1,
        document: {
          nodes: { a: { id: 'a', type: 'concat', position: { x: 0, y: 0 }, params: {} } },
          edges: { ghost: { id: 'ghost', source: 'missing', target: 'a' } },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('missing');
  });
});

describe('graphFromDocument', () => {
  it('starts every imported node idle and keeps the existing result cache', () => {
    const parsed = parseGraphFile(serializeGraphFile(validGraph()));
    if (!parsed.ok) throw new Error(parsed.error);

    const cache = { 'v1_existing': makeResult('v1_existing') };
    const graph = graphFromDocument(parsed.document, cache);

    expect(Object.values(graph.nodes).map((n) => n.status)).toEqual(['idle', 'idle']);
    expect(Object.values(graph.nodes).every((n) => n.result === undefined)).toBe(true);
    // Carried over, not cleared: cache keys depend only on type, params and upstream output
    // ids, so importing a pipeline this browser already ran is still a free hit.
    expect(graph.resultCache).toEqual(cache);
  });
});

describe('imageInputCount', () => {
  it('counts the nodes whose bytes a file cannot carry', () => {
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'imageInput', params: { sourceName: 'x.png', sourceSize: 1, sourceLastModified: 0 } }),
      makeNode({ id: 'b', type: 'concat', params: {} }),
    ]);
    const parsed = parseGraphFile(serializeGraphFile(graph));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(imageInputCount(parsed.document)).toBe(1);
  });
});
