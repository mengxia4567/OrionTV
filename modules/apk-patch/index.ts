import { requireNativeModule } from "expo";

interface ApkPatchNative {
  getBaseApkPath(): string;
  sha256(path: string): Promise<string>;
  applyPatch(oldPath: string, patchPath: string, outPath: string): Promise<string>;
}

let native: ApkPatchNative | null = null;
try {
  native = requireNativeModule<ApkPatchNative>("ApkPatch");
} catch {
  native = null; // 旧安装包/非 Android：增量更新不可用，自动走整包
}

export const apkPatchAvailable = native != null;
export const getBaseApkPath = () => native!.getBaseApkPath();
export const sha256File = (p: string) => native!.sha256(p);
export const applyPatch = (oldPath: string, patchPath: string, outPath: string) =>
  native!.applyPatch(oldPath, patchPath, outPath);
