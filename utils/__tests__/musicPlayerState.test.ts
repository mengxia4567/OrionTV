import { mapPlayerState, isTransitionalState, parseDurationText } from "../musicPlayerState";

describe("mapPlayerState", () => {
  it("playing → 播放中、不缓冲、不加载", () => {
    expect(mapPlayerState("playing")).toEqual({ isPlaying: true, isBuffering: false, isLoading: false });
  });
  it("buffering → 缓冲但不算加载新曲", () => {
    expect(mapPlayerState("buffering")).toEqual({ isPlaying: false, isBuffering: true, isLoading: false });
  });
  it("loading → 缓冲 + 加载中", () => {
    expect(mapPlayerState("loading")).toEqual({ isPlaying: false, isBuffering: true, isLoading: true });
  });
  it.each(["ready", "paused", "stopped", "none", "ended", "error", "whatever"])("%s → 全 false", (s) => {
    expect(mapPlayerState(s)).toEqual({ isPlaying: false, isBuffering: false, isLoading: false });
  });
});

describe("isTransitionalState", () => {
  it("换曲瞬间的 none/stopped/ended 是过渡态", () => {
    expect(isTransitionalState("none")).toBe(true);
    expect(isTransitionalState("stopped")).toBe(true);
    expect(isTransitionalState("ended")).toBe(true);
  });
  it("真实播放态不是过渡态", () => {
    for (const s of ["ready", "playing", "paused", "buffering", "loading", "error"]) {
      expect(isTransitionalState(s)).toBe(false);
    }
  });
});

describe("parseDurationText", () => {
  it("mm:ss", () => expect(parseDurationText("03:51")).toBe(231));
  it("h:mm:ss", () => expect(parseDurationText("1:02:03")).toBe(3723));
  it("纯数字当秒", () => expect(parseDurationText("231")).toBe(231));
  it("空/非法 → undefined", () => {
    expect(parseDurationText("")).toBeUndefined();
    expect(parseDurationText(undefined)).toBeUndefined();
    expect(parseDurationText("abc")).toBeUndefined();
    expect(parseDurationText("00:00")).toBeUndefined();
    expect(parseDurationText("1:2:3:4")).toBeUndefined();
  });
});
