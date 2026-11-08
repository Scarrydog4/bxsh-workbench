# 笔下工单移动端

Android 与 iOS 工程均使用自建网站的账号、角色和权限。公开源码中的站点占位地址是 `https://workbench.example.com/`，构建前需要替换为自己的站点。

Android 当前工程版本为 `0.1.6`（versionCode 7），最低支持 Android 8.0。支持原生拍照、文件保存与打开、原生确认弹窗、返回键和应用内更新。要求现场拍摄的场景仅调用相机；图片不写入相册。

## Android

需要 JDK 17、Android SDK / API 35。设置 `ANDROID_HOME` 或 `android/local.properties`：

```sh
cd android
./gradlew assembleDebug
```

调试包位于 `app/build/outputs/apk/debug/app-debug.apk`。正式包使用 `./gradlew assembleRelease`，并使用自己的签名密钥完成签名。

站点、导出来源和更新下载地址定义在 `MainActivity.java`、`WebExport.java` 和 `AppUpdater.java`，需要一起替换。更新包会检查哈希、包名、签名与版本号，安装需要用户确认。后续版本必须沿用同一签名证书并递增 `versionCode`。

APK、签名文件和密码均不放入源码仓库。网站更新下载接口的版本信息配置见 `web/src/server/android-release.ts` 和 `web/src/shared/company-resources.ts`。

## iOS

在完整 Xcode 中打开 `ios/Workbench.xcodeproj`，修改 `WorkbenchApp.swift` 中的站点地址，选择自己的 Team 并配置签名，然后连接设备测试或发布 TestFlight。仓库仅提供工程源码。
