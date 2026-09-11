import { ConcatNode } from '../nodes/ConcatNode';
import { ExportNode } from '../nodes/ExportNode';
import { ImageInputNode } from '../nodes/ImageInputNode';
import { ImageToVideoNode } from '../nodes/ImageToVideoNode';
import { TextToImageNode } from '../nodes/TextToImageNode';
import { TrimNode } from '../nodes/TrimNode';

export const nodeTypes = {
  imageInput: ImageInputNode,
  textToImage: TextToImageNode,
  imageToVideo: ImageToVideoNode,
  trim: TrimNode,
  concat: ConcatNode,
  export: ExportNode,
};
