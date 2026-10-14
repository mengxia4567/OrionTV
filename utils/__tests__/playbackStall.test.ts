import { createStallTracker, trackPosition, isStalled, shouldShowBuffering, STALL_AFTER_MS } from "../playbackStall";

describe("playbackStall", () => {
  it("从未推进过：算卡住（首次加载时应显示加载圈）", () => {
    const t = createStallTracker();
    const now = 1_700_000_000_000;
    trackPosition(t, 0, now);
    expect(isStalled(t, now)).toBe(true);
    expect(shouldShowBuffering(true, false, t, now)).toBe(true);
  });

  it("画面在播放（isPlaying 为 true）时，isBuffering 一直为 true 也不显示", () => {
    const t = createStallTracker();
    trackPosition(t, 0, 0);
    expect(shouldShowBuffering(true, true, t, 60000)).toBe(false);
  });

  it("位置在前进：即使 isPlaying 抖成 false 也不显示加载圈", () => {
    const t = createStallTracker();
    let now = 10000;
    let pos = 5000;
    trackPosition(t, pos, now);
    for (let i = 0; i < 20; i++) {
      now += 500;
      pos += 500;
      trackPosition(t, pos, now);
      expect(shouldShowBuffering(true, false, t, now)).toBe(false);
    }
  });

  it("位置停住超过阈值才显示加载圈，恢复前进后立刻消失", () => {
    const t = createStallTracker();
    trackPosition(t, 1000, 0);
    trackPosition(t, 1500, 500);
    expect(shouldShowBuffering(true, false, t, 500)).toBe(false);
    trackPosition(t, 1500, 1500);
    expect(shouldShowBuffering(true, false, t, 1500)).toBe(false);
    trackPosition(t, 1500, 500 + STALL_AFTER_MS);
    expect(shouldShowBuffering(true, false, t, 500 + STALL_AFTER_MS)).toBe(true);
    trackPosition(t, 2000, 2500);
    expect(shouldShowBuffering(true, false, t, 2500)).toBe(false);
  });

  it("不在缓冲状态时永远不显示（暂停等）", () => {
    const t = createStallTracker();
    trackPosition(t, 0, 0);
    expect(shouldShowBuffering(false, false, t, 99999)).toBe(false);
  });

  it("向后拖动进度不算前进，需等位置重新推进", () => {
    const t = createStallTracker();
    trackPosition(t, 9000, 0);
    trackPosition(t, 9500, 500);
    trackPosition(t, 2000, 1000);
    expect(isStalled(t, 1000 + STALL_AFTER_MS)).toBe(true);
    trackPosition(t, 2600, 3000);
    expect(isStalled(t, 3000)).toBe(false);
  });
});
