import type { MediaRef } from '@cutgraph/shared';
import { useEffect, useState } from 'react';
import { extractPoster } from '../media/mediabunnyClient';

const mediaStyle: React.CSSProperties = {
  width: '100%',
  height: 120,
  objectFit: 'cover',
  borderRadius: 4,
  background: '#000',
  display: 'block',
};

const placeholderStyle: React.CSSProperties = {
  ...mediaStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
};

interface MediaPreviewProps {
  result?: MediaRef;
  isActive: boolean; // hovered or selected -- only then does a live <video> mount
}

// A twelve-node graph must never hold twelve decoded videos: every node shows its poster
// <img> by default, and a real <video> element mounts only while this one is hovered or
// selected.
export function MediaPreview({ result, isActive }: MediaPreviewProps) {
  const [lazyPosterUrl, setLazyPosterUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setLazyPosterUrl(undefined);
    if (!result || result.kind !== 'video' || result.posterUrl) return;

    let cancelled = false;
    extractPoster(result.url, 0)
      .then((url) => {
        if (!cancelled) setLazyPosterUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!result) return <div style={placeholderStyle}>No output yet</div>;

  if (result.kind === 'image') {
    return <img src={result.url} alt="" style={mediaStyle} />;
  }

  if (isActive) {
    return <video src={result.url} style={mediaStyle} autoPlay muted loop playsInline />;
  }

  const posterUrl = result.posterUrl ?? lazyPosterUrl;
  return posterUrl ? <img src={posterUrl} alt="" style={mediaStyle} /> : <div style={placeholderStyle}>Loading preview…</div>;
}
