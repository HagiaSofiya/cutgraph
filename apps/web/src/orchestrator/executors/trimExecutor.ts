import { actions } from '@cutgraph/shared';
import type { MediaRef, TrimParams } from '@cutgraph/shared';
import { putResultBlob } from '../../media/blobStore';
import * as mediabunnyClient from '../../media/mediabunnyClient';
import type { Executor, ExecutorContext } from './types';

export const trimExecutor: Executor = {
  async run(ctx: ExecutorContext): Promise<MediaRef> {
    ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));

    const upstream = ctx.upstream[0];
    if (!upstream) throw new Error('Trim has no upstream video');

    const params = ctx.node.params as TrimParams;
    const { blob, width, height, durationSec } = await mediabunnyClient.trim(upstream.url, params.start, params.end);
    const url = putResultBlob(ctx.cacheKey, blob);
    const posterUrl = await mediabunnyClient.extractPoster(url, 0);

    return { id: ctx.cacheKey, kind: 'video', url, durability: 'ephemeral', posterUrl, width, height, durationSec };
  },
};
