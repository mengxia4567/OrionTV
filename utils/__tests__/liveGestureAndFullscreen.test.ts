import { classifySwipe, isDoubleTap } from "../liveGesture";
import { fullscreenOrientationFor } from "../fullscreenPolicy";

describe("classifySwipe", () => {
  it("位移不足视为点按", () => {
    expect(classifySwipe(10, -20)).toBeNull();
  });
  it("竖直滑动：上=up 下=down", () => {
    expect(classifySwipe(5, -120)).toBe("up");
    expect(classifySwipe(-5, 120)).toBe("down");
  });
  it("水平滑动：左=left 右=right", () => {
    expect(classifySwipe(-130, 8)).toBe("left");
    expect(classifySwipe(130, -8)).toBe("right");
  });
  it("斜划（两轴接近）不触发", () => {
    expect(classifySwipe(90, 90)).toBeNull();
  });
  it("可自定义阈值", () => {
    expect(classifySwipe(0, -30, { minDistance: 20 })).toBe("up");
  });
});

describe("isDoubleTap", () => {
  it("首次点按不是双击", () => {
    expect(isDoubleTap(null, 1000)).toBe(false);
  });
  it("窗口内是双击，窗口外不是", () => {
    expect(isDoubleTap(1000, 1200)).toBe(true);
    expect(isDoubleTap(1000, 1400)).toBe(false);
  });
});

describe("fullscreenOrientationFor", () => {
  it("横屏内容 → landscape", () => {
    expect(fullscreenOrientationFor({ width: 1920, height: 1080 })).toBe("landscape");
  });
  it("竖屏内容 → portrait", () => {
    expect(fullscreenOrientationFor({ width: 1080, height: 1920 })).toBe("portrait");
  });
  it("方形/未知 → landscape（影视与直播绝大多数是横屏）", () => {
    expect(fullscreenOrientationFor({ width: 800, height: 800 })).toBe("landscape");
    expect(fullscreenOrientationFor(null)).toBe("landscape");
    expect(fullscreenOrientationFor({ width: 0, height: 0 })).toBe("landscape");
  });
});
