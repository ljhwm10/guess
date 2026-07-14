import { CANVAS_BG, CANVAS_W, type Stroke } from '@draw-guess/shared';

/**
 * 把单条笔画完整绘制到 2D 上下文。
 * 坐标为 0..1 归一化(相对 800×600 逻辑面),按目标画布宽高铺开;线宽随尺寸等比缩放。
 */
export function drawStrokeFull(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  canvasW: number,
  canvasH: number,
): void {
  const pts = stroke.points;
  const k = canvasW / CANVAS_W;
  ctx.strokeStyle = stroke.tool === 'eraser' ? CANVAS_BG : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.width * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length < 4) {
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.arc(pts[0] * canvasW, pts[1] * canvasH, (stroke.width * k) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0] * canvasW, pts[1] * canvasH);
  for (let i = 2; i + 1 < pts.length; i += 2) {
    ctx.lineTo(pts[i] * canvasW, pts[i + 1] * canvasH);
  }
  ctx.stroke();
}

/** 铺白底并渲染全部笔画(只读回放/缩略图用) */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  canvasW: number,
  canvasH: number,
): void {
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, canvasW, canvasH);
  for (const s of strokes) drawStrokeFull(ctx, s, canvasW, canvasH);
}
