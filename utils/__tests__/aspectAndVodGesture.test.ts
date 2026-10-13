import {
  AUTO_FILL_MAX_CROP,
  ASPECT_MODES,
  cropFractionOfFill,
  isAspectMode,
  nextAspectMode,
  resolveVideoFit,
} from "../aspectMode";
import { clampSeek, isHorizontalDrag, seekDeltaMs, tapZone } from "../vodGesture";

const phone20x9 = { width: 891, height: 411 }; // 小米 15 Pro 横屏
const v16x9 = { width: 1920, height: 1080 };
const v4x3 = { width: 640, height: 480 };

describe("aspectMode", () => {
  it("非全屏始终适应", () => {
    for (const m of ASPECT_MODES) expect(resolveVideoFit(m, v16x9, phone20x9, false)).toBe("contain");
  });

  it("手动模式按选择", () => {
    expect(resolveVideoFit("fit", v16x9, phone20x9, true)).toBe("contain");
    expect(resolveVideoFit("fill", v4x3, phone20x9, true)).toBe("cover");
    expect(resolveVideoFit("stretch", v16x9, phone20x9, true)).toBe("stretch");
  });

  it("自动：16:9 铺满 20:9（裁约 20%），4:3 保持适应（裁太多）", () => {
    expect(cropFractionOfFill(v16x9, phone20x9)).toBeCloseTo(0.2, 1);
    expect(resolveVideoFit("auto", v16x9, phone20x9, true)).toBe("cover");
    expect(cropFractionOfFill(v4x3, phone20x9)).toBeGreaterThan(AUTO_FILL_MAX_CROP);
    expect(resolveVideoFit("auto", v4x3, phone20x9, true)).toBe("contain");
  });

  it("自动：尺寸未知时适应", () => {
    expect(resolveVideoFit("auto", null, phone20x9, true)).toBe("contain");
    expect(resolveVideoFit("auto", v16x9, { width: 0, height: 0 }, true)).toBe("contain");
  });

  it("切换顺序循环 & 校验", () => {
    expect(nextAspectMode("auto")).toBe("fit");
    expect(nextAspectMode("stretch")).toBe("auto");
    expect(isAspectMode("fill")).toBe(true);
    expect(isAspectMode("x")).toBe(false);
  });
});

describe("vodGesture", () => {
  it("点按分区", () => {
    expect(tapZone(100, 1000)).toBe("left");
    expect(tapZone(500, 1000)).toBe("center");
    expect(tapZone(900, 1000)).toBe("right");
  });

  it("水平拖动判定", () => {
    expect(isHorizontalDrag(60, 10)).toBe(true);
    expect(isHorizontalDrag(60, 50)).toBe(false);
    expect(isHorizontalDrag(5, 0)).toBe(false);
  });

  it("seek 偏移：满屏宽最多 2 分钟，限制在时长内", () => {
    expect(seekDeltaMs(500, 1000, 3_600_000)).toBe(60_000);
    expect(seekDeltaMs(-1000, 1000, 3_600_000)).toBe(-120_000);
    expect(seekDeltaMs(500, 1000, 40_000)).toBe(20_000);
    expect(clampSeek(10_000, -30_000, 100_000)).toBe(0);
    expect(clampSeek(90_000, 30_000, 100_000)).toBe(100_000);
  });
});
