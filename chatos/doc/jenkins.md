# Jenkins 打包（Docker 部署 Jenkins）

## 1) Jenkins Job 配置（推荐：Pipeline from SCM）

1. 在仓库根目录已提供 `Jenkinsfile`。
2. Jenkins → 新建 Item → 选择 **Pipeline**。
3. **Pipeline script from SCM**：
   - SCM 选 Git
   - Repository URL 填你的仓库地址
   - Script Path 填 `Jenkinsfile`
4. 构建时参数：
   - `BUILD_NPM_TGZ=true`：产出 npm 包 `*.tgz`（默认）
   - `BUILD_DESKTOP=true`：产出桌面端 `dist_desktop/`（需要对应 OS 的 Jenkins agent）
   - `MAC_SIGN=true`：macOS 产物使用 Developer ID 证书签名（仅 macOS agent 生效）
   - `MAC_NOTARIZE=true`：macOS 产物公证并 stapler（仅 macOS agent 生效）

构建完成后，产物会在 Jenkins 的 **Artifacts** 里：
- `*.tgz`
- `dist_desktop/**/*`

## 2) Agent/环境要求

- Node.js `>= 18`（建议 20）
- 能执行 `npm ci`
- 桌面端打包需要对应平台：macOS 打 macOS、Windows 打 Windows（Linux 只能打 Linux）

### Jenkins 跑在 Docker 里时（常见踩坑）

官方 `jenkins/jenkins` 镜像默认不带 Node.js；你有两种常用做法：

1) **用带 Node 的 Jenkins Agent**：把流水线跑在已经安装 Node 的 agent（物理机/虚拟机/容器）上。  
2) **在 Jenkins 容器里安装 Node**：基于 `jenkins/jenkins:lts` 做一个自定义镜像，把 Node 预装进去，然后再跑本仓库的 `Jenkinsfile`。

## 3) macOS 签名/公证需要的证书怎么放

结论：**不要把证书提交到仓库**，放到 Jenkins **Credentials** 里即可；并且签名/公证必须在 **macOS agent** 上执行（Linux Docker 上做不了 `codesign/xcrun`）。

### Developer ID（推荐：站外分发 dmg/zip）

在 Jenkins → **Manage Jenkins** → **Credentials** 中创建这些凭据（ID 请按 `Jenkinsfile` 里的固定值创建）：

- `dev-id-app-cert-p12`：类型选 **Secret file**，上传 Developer ID Application 导出的 `.p12`
- `dev-id-app-cert-password`：类型选 **Secret text**，填 `.p12` 密码
- `apple-id`：**Secret text**，你的 Apple ID（邮箱）
- `apple-app-specific-password`：**Secret text**，App 专用密码（Apple ID → 安全）
- `apple-team-id`：**Secret text**，Team ID

然后在构建参数中勾选：
- `BUILD_DESKTOP=true`
- `MAC_SIGN=true`
- 如需公证：`MAC_NOTARIZE=true`

### Mac App Store（MAS）

如果你要走 App Store（`--mac mas`），还需要：provisioning profile、MAS 分发证书、installer 证书等；这块我可以按你现有证书类型把 Jenkinsfile 扩展成和 `.github/workflows/desktop-build.yml` 同等能力的流水线。
