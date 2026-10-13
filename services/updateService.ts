// UpdateService.ts
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Toast from 'react-native-toast-message';
import { version as currentVersion } from '../package.json';
import { UPDATE_CONFIG } from '../constants/UpdateConfig';
import Logger from '@/utils/Logger';
import { Platform } from 'react-native';
import { SettingsManager } from '@/services/storage';
import { getStoredAuthToken } from '@/services/api';
import { apkPatchAvailable, getBaseApkPath, applyPatch, sha256File } from '../modules/apk-patch';

const logger = Logger.withTag('UpdateService');

interface PatchInfo {
  url: string;
  size: number;
  sha256: string;
}

export interface VersionInfo {
  version: string;
  /** 整包下载地址 */
  downloadUrl: string;
  apkSize: number;
  apkSha256: string;
  /** 从当前已装版本到最新版本的增量补丁（没有或本机不支持则为 null，走整包） */
  patch: PatchInfo | null;
  /** 请求头（登录令牌） */
  headers: Record<string, string>;
}

/** 本次实际采用的更新方式 */
export type UpdateMode = 'patch' | 'full';

/**
 * 只在 Android 平台使用的常量（iOS 不会走到下载/安装流程）
 */
const ANDROID_MIME_TYPE = 'application/vnd.android.package-archive';

