import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Toast from "react-native-toast-message";
import { AspectMode, ASPECT_LABEL, isAspectMode, nextAspectMode } from "@/utils/aspectMode";

const STORAGE_KEY = "player_aspect_mode";

interface AspectState {
  mode: AspectMode;
  /** 切到下一个比例并提示；点播与直播共用同一个偏好 */
  cycle: () => void;
}

export const useAspectStore = create<AspectState>((set, get) => ({
  mode: "auto",
  cycle: () => {
    const mode = nextAspectMode(get().mode);
    set({ mode });
    Toast.show({ type: "info", text1: `画面比例：${ASPECT_LABEL[mode]}`, visibilityTime: 1200 });
    void AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  },
}));

void AsyncStorage.getItem(STORAGE_KEY)
  .then((v) => {
    if (isAspectMode(v)) useAspectStore.setState({ mode: v });
  })
  .catch(() => {});
