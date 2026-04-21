import { Rect, type RectProps } from 'fabric';

export interface BaseClipProps extends Partial<RectProps> {
  elementId: string;
  text: string;
  src?: string;
}

export abstract class BaseTimelineClip extends Rect {
  elementId: string;
  text: string;
  src?: string;
  public timeScale: number = 1;
  public locked: boolean = false;

  constructor(options: BaseClipProps) {
    super(options);
    this.elementId = options.elementId;
    this.text = options.text;
    this.src = options.src;

    this.set({
      rx: 4, // Rounded corners
      ry: 4,
      cornerSize: 6,
      selectable: true,
      hasControls: true,
      lockRotation: true,
      lockScalingY: true, // Only horizontal resizing makes sense usually
    });
  }

  isSelected: boolean = false;

  public setSelected(selected: boolean) {
    this.isSelected = selected;
    this.set({ dirty: true });
  }

  protected drawLockGlyph(ctx: CanvasRenderingContext2D) {
    if (!this.locked) return;

    const pad = 6;
    const pillW = 18;
    const pillH = 16;
    const x = this.width / 2 - pad - pillW;
    const y = -this.height / 2 + pad;

    ctx.save();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.3;

    const cx = x + pillW / 2;
    const shackleTop = y + 4;
    const shackleRadius = 2.8;

    ctx.beginPath();
    ctx.arc(cx, shackleTop + shackleRadius, shackleRadius, Math.PI, 0, false);
    ctx.stroke();

    const bodyW = 8;
    const bodyH = 6;
    ctx.beginPath();
    ctx.roundRect(cx - bodyW / 2, y + 7, bodyW, bodyH, 1);
    ctx.fill();

    ctx.restore();
  }
}
