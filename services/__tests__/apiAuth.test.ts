import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getStoredAuthToken, setStoredAuthToken } from "../api";

// 测试环境使用 AsyncStorage 官方 jest mock 替代原生模块
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// 构造一个模拟的 Response 对象
const makeResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    json: async () => body,
  }) as unknown as Response;

describe("api 认证令牌机制", () => {
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (global as any).fetch = fetchMock;
    api.setBaseUrl("http://test.local");
    api.setAuthRecoveryHandler(null);
  });

  it("login 成功后保存响应体中的 token", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, token: "T1" }));
    const res = await api.login("u", "p");
    expect(res.ok).toBe(true);
    expect(await getStoredAuthToken()).toBe("T1");
  });

  it("请求自动附加 Authorization 头", async () => {
    await setStoredAuthToken("T-ABC");
    fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
    await api.getFavorites();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBe("Token T-ABC");
  });

  it("401 时调用自愈回调并用新令牌重试一次", async () => {
    await setStoredAuthToken("OLD");
    fetchMock
      .mockResolvedValueOnce(makeResponse(401, {}))
      .mockResolvedValueOnce(makeResponse(200, { a: 1 }));
    api.setAuthRecoveryHandler(async () => {
      await setStoredAuthToken("NEW");
      return true;
    });

    await api.getFavorites();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1];
    expect((retryInit.headers as Headers).get("Authorization")).toBe("Token NEW");
  });

  it("自愈失败时抛出 UNAUTHORIZED 且不重试", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401, {}));
    api.setAuthRecoveryHandler(async () => false);

    await expect(api.getFavorites()).rejects.toThrow("UNAUTHORIZED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshToken 成功后更新持久化令牌", async () => {
    await setStoredAuthToken("OLD");
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, token: "NEW2" }));
    const token = await api.refreshToken();
    expect(token).toBe("NEW2");
    expect(await getStoredAuthToken()).toBe("NEW2");
  });

  it("login 请求不携带旧令牌", async () => {
    await setStoredAuthToken("STALE");
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, token: "FRESH" }));
    await api.login("u", "p");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });
});
