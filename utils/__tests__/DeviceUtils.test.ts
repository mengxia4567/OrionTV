import { Dimensions, Platform } from "react-native";
import { DeviceUtils } from "../DeviceUtils";

jest.mock("react-native", () => ({
  Dimensions: {
    get: jest.fn(),
  },
  Platform: { isTV: false },
}));

const mockedDimensions = Dimensions as jest.Mocked<typeof Dimensions>;

/** 设置模拟设备：电视只认系统 TV 标志，平板/手机按短边 600dp 划分 */
const setDevice = (width: number, height: number, isTV = false) => {
  (Platform as { isTV: boolean }).isTV = isTV;
  mockedDimensions.get.mockReturnValue({ width, height } as never);
};

describe("DeviceUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { isTV: boolean }).isTV = false;
  });

  describe("getDeviceType", () => {
    it("系统 TV 标志为真时返回 tv", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.getDeviceType()).toBe("tv");
    });

    it("非 TV 且短边 >= 600 时返回 tablet（横屏大宽度也是平板）", () => {
      setDevice(2560, 1600);
      expect(DeviceUtils.getDeviceType()).toBe("tablet");
      setDevice(768, 1024);
      expect(DeviceUtils.getDeviceType()).toBe("tablet");
    });

    it("非 TV 且短边 < 600 时返回 mobile", () => {
      setDevice(375, 812);
      expect(DeviceUtils.getDeviceType()).toBe("mobile");
    });
  });

  describe("isTV", () => {
    it("应该在 TV 设备上返回 true", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.isTV()).toBe(true);
    });

    it("应该在非 TV 设备上返回 false", () => {
      setDevice(375, 812);
      expect(DeviceUtils.isTV()).toBe(false);
    });
  });

  describe("isMobile", () => {
    it("应该在移动设备上返回 true", () => {
      setDevice(375, 812);
      expect(DeviceUtils.isMobile()).toBe(true);
    });

    it("应该在非移动设备上返回 false", () => {
      setDevice(1024, 768);
      expect(DeviceUtils.isMobile()).toBe(false);
    });
  });

  describe("isTablet", () => {
    it("应该在平板设备上返回 true", () => {
      setDevice(768, 1024);
      expect(DeviceUtils.isTablet()).toBe(true);
    });

    it("应该在非平板设备上返回 false", () => {
      setDevice(375, 812);
      expect(DeviceUtils.isTablet()).toBe(false);
    });
  });

  describe("supportsTouchInteraction", () => {
    it("应该在非 TV 设备上返回 true", () => {
      setDevice(375, 812);
      expect(DeviceUtils.supportsTouchInteraction()).toBe(true);
    });

    it("应该在 TV 设备上返回 false", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.supportsTouchInteraction()).toBe(false);
    });
  });

  describe("supportsRemoteControlInteraction", () => {
    it("应该在 TV 设备上返回 true", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.supportsRemoteControlInteraction()).toBe(true);
    });

    it("应该在非 TV 设备上返回 false", () => {
      setDevice(375, 812);
      expect(DeviceUtils.supportsRemoteControlInteraction()).toBe(false);
    });
  });

  describe("getMinTouchTargetSize", () => {
    it("应该为 mobile 设备返回 44", () => {
      setDevice(375, 812);
      expect(DeviceUtils.getMinTouchTargetSize()).toBe(44);
    });

    it("应该为 tablet 设备返回 48", () => {
      setDevice(768, 1024);
      expect(DeviceUtils.getMinTouchTargetSize()).toBe(48);
    });

    it("应该为 tv 设备返回 60", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.getMinTouchTargetSize()).toBe(60);
    });
  });

  describe("getOptimalFontSize", () => {
    it("应该为 mobile 设备返回基础大小 * 1.0", () => {
      setDevice(375, 812);
      expect(DeviceUtils.getOptimalFontSize(16)).toBe(16);
    });

    it("应该为 tablet 设备返回基础大小 * 1.1", () => {
      setDevice(768, 1024);
      expect(DeviceUtils.getOptimalFontSize(16)).toBe(18);
    });

    it("应该为 tv 设备返回基础大小 * 1.25", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.getOptimalFontSize(16)).toBe(20);
    });
  });

  describe("getOptimalSpacing", () => {
    it("应该为 mobile 设备返回基础间距 * 0.8", () => {
      setDevice(375, 812);
      expect(DeviceUtils.getOptimalSpacing(20)).toBe(16);
    });

    it("应该为 tablet 设备返回基础间距 * 1.0", () => {
      setDevice(768, 1024);
      expect(DeviceUtils.getOptimalSpacing(20)).toBe(20);
    });

    it("应该为 tv 设备返回基础间距 * 1.5", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.getOptimalSpacing(20)).toBe(30);
    });
  });

  describe("isLandscape", () => {
    it("应该在横屏模式下返回 true", () => {
      setDevice(812, 375);
      expect(DeviceUtils.isLandscape()).toBe(true);
    });

    it("应该在竖屏模式下返回 false", () => {
      setDevice(375, 812);
      expect(DeviceUtils.isLandscape()).toBe(false);
    });

    it("应该在宽高相等时返回 false", () => {
      setDevice(500, 500);
      expect(DeviceUtils.isLandscape()).toBe(false);
    });
  });

  describe("isPortrait", () => {
    it("应该在竖屏模式下返回 true", () => {
      setDevice(375, 812);
      expect(DeviceUtils.isPortrait()).toBe(true);
    });

    it("应该在横屏模式下返回 false", () => {
      setDevice(812, 375);
      expect(DeviceUtils.isPortrait()).toBe(false);
    });
  });

  describe("getSafeColumnCount", () => {
    it("应该在 mobile 设备上返回安全列数", () => {
      setDevice(375, 812);
      // minCardWidth = 120, maxColumns = 375 / 120 = 3.125 = 3
      expect(DeviceUtils.getSafeColumnCount(5)).toBe(3);
      expect(DeviceUtils.getSafeColumnCount(2)).toBe(2);
    });

    it("应该在 tablet 设备上返回安全列数", () => {
      setDevice(768, 1024);
      // minCardWidth = 140, maxColumns = 768 / 140 = 5.485 = 5
      expect(DeviceUtils.getSafeColumnCount(6)).toBe(5);
      expect(DeviceUtils.getSafeColumnCount(3)).toBe(3);
    });

    it("应该在 tv 设备上返回安全列数", () => {
      setDevice(1920, 1080, true);
      // minCardWidth = 160, maxColumns = 1920 / 160 = 12
      expect(DeviceUtils.getSafeColumnCount(15)).toBe(12);
      expect(DeviceUtils.getSafeColumnCount(8)).toBe(8);
    });
  });

  describe("getAnimationDuration", () => {
    it("应该为 mobile 设备返回基础持续时间 * 1.0", () => {
      setDevice(375, 812);
      expect(DeviceUtils.getAnimationDuration(300)).toBe(300);
    });

    it("应该为 tablet 设备返回基础持续时间 * 1.0", () => {
      setDevice(768, 1024);
      expect(DeviceUtils.getAnimationDuration(300)).toBe(300);
    });

    it("应该为 tv 设备返回基础持续时间 * 1.2", () => {
      setDevice(1920, 1080, true);
      expect(DeviceUtils.getAnimationDuration(300)).toBe(360);
    });
  });
});