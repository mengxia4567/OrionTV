/**
 * 照片墙网格分档 + 定时放大纯函数测试（v1.8.9 · B1）
 *
 * 背景：手机/平板格子要更大更疏（手机 4×6、平板 6×8），电视保持 16×9；
 * 「定时放大某张」需要按图片真实比例算目标矩形，并只挑有大图的格子。
 */
import { computeZoomRect, gridForDevice, pickZoomTargets } from "../PhotoWallGrid";

describe("gridForDevice 网格分档", () => {
  it("电视保持 16×9 / 9×16（沿用既有观感）", () => {
    expect(gridForDevice("tv", false)).toEqual({ cols: 16, rows: 9 });
    expect(gridForDevice("tv", true)).toEqual({ cols: 9, rows: 16 });
  });

  it("平板：竖屏 6×8，横屏 8×6", () => {
    expect(gridForDevice("tablet", true)).toEqual({ cols: 6, rows: 8 });
    expect(gridForDevice("tablet", false)).toEqual({ cols: 8, rows: 6 });
  });

  it("手机：竖屏 4×6，横屏 6×4", () => {
    expect(gridForDevice("mobile", true)).toEqual({ cols: 4, rows: 6 });
    expect(gridForDevice("mobile", false)).toEqual({ cols: 6, rows: 4 });
  });

  it("手机格子数不超过 24（相对旧的 6×10=60 约 2.5 倍单格面积）", () => {
    for (const portrait of [true, false]) {
      const g = gridForDevice("mobile", portrait);
      expect(g.cols * g.rows).toBe(24);
    }
  });

  it("各档位下格子近似方形（宽高比 0.5~2）", () => {
    const screens: [number, number, "tv" | "tablet" | "mobile", boolean][] = [
      [1920, 1080, "tv", false],
      [1024, 768, "tablet", false],
      [800, 1280, "tablet", true],
      [390, 844, "mobile", true],
      [844, 390, "mobile", false],
    ];
    for (const [w, h, device, portrait] of screens) {
      const { cols, rows } = gridForDevice(device, portrait);
      const ratio = w / cols / (h / rows);
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
    }
  });
});

describe("computeZoomRect 放大目标矩形", () => {
  it("横图：以宽度为约束，居中", () => {
    const r = computeZoomRect(400, 800, 1080, 810); // 4:3
    expect(r.w).toBeCloseTo(360); // 400*0.9
    expect(r.h).toBeCloseTo(270);
    expect(r.x).toBeCloseTo(20);
    expect(r.y).toBeCloseTo((800 - 270) / 2);
  });

  it("竖图（窄屏）：宽度先到上限，仍受宽度约束", () => {
    const r = computeZoomRect(400, 800, 810, 1080); // 3:4；宽 360 → 高 480 < 576
    expect(r.w).toBeCloseTo(360);
    expect(r.h).toBeCloseTo(480);
  });

  it("竖图（矮屏）：高度先到上限，改受高度约束", () => {
    const r = computeZoomRect(844, 390, 810, 1080); // 横屏手机；高上限 390*0.72=280.8
    expect(r.h).toBeCloseTo(280.8);
    expect(r.w).toBeCloseTo(280.8 * 0.75);
    expect(r.x + r.w).toBeLessThanOrEqual(844);
  });

  it("结果始终完整落在屏幕内且保持原比例", () => {
    const cases: [number, number, number, number][] = [
      [390, 844, 1080, 810],
      [390, 844, 810, 1080],
      [844, 390, 1080, 810],
      [844, 390, 810, 1080],
      [1280, 800, 810, 1080],
    ];
    for (const [sw, sh, iw, ih] of cases) {
      const r = computeZoomRect(sw, sh, iw, ih);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(sw + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(sh + 1e-6);
      expect(r.w / r.h).toBeCloseTo(iw / ih, 5);
    }
  });

  it("图片尺寸未知时按方形处理", () => {
    const r = computeZoomRect(400, 800, 0, 0);
    expect(r.w).toBeCloseTo(r.h);
  });
});

describe("pickZoomTargets 选择放大的格子", () => {
  // 6 格，照片序号 0,1,2,0,1,2
  const photoOf = [0, 1, 2, 0, 1, 2];

  it("只从有大图的格子里选", () => {
    const hasLarge = [false, true, false, false, true, false]; // 仅照片 1 有大图（两格）
    const picked = pickZoomTargets(photoOf, hasLarge, 2, () => 0.3);
    expect(picked.length).toBe(2);
    for (const i of picked) expect(hasLarge[i]).toBe(true);
  });

  it("优先挑不同照片", () => {
    const hasLarge = [true, true, true, true, true, true];
    for (let seed = 0; seed < 20; seed++) {
      let s = seed + 1;
      const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      const picked = pickZoomTargets(photoOf, hasLarge, 2, rand);
      expect(picked.length).toBe(2);
      expect(photoOf[picked[0]]).not.toBe(photoOf[picked[1]]);
    }
  });

  it("不同照片不够时用同照片的其它格子补足数量", () => {
    const hasLarge = [false, true, false, false, true, false]; // 只有照片 1
    const picked = pickZoomTargets(photoOf, hasLarge, 2, () => 0.5);
    expect(picked.sort()).toEqual([1, 4]);
  });

  it("没有任何大图时返回空（宁可不放大，也不放大糊图）", () => {
    expect(pickZoomTargets(photoOf, [false, false, false, false, false, false], 2)).toEqual([]);
  });

  it("不会选出重复格子，数量不超过 count", () => {
    const picked = pickZoomTargets(photoOf, [true, true, true, true, true, true], 4);
    expect(new Set(picked).size).toBe(picked.length);
    expect(picked.length).toBeLessThanOrEqual(4);
  });
});
