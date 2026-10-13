import { create } from "zustand";
import { api, getStoredAuthToken } from "@/services/api";
import { useSettingsStore } from "./settingsStore";
import {
  LoginCredentialsManager,
  PlayRecordManager,
  FavoriteManager,
  SearchHistoryManager,
} from "@/services/storage";
import Toast from "react-native-toast-message";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('AuthStore');

interface AuthState {
  isLoggedIn: boolean;
  isLoginModalVisible: boolean;
  showLoginModal: () => void;
  hideLoginModal: () => void;
  checkLoginStatus: (apiBaseUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 防重入：并发调用共享同一次检查，避免状态互相覆盖
let checkLoginStatusPromise: Promise<void> | null = null;

const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  isLoginModalVisible: false,
  showLoginModal: () => set({ isLoginModalVisible: true }),
  hideLoginModal: () => set({ isLoginModalVisible: false }),
  checkLoginStatus: async (apiBaseUrl?: string) => {
    if (checkLoginStatusPromise) {
      return checkLoginStatusPromise;
    }
    checkLoginStatusPromise = (async () => {
      try {
        if (!apiBaseUrl) {
          set({ isLoggedIn: false, isLoginModalVisible: false });
          return;
        }

        // 1) 已有令牌：直接视为已登录（令牌过期由请求层的 401 自愈机制处理）
        const token = await getStoredAuthToken();
        if (token) {
          set({ isLoggedIn: true, isLoginModalVisible: false });
          return;
        }

        // 等待服务器配置加载完成（最多 3 秒）
        const settingsState = useSettingsStore.getState();
        let serverConfig = settingsState.serverConfig;
        if (settingsState.isLoadingServerConfig) {
          const maxWaitTime = 3000;
          const checkInterval = 100;
          let waitTime = 0;
          while (waitTime < maxWaitTime) {
            await delay(checkInterval);
            waitTime += checkInterval;
            const currentState = useSettingsStore.getState();
            if (!currentState.isLoadingServerConfig) {
              serverConfig = currentState.serverConfig;
              break;
            }
          }
        }

        if (!serverConfig?.StorageType) {
          // 配置不可用（通常是网络问题）：不弹登录框，保留当前状态
          if (!useSettingsStore.getState().isLoadingServerConfig) {
            Toast.show({ type: "error", text1: "请检查网络或者服务器地址是否可用" });
          }
          return;
        }

        // 2) 无令牌：尝试静默登录
        if (serverConfig.StorageType === "localstorage") {
          // 本地存储模式：无需账号密码
          try {
            const loginResult = await api.login();
            if (loginResult && loginResult.ok) {
              set({ isLoggedIn: true, isLoginModalVisible: false });
              return;
            }
          } catch (error) {
            logger.error("Silent login failed (localstorage):", error);
          }
        } else {
          const credentials = await LoginCredentialsManager.get();
          if (credentials && credentials.password) {
            try {
              const loginResult = await api.login(credentials.username, credentials.password);
              if (loginResult && loginResult.ok) {
                set({ isLoggedIn: true, isLoginModalVisible: false });
                return;
              }
            } catch (error) {
              if (error instanceof Error && error.message === "UNAUTHORIZED") {
                // 凭据已失效：清除本地凭据，避免反复静默失败触发服务端防爆破
                await LoginCredentialsManager.clear();
              } else {
                logger.error("Silent login failed:", error);
              }
            }
          }
        }

        // 3) 无法自动登录：弹出登录框（首次配置流程）
        set({ isLoggedIn: false, isLoginModalVisible: true });
      } catch (error) {
        logger.error("Failed to check login status:", error);
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          set({ isLoggedIn: false, isLoginModalVisible: true });
        } else {
          set({ isLoggedIn: false });
        }
      } finally {
        checkLoginStatusPromise = null;
      }
    })();
    return checkLoginStatusPromise;
  },
  logout: async () => {
    try {
      await api.logout();
    } catch (error) {
      logger.error("Failed to logout:", error);
    }
    // 主动退出：清除已保存凭据，避免下次启动被自动登录回来
    await LoginCredentialsManager.clear();
    // 清除本机缓存（播放记录/收藏/搜索历史）——防止换账号登录后串号显示；
    // 服务器数据按账号隔离，重新登录会重新拉取
    await PlayRecordManager.clearLocalCache();
    await FavoriteManager.clearLocalCache();
    await SearchHistoryManager.clearLocalCache();
    set({ isLoggedIn: false, isLoginModalVisible: true });
  },
}));

// 会话自愈回调：请求层遇到 401 时调用 —— 先续期、再静默重登，最后回退到登录框
// 防重入：并发 401 只触发一次恢复流程，避免重复请求与重复登录
let recoverSessionPromise: Promise<boolean> | null = null;

const recoverSession = async (): Promise<boolean> => {
  if (recoverSessionPromise) {
    return recoverSessionPromise;
  }
  recoverSessionPromise = (async (): Promise<boolean> => {
    // 1) 用 refresh token 续期（保持同一设备会话，不产生新会话）
    const refreshed = await api.refreshToken();
    if (refreshed) {
      return true;
    }

    // 2) 静默重登（使用已保存的账号密码）
    const credentials = await LoginCredentialsManager.get();
    if (credentials && credentials.password) {
      try {
        const loginResult = await api.login(credentials.username, credentials.password);
        if (loginResult && loginResult.ok) {
          return true;
        }
      } catch (error) {
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          await LoginCredentialsManager.clear();
        }
        logger.error("Session recovery login failed:", error);
      }
    }

    // 3) 无法自动恢复：回退到手动登录
    useAuthStore.setState({ isLoggedIn: false, isLoginModalVisible: true });
    return false;
  })();
  try {
    return await recoverSessionPromise;
  } finally {
    recoverSessionPromise = null;
  }
};

api.setAuthRecoveryHandler(recoverSession);

export default useAuthStore;
