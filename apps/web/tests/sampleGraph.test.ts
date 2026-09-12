import { GraphSchema, topoSort, validateNodeParams } from '@cutgraph/shared';
import type { NodeTypeKey } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import { terminalNodeIds } from '../src/orchestrator/runGraph';
import { createSampleGraph } from '../src/state/sampleGraph';

describe('createSampleGraph', () => {
  it('is a structurally valid graph', () => {
    expect(GraphSchema.safeParse(createSampleGraph()).success).toBe(true);
  });

  it('gives every node params its own strict schema accepts', () => {
    for (const node of Object.values(createSampleGraph().nodes)) {
      const parsed = validateNodeParams(node.type as NodeTypeKey, node.params);
      expect(parsed.success, `${node.type} params: ${JSON.stringify(node.params)}`).toBe(true);
    }
  });

  it('keeps every edge the reducer was offered', () => {
    // EDGE_ADDED silently drops an edge with a missing endpoint or an occupied target handle,
    // so a short edge count is how a broken sample would show up.
    const graph = createSampleGraph();
    expect(Object.keys(graph.nodes)).toHaveLength(5);
    expect(Object.keys(graph.edges)).toHaveLength(5);

    for (const edge of Object.values(graph.edges)) {
      expect(graph.nodes[edge.source]).toBeDefined();
      expect(graph.nodes[edge.target]).toBeDefined();
    }
  });

  it('feeds Concat through distinct target handles', () => {
    const graph = createSampleGraph();
    const concatId = Object.values(graph.nodes).find((n) => n.type === 'concat')!.id;
    const handles = Object.values(graph.edges)
      .filter((e) => e.target === concatId)
      .map((e) => e.targetHandle);

    expect(handles).toHaveLength(2);
    expect(new Set(handles).size).toBe(2);
  });

  it('is acyclic and reachable from a single terminal node', () => {
    const graph = createSampleGraph();
    const terminals = terminalNodeIds(graph);

    expect(terminals).toHaveLength(1);
    expect(graph.nodes[terminals[0]].type).toBe('export');
    expect(topoSort(graph, terminals)).toHaveLength(5);
  });

  it('ships idle with nothing pre-run', () => {
    const graph = createSampleGraph();
    expect(graph.resultCache).toEqual({});

    for (const node of Object.values(graph.nodes)) {
      expect(node.status).toBe('idle');
      expect(node.result).toBeUndefined();
      expect(node.cacheKey).toBeUndefined();
      expect(node.jobId).toBeUndefined();
    }
  });

  it('mints fresh node ids per call, so a re-load repositions instead of reusing stale canvas positions', () => {
    const first = Object.keys(createSampleGraph().nodes);
    const second = Object.keys(createSampleGraph().nodes);

    expect(first).toHaveLength(second.length);
    expect(first.some((id) => second.includes(id))).toBe(false);
  });
});
