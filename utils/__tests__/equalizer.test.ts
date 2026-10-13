import { barTarget, barDuration, BAR_MIN, BAR_MAX } from "../equalizer";

describe("barTarget", () => {
  it("永远落在 [BAR_MIN, BAR_MAX]", () => {
    for (let n = 0; n < 500; n++) {
      for (let i = 0; i < 9; i++) {
        const v = barTarget({ index: i, count: 9, prev: Math.random() });
        expect(v).toBeGreaterThanOrEqual(BAR_MIN);
        expect(v).toBeLessThanOrEqual(BAR_MAX);
      }
    }
  });

  it("平滑：相对上一次变化不超过 maxStep", () => {
    for (let n = 0; n < 300; n++) {
      const prev = BAR_MIN + Math.random() * (BAR_MAX - BAR_MIN);
      const v = barTarget({ index: 4, count: 9, prev, maxStep: 0.3 });
      expect(Math.abs(v - prev)).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });

  it("中间的条上限高于两侧（rnd=0.9999 取到各自上限附近）", () => {
    const mid = barTarget({ index: 4, count: 9, prev: 1, rnd: () => 0.9999, maxStep: 1 });
    const edge = barTarget({ index: 0, count: 9, prev: 1, rnd: () => 0.9999, maxStep: 1 });
    expect(mid).toBeGreaterThan(edge);
  });

  it("rnd=0 时取下限（收敛到最低）", () => {
    expect(barTarget({ index: 4, count: 9, prev: BAR_MIN, rnd: () => 0 })).toBeCloseTo(BAR_MIN, 5);
  });

  it("count=1 不除零", () => {
    const v = barTarget({ index: 0, count: 1, prev: 0.5 });
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe("barDuration", () => {
  it("在 [220, 480) 内", () => {
    expect(barDuration(() => 0)).toBe(220);
    expect(barDuration(() => 0.9999)).toBeLessThan(480);
  });
});
