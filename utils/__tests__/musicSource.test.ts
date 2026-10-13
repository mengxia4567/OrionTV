import { pickBestMatch, normalizeText, artistTokens, durationSeconds, sourceLabel, otherSource } from "../musicSource";

describe("normalizeText", () => {
  it("去括号版本说明与标点空白、转小写", () => {
    expect(normalizeText("想你就写信 (Live)")).toBe("想你就写信");
    expect(normalizeText("Rise Without A Sound")).toBe("risewithoutasound");
    expect(normalizeText("屋顶【伴奏】")).toBe("屋顶");
  });
});

describe("artistTokens", () => {
  it("按 、/&, 拆分", () => {
    expect(artistTokens("周杰伦、温岚、吴宗宪")).toEqual(["周杰伦", "温岚", "吴宗宪"]);
    expect(artistTokens("G.E.M.邓紫棋")).toEqual(["gem邓紫棋"]);
  });
});

describe("durationSeconds", () => {
  it("mm:ss 与 h:mm:ss", () => {
    expect(durationSeconds("04:56")).toBe(296);
    expect(durationSeconds("1:02:03")).toBe(3723);
    expect(durationSeconds("")).toBe(0);
    expect(durationSeconds("abc")).toBe(0);
  });
});

describe("pickBestMatch", () => {
  const target = { name: "屋顶", artist: "周杰伦、温岚、吴宗宪", durationText: "05:19" };

  it("名字相等 + 歌手有交集 + 时长接近 → 命中", () => {
    const list = [
      { name: "屋顶", artist: "温岚", durationText: "05:18", id: "a" },
      { name: "屋顶", artist: "别人", durationText: "05:19", id: "b" },
    ];
    expect(pickBestMatch(target, list)?.id).toBe("a");
  });

  it("名字对但歌手完全不同 → 不命中（宁可没有，不乱切）", () => {
    expect(pickBestMatch(target, [{ name: "屋顶", artist: "陌生人", durationText: "05:19" }])).toBeNull();
  });

  it("时长差 > 25 秒（Live/加长版）→ 淘汰", () => {
    expect(pickBestMatch(target, [{ name: "屋顶", artist: "温岚", durationText: "08:40" }])).toBeNull();
  });

  it("双方有一方缺时长 → 不据此淘汰", () => {
    expect(pickBestMatch(target, [{ name: "屋顶", artist: "温岚" }])).not.toBeNull();
  });

  it("版本标记一致才算同款：Live 对 Live 命中", () => {
    const t = { name: "想你就写信 (Live)", artist: "周杰伦" };
    expect(pickBestMatch(t, [{ name: "想你就写信 (Live)", artist: "周杰伦、李硕" }])).not.toBeNull();
  });

  it("版本标记不一致 → 拒绝（原版不能换成 Live，Live 也不能换成原版）", () => {
    expect(pickBestMatch({ name: "想你就写信", artist: "周杰伦" }, [{ name: "想你就写信 (Live)", artist: "周杰伦" }])).toBeNull();
    expect(pickBestMatch({ name: "想你就写信 (Live)", artist: "周杰伦" }, [{ name: "想你就写信", artist: "周杰伦" }])).toBeNull();
  });

  it("回归：remix 版不得被换成原版（真实数据里出现过：光年之外 remix 04:13 → 原版 03:55）", () => {
    const remix = { name: "光年之外（邓紫棋 / 鲤鱼（LY） remix）", artist: "邓紫棋、鲤鱼（LY）", durationText: "04:13" };
    const original = { name: "光年之外", artist: "G.E.M.邓紫棋", durationText: "03:55" };
    expect(pickBestMatch(remix, [original])).toBeNull();
  });

  it("伴奏/翻唱/DJ 同理", () => {
    expect(pickBestMatch({ name: "晴天", artist: "周杰伦" }, [{ name: "晴天 (伴奏)", artist: "周杰伦" }])).toBeNull();
    expect(pickBestMatch({ name: "晴天", artist: "周杰伦" }, [{ name: "晴天 DJ版", artist: "周杰伦" }])).toBeNull();
    expect(pickBestMatch({ name: "晴天 (翻唱)", artist: "某人" }, [{ name: "晴天 (翻唱)", artist: "某人" }])).not.toBeNull();
  });

  it("相等优先于包含", () => {
    const t = { name: "晴天", artist: "周杰伦" };
    const r = pickBestMatch(t, [
      { name: "晴天娃娃", artist: "周杰伦", id: "loose" },
      { name: "晴天", artist: "周杰伦", id: "exact" },
    ]);
    expect(r?.id).toBe("exact");
  });

  it("单字名字不做包含匹配（防误配）", () => {
    expect(pickBestMatch({ name: "爱", artist: "小虎队" }, [{ name: "我爱你", artist: "小虎队" }])).toBeNull();
  });

  it("空候选 / 空名字 → null", () => {
    expect(pickBestMatch(target, [])).toBeNull();
    expect(pickBestMatch({ name: "", artist: "x" }, [{ name: "x", artist: "x" }])).toBeNull();
  });
});

describe("sourceLabel / otherSource", () => {
  it("平台名与互切", () => {
    expect(sourceLabel("wy")).toBe("网易云");
    expect(sourceLabel("kw")).toBe("酷我");
    expect(otherSource("wy")).toBe("kw");
    expect(otherSource("kw")).toBe("wy");
  });
});
