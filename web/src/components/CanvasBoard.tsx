import { useEffect, useRef } from 'react';
import { CANVAS_BG, CANVAS_W, type Stroke, type Tool } from '@draw-guess/shared';
import { getStrokeById, localPoints, localStroke, onDrawEvent, strokeCache } from '../socket';
import { uid } from '../utils';

interface Props {
  canDraw: boolean;
  tool: Tool;
  color: string;
  width: number;
}

const FLUSH_MS = 40;

/**
 * 画板:固定 4:3 逻辑面(800×600),坐标归一化 0..1 传输;
 * 各端按自身尺寸等比渲染,构图完全一致。
 */
export function CanvasBoard({ canDraw, tool, color, width }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 用 ref 持有最新画笔配置,避免重挂 pointer 监听
  const brushRef = useRef({ canDraw, tool, color, width });
  brushRef.current = { canDraw, tool, color, width };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;

    const scale = (): number => canvas.width / CANVAS_W;

    const drawSegments = (stroke: Stroke, fromPointIndex: number): void => {
      const pts = stroke.points;
      const k = scale();
      ctx.strokeStyle = stroke.tool === 'eraser' ? CANVAS_BG : stroke.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = stroke.width * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (pts.length < 4) {
        // 单点:画圆点
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.arc(pts[0] * canvas.width, pts[1] * canvas.height, (stroke.width * k) / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      const start = Math.max(0, fromPointIndex - 2);
      ctx.beginPath();
      ctx.moveTo(pts[start] * canvas.width, pts[start + 1] * canvas.height);
      for (let i = start + 2; i + 1 < pts.length; i += 2) {
        ctx.lineTo(pts[i] * canvas.width, pts[i + 1] * canvas.height);
      }
      ctx.stroke();
    };

    const redrawAll = (): void => {
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of strokeCache) drawSegments(s, 0);
    };

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      redrawAll();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const offDraw = onDrawEvent((e) => {
      if (e.type === 'sync' || e.type === 'clear') {
        redrawAll();
      } else if (e.type === 'stroke') {
        drawSegments(e.stroke, 0);
      } else if (e.type === 'point') {
        const s = getStrokeById(e.strokeId);
        if (s) drawSegments(s, s.points.length - e.points.length);
      }
    });

    // ---------- 本地作画 ----------
    let drawing = false;
    let strokeId = '';
    let last: [number, number] | null = null;
    let buffer: number[] = [];
    let lastFlush = 0;

    const pos = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      return [x, y];
    };

    const flush = (): void => {
      if (buffer.length > 0) {
        localPoints(strokeId, buffer);
        buffer = [];
      }
      lastFlush = performance.now();
    };

    const renderLocalSegment = (from: [number, number], to: [number, number]): void => {
      const b = brushRef.current;
      const k = scale();
      ctx.strokeStyle = b.tool === 'eraser' ? CANVAS_BG : b.color;
      ctx.lineWidth = b.width * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from[0] * canvas.width, from[1] * canvas.height);
      ctx.lineTo(to[0] * canvas.width, to[1] * canvas.height);
      ctx.stroke();
    };

    const onDown = (e: PointerEvent): void => {
      const b = brushRef.current;
      if (!b.canDraw || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      strokeId = uid();
      const p = pos(e);
      last = p;
      buffer = [];
      lastFlush = performance.now();
      const stroke: Stroke = {
        id: strokeId,
        tool: b.tool,
        color: b.tool === 'eraser' ? CANVAS_BG : b.color,
        width: b.width,
        points: [p[0], p[1]],
      };
      localStroke(stroke);
      // 落笔即画一个点
      const k = scale();
      ctx.fillStyle = stroke.tool === 'eraser' ? CANVAS_BG : stroke.color;
      ctx.beginPath();
      ctx.arc(p[0] * canvas.width, p[1] * canvas.height, (stroke.width * k) / 2, 0, Math.PI * 2);
      ctx.fill();
    };

    const onMove = (e: PointerEvent): void => {
      if (!drawing || !last) return;
      e.preventDefault();
      const p = pos(e);
      // 距离太近的点丢弃,减小数据量
      if (Math.abs(p[0] - last[0]) < 0.002 && Math.abs(p[1] - last[1]) < 0.002) return;
      renderLocalSegment(last, p);
      buffer.push(p[0], p[1]);
      last = p;
      if (performance.now() - lastFlush > FLUSH_MS) flush();
    };

    const onUp = (e: PointerEvent): void => {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
      flush();
      last = null;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      ro.disconnect();
      offDraw();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`canvas-wrap ${canDraw ? 'can-draw' : ''}`}>
      <canvas ref={canvasRef} className="board" />
    </div>
  );
}