class UpdateService {
  private static instance: UpdateService;
  static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService();
    }
    return UpdateService.instance;
  }

  /** --------------------------------------------------------------
   *  1️⃣ 远程版本检查：读服务器上的 latest.json（登录令牌校验）
   * --------------------------------------------------------------- */
  private async getBases(): Promise<string[]> {
    const bases: string[] = [];
    try {
      const s = await SettingsManager.get();
      const proxy = (s?.vodProxyUrl || '').trim().replace(/\/+$/, '');
      const api = (s?.apiBaseUrl || '').trim().replace(/\/+$/, '');
      if (proxy) bases.push(proxy);
      if (api) bases.push(api);
    } catch {
      /* ignore */
    }
    return Array.from(new Set(bases));
  }

  async checkVersion(): Promise<VersionInfo> {
    const bases = await this.getBases();
    if (bases.length === 0) {
      Toast.show({ type: 'error', text1: '检查更新失败', text2: '请先在设置里填写服务器地址' });
      throw new Error('未配置服务器地址');
    }
    const token = await getStoredAuthToken().catch(() => null);
    const headers: Record<string, string> = token ? { Authorization: `Token ${token}` } : {};
    let lastErr: unknown = null;
    for (const base of bases) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10_000);
          const response = await fetch(`${base}${UPDATE_CONFIG.MANIFEST_PATH}?t=${Date.now()}`, {
            headers,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const m = await response.json();
          const p = m?.patches?.[currentVersion];
          return {
            version: m.version as string,
            downloadUrl: `${base}/appupdate/${m.apk.file}`,
            apkSize: m.apk.size,
            apkSha256: m.apk.sha256,
            patch: p ? { url: `${base}/appupdate/${p.file}`, size: p.size, sha256: p.sha256 } : null,
            headers,
          };
        } catch (e) {
          lastErr = e;
          logger.warn(`checkVersion ${base} attempt ${attempt}`, e);
          await new Promise(r => setTimeout(r, 1_500 * attempt));
        }
      }
    }
    Toast.show({ type: 'error', text1: '检查更新失败', text2: '无法获取版本信息，请检查网络或登录状态' });
    throw lastErr instanceof Error ? lastErr : new Error('检查更新失败');
  }

  /** --------------------------------------------------------------
   *  2️⃣ 清理旧的 APK 文件（使用 expo-file-system 的 API）
   * --------------------------------------------------------------- */
  private async cleanOldApkFiles(): Promise<void> {
    try {
      const dirUri = FileSystem.documentDirectory; // e.g. file:///data/user/0/.../files/
      if (!dirUri) {
        throw new Error('Document directory is not available');
      }
      const listing = await FileSystem.readDirectoryAsync(dirUri);
      const apkFiles = listing.filter(name => name.startsWith('OrionTV_v') && name.endsWith('.apk'));

      if (apkFiles.length <= 2) return;

      const sorted = apkFiles.sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, ''), 10);
        const numB = parseInt(b.replace(/[^0-9]/g, ''), 10);
        return numB - numA; // 倒序（最新在前）
      });

      const stale = sorted.slice(2); // 保留最新的两个
      for (const file of stale) {
        const path = `${dirUri}${file}`;
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
          logger.debug(`Deleted old APK: ${file}`);
        } catch (e) {
          logger.warn(`Failed to delete ${file}`, e);
        }
      }
    } catch (e) {
      logger.warn('cleanOldApkFiles error', e);
    }
  }

  /** --------------------------------------------------------------
   *  3️⃣ 下载 APK（使用 expo-file-system 的下载 API）
   * --------------------------------------------------------------- */
  async downloadApk(
    url: string,
    onProgress?: (percent: number) => void,
    headers: Record<string, string> = {},
  ): Promise<string> {
    const maxRetries = 3;
    await this.cleanOldApkFiles();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timestamp = Date.now();
        const fileName = `OrionTV_v${timestamp}.apk`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;

        // expo-file-system 把下载进度回调参数统一为 `{totalBytesWritten, totalBytesExpectedToWrite}`
        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          fileUri,
          { headers },
          progress => {
            if (onProgress && progress.totalBytesExpectedToWrite) {
              const percent = Math.floor(
                (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100,
              );
              onProgress(percent);
            }
          },
        );

        const result = await downloadResumable.downloadAsync();
        if (result && result.uri) {
          logger.debug(`APK downloaded to ${result.uri}`);
          return result.uri;
        } else {
          throw new Error('Download failed: No URI available');
        }
      } catch (e) {
        logger.warn(`downloadApk attempt ${attempt}/${maxRetries}`, e);
        if (attempt === maxRetries) {
          Toast.show({
            type: 'error',
            text1: '下载失败',
            text2: 'APK 下载出现错误，请检查网络',
          });
          throw e;
        }
        // 指数退避
        await new Promise(r => setTimeout(r, 3_000 * attempt));
      }
    }
    // 同上，理论不会到这里
    throw new Error('Download failed');
  }

  /** --------------------------------------------------------------
   *  3️⃣b 智能更新：优先下载增量补丁并在本机还原出新 APK；任何一步失败自动回退整包
   * --------------------------------------------------------------- */
  async fetchUpdate(
    info: VersionInfo,
    onProgress?: (percent: number) => void,
    onMode?: (mode: UpdateMode) => void,
  ): Promise<string> {
    if (info.patch && apkPatchAvailable && Platform.OS === 'android') {
      try {
        onMode?.('patch');
        const dir = FileSystem.documentDirectory;
        if (!dir) throw new Error('no documentDirectory');
        await this.cleanOldApkFiles();
        const patchPath = `${dir}update_patch.bsz`;
        const outPath = `${dir}OrionTV_v${Date.now()}.apk`;
        await FileSystem.deleteAsync(patchPath, { idempotent: true });
        const dl = FileSystem.createDownloadResumable(info.patch.url, patchPath, { headers: info.headers }, p => {
          if (onProgress && p.totalBytesExpectedToWrite) {
            // 补丁下载占 90%，还原占 10%
            onProgress(Math.floor((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 90));
          }
        });
        const r = await dl.downloadAsync();
        if (!r?.uri) throw new Error('patch download failed');
        const got = await sha256File(patchPath);
        if (got !== info.patch.sha256) throw new Error('patch sha256 mismatch');
        onProgress?.(92);
        const outSha = await applyPatch(getBaseApkPath(), patchPath, outPath);
        await FileSystem.deleteAsync(patchPath, { idempotent: true });
        if (outSha !== info.apkSha256) {
          await FileSystem.deleteAsync(outPath, { idempotent: true });
          throw new Error('patched apk sha256 mismatch');
        }
        onProgress?.(100);
        logger.debug(`patched apk ready: ${outPath}`);
        return outPath;
      } catch (e) {
        logger.warn('增量更新失败，回退整包', e);
        Toast.show({ type: 'info', text1: '增量更新不可用', text2: '改为下载完整安装包' });
      }
    }
    onMode?.('full');
    onProgress?.(0);
    return this.downloadApk(info.downloadUrl, onProgress, info.headers);
  }

  /** --------------------------------------------------------------
   *  4️⃣ 安装 APK（只在 Android 可用，使用 expo-intent-launcher）
   * --------------------------------------------------------------- */
  async installApk(fileUri: string): Promise<void> {
    // ① 先确认文件存在
    const exists = await FileSystem.getInfoAsync(fileUri);
    if (!exists.exists) {
      throw new Error(`APK not found at ${fileUri}`);
    }

    // ② 把 file:// 转成 content://，Expo‑FileSystem 已经实现了 FileProvider
    const contentUri = await FileSystem.getContentUriAsync(fileUri);

    // ③ 只在 Android 里执行
    if (Platform.OS === 'android') {
      try {
        // FLAG_ACTIVITY_NEW_TASK = 0x10000000 (1)
        // FLAG_GRANT_READ_URI_PERMISSION = 0x00000010
        const flags = 1 | 0x00000010;   // 1 | 16

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,          // 必须是 content://
          type: ANDROID_MIME_TYPE,   // application/vnd.android.package-archive
          flags,
        });
      } catch (e: any) {
        // 统一错误提示
        if (e.message?.includes('Activity not found')) {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '系统没有找到可以打开 APK 的应用，请检查系统设置',
          });
        } else if (e.message?.includes('permission')) {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '请在设置里允许“未知来源”安装',
          });
        } else {
          Toast.show({
            type: 'error',
            text1: '安装失败',
            text2: '未知错误，请稍后重试',
          });
        }
        throw e;
      }
    } else {
      // iOS 设备不支持直接安装 APK
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: 'iOS 设备无法直接安装 APK',
      });
      throw new Error('APK install not supported on iOS');
    }
  }

  /** --------------------------------------------------------------
   *  5️⃣ 版本比对工具（保持原来的实现）
   * --------------------------------------------------------------- */
  compareVersions(v1: string, v2: string): number {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] ?? 0;
      const n2 = p2[i] ?? 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
  getCurrentVersion(): string {
    return currentVersion;
  }
  isUpdateAvailable(remoteVersion: string): boolean {
    return this.compareVersions(remoteVersion, currentVersion) > 0;
  }
}

/* 单例导出 */
export default UpdateService.getInstance();
