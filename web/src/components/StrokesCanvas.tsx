import { useEffect, useRef } from 'react';
import type { Stroke } from '@draw-guess/shared';
import { renderStrokes } from '../render';

/** 只读画布:把一组笔画渲染成图(缩略图/回放),自适应父容器尺寸(需父容器有 4:3 比例) */
export function StrokesCanvas({
  strokes,
  className,
}: {
  strokes: Stroke[];
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const render = (): void => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      renderStrokes(ctx, strokes, canvas.width, canvas.height);
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [strokes]);
  return <canvas ref={ref} className={className} />;
}
