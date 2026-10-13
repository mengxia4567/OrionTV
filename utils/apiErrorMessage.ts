/**
 * 把 services/api.ts 抛出的内部错误码（如 "API_URL_NOT_SET" / "UNAUTHORIZED"）
 * 转成用户可读的中文提示。
 *
 * 为什么要有这个文件：这段映射逻辑原来在 homeStore.ts 里写了一份，
 * favoritesStore.ts 却忘了映射、直接把 err.message 显示给用户
 * （收藏页出现过英文常量 "API_URL_NOT_SET"）。集中一处，新增 store
 * 时就不会再漏。
 */
export function mapApiErrorMessage(err: unknown, fallback = "加载失败，请重试"): string {
  const message = err instanceof Error ? err.message : String(err ?? "");

  switch (message) {
    case "API_URL_NOT_SET":
      return "请点击右上角设置按钮，配置您的服务器地址";
    case "UNAUTHORIZED":
      return "认证失败，请重新登录";
  }

  if (message.includes("Network")) return "网络连接失败，请检查网络连接";
  if (message.includes("timeout")) return "请求超时，请检查网络或服务器状态";
  if (message.includes("404")) return "服务器API路径不正确，请检查服务器配置";
  if (message.includes("500")) return "服务器内部错误，请联系管理员";
  if (message.includes("403")) return "访问被拒绝，请检查权限设置";

  return fallback;
}
