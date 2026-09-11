import { actions } from '@cutgraph/shared';
import type { ExportParams, MediaRef } from '@cutgraph/shared';
import { putResultBlob } from '../../media/blobStore';
import * as mediabunnyClient from '../../media/mediabunnyClient';
import type { Executor, ExecutorContext } from './types';

export const exportExecutor: Executor = {
  async run(ctx: ExecutorContext): Promise<MediaRef> {
    ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));

    const upstream = ctx.upstream[0];
    if (!upstream) throw new Error('Export has no upstream video');

    const params = ctx.node.params as ExportParams;
    const { blob, width, height, durationSec } = await mediabunnyClient.remux(upstream.url);
    mediabunnyClient.triggerDownload(blob, params.filename);
    const url = putResultBlob(ctx.cacheKey, blob);

    // No posterUrl: nothing renders a preview for an Export node's own output.
    return { id: ctx.cacheKey, kind: 'video', url, durability: 'ephemeral', width, height, durationSec };
  },
};
