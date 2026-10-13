// 自定义入口：在 expo-router 之外多注册一个 RNTP 后台播放服务（通知栏/锁屏/线控）
import "expo-router/entry";
import TrackPlayer from "react-native-track-player";

TrackPlayer.registerPlaybackService(() => require("./services/playbackService").default);
