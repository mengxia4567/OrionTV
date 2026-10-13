/**
 * 照片墙大图命名映射（v1.8.9 · B1）
 * 服务端：缩略图 p<n>.jpg ↔ 大图 l<n>.jpg；本地加版本前缀 v<ts>_。
 */
jest.mock("expo-file-system", () => ({ documentDirectory: "file:///doc/" }));
jest.mock("@/services/storage", () => ({ SettingsManager: { get: jest.fn() } }));
jest.mock("@/services/api", () => ({
  api: { triggerAuthRecovery: jest.fn() },
  getStoredAuthToken: jest.fn(),
}));

import { largeNameOf } from "../wallPhotos";

describe("largeNameOf 缩略图 → 大图本地名", () => {
  it("带版本前缀的缩略图映射到同前缀大图", () => {
    expect(largeNameOf("v1791801415824_p3.jpg")).toBe("v1791801415824_l3.jpg");
  });

  it("多位序号也正确", () => {
    expect(largeNameOf("v1_p12.jpg")).toBe("v1_l12.jpg");
  });

  it("不符合命名的文件返回 null（视为无大图）", () => {
    expect(largeNameOf("v1_x3.jpg")).toBeNull();
    expect(largeNameOf("manifest.json")).toBeNull();
    expect(largeNameOf("v1_p3.png")).toBeNull();
  });
});
