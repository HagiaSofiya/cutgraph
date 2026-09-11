import { actions } from '@cutgraph/shared';
import type { MediaRef } from '@cutgraph/shared';
import { putResultBlob } from '../../media/blobStore';
import * as mediabunnyClient from '../../media/mediabunnyClient';
import type { Executor, ExecutorContext } from './types';

export const concatExecutor: Executor = {
  async run(ctx: ExecutorContext): Promise<MediaRef> {
    ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));

    if (ctx.upstream.length === 0) throw new Error('Concat has no upstream clips');

    // ctx.upstream is already in the fixed in-0..in-3 handle order (see selectors' handle
    // sort), so this is a straight sequential concatenation, not a re-sort.
    const urls = ctx.upstream.map((ref) => ref.url);
    const { blob, width, height, durationSec } = await mediabunnyClient.concat(urls);
    const url = putResultBlob(ctx.cacheKey, blob);
    const posterUrl = await mediabunnyClient.extractPoster(url, 0);

    return { id: ctx.cacheKey, kind: 'video', url, durability: 'ephemeral', posterUrl, width, height, durationSec };
  },
};
