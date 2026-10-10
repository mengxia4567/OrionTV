/**
 * 熊猫遮罩 —— 纯几何计算（v3 参数，与 maskgen.py 逐位一致）
 *
 * ears/head/lens 坐标空间 1024×1024（同 assets/images/splash-logo.svg 语义）
 * 屏幕映射：内容高 = hfrac × 屏高；居中于 (0.5 × W, cy × H)
 * 判定：thr=.45（亮格最低覆盖）、holeThr=.55（暗洞最低覆盖）
 *
 * 独立成文件的原因：PhotoWallSplash 组件链依赖 file-system / async-storage 等原生模块，
 * 而本模块为纯函数，可供组件与单元测试直接导入。
 */

const EARS: number[][] = [[396, 360, 84], [628, 360, 84]];
const HEAD: number[] = [512, 540, 225, 205];
const LENS: number[][] = [[384, 522, 92], [640, 522, 92]];
const CONTENT_H = 461;
const CENTER_X = 512;
const CENTER_Y = 510.5;
const HFRAC = 0.78;
const CY = 0.43;
const THR = 0.45;
const HOLE_THR = 0.55;

/** 返回 0=暗格 1=亮格 2=暗洞（眼斑） */
export function computePandaMask(cols: number, rows: number): number[][] {
  const ss = 12;
  const w = cols * ss;
  const h = rows * ss;
  const scale = (HFRAC * h) / CONTENT_H;
  const ccx = w / 2;
  const ccy = CY * h;
  const cir = (x: number, y: number, c: number[]) =>
    (x - c[0]) ** 2 + (y - c[1]) ** 2 <= c[2] * c[2];
  const ell = (x: number, y: number) =>
    ((x - HEAD[0]) / HEAD[2]) ** 2 + ((y - HEAD[1]) / HEAD[3]) ** 2 <= 1;
  const cls = (u: number, v: number) => {
    const x = CENTER_X + (u - ccx) / scale;
    const y = CENTER_Y + (v - ccy) / scale;
    if (!(EARS.some((e) => cir(x, y, e)) || ell(x, y))) return 0;
    return LENS.some((l) => cir(x, y, l)) ? 2 : 1;
  };
  const mask: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cnt = [0, 0, 0];
      for (let i = 0; i < ss; i++) {
        for (let j = 0; j < ss; j++) {
          cnt[cls(c * ss + i + 0.5, r * ss + j + 0.5)] += 1;
        }
      }
      const total = ss * ss;
      row.push(cnt[2] / total >= HOLE_THR ? 2 : cnt[1] / total >= THR ? 1 : 0);
    }
    mask.push(row);
  }
  return mask;
}
