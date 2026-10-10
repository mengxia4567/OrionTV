/**
 * 熊猫遮罩冻结快照测试（16×9 v3 参数）
 *
 * 遮罩为纯几何计算（computePandaMask），参数与 maskgen.py v3 逐位一致；
 * 本测试防回归：结构、亮格/暗洞数量、底部空行。
 */
import { computePandaMask } from "../PandaMask";

describe("computePandaMask（16×9 v3 冻结参数）", () => {
  const mask = computePandaMask(16, 9);

  it("结构：9 行 × 16 列", () => {
    expect(mask).toHaveLength(9);
    mask.forEach((row) => expect(row).toHaveLength(16));
  });

  it("亮格 28 / 暗洞 8（与 maskgen.py 输出一致）", () => {
    const flat = mask.flat();
    expect(flat.filter((v) => v === 1)).toHaveLength(28);
    expect(flat.filter((v) => v === 2)).toHaveLength(8);
  });

  it("顶部两个耳尖 / 底部两行为空", () => {
    expect(mask[0].filter((v) => v === 1)).toHaveLength(2);
    expect(mask[7].every((v) => v === 0)).toBe(true);
    expect(mask[8].every((v) => v === 0)).toBe(true);
  });
});
