import type { NodeType } from '@cutgraph/shared';
import { concatExecutor } from './concatExecutor';
import { exportExecutor } from './exportExecutor';
import { imageInputExecutor } from './imageInputExecutor';
import { imageToVideoExecutor } from './imageToVideoExecutor';
import { textToImageExecutor } from './textToImageExecutor';
import { trimExecutor } from './trimExecutor';
import type { Executor } from './types';

export const executorsByNodeType: Record<NodeType, Executor> = {
  imageInput: imageInputExecutor,
  textToImage: textToImageExecutor,
  imageToVideo: imageToVideoExecutor,
  trim: trimExecutor,
  concat: concatExecutor,
  export: exportExecutor,
};

export type { Executor, ExecutorContext } from './types';
