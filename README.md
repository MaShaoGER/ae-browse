# AE Browse

用于 Adobe After Effects 的图形库浏览器。把图形整理成可复制的文件夹，在 CEP 面板中浏览、搜索和调整参数，再添加到当前合成。

当前版本 **0.2.0，开发版**。已验证的导入范围是**一个形状层、一个矩形与填充组成的圆角卡片**；其他图形和素材类型仍在后续计划中。

![AE Browse 开发面板](test-results/cep-ui-demo.jpg)

## 项目路径

- 本机源码：`D:\project\ae-browse`
- GitHub 仓库：[MaShaoGER/ae-browse](https://github.com/MaShaoGER/ae-browse)
- 开发构建输出：`dist/AE Browse/`
- AE 开发扩展安装位置：`%APPDATA%\Adobe\CEP\extensions\local.aebrowse`
- 用户图形库登记：`%APPDATA%\AE Browse\libraries.json`

本机源码路径是当前工作目录，克隆到其他目录也可以构建和运行面板。部分实机测试辅助脚本仍使用这台机器的绝对路径，迁移后需要单独调整。

## 当前功能

- **图形库登记与恢复**：添加包含 `pack.json` 的文件夹；源文件只读，移除登记不会删除源图形库。
- **搜索与诊断**：按名称和标签搜索，显示中文提示、素材错误和依赖检查结果；损坏素材单独停用。
- **卡片参数**：调整宽度、高度、圆角、颜色、入场动画和时长，支持 `pop`、`slide`、`fade`、`none`。
- **面板预览**：基础卡片的近似外观预览，颜色使用面板选色器和预览色块。
- **导入与回读**：检查目标合成、素材内容指纹和参数，创建后读取实际图层属性。
- **执行保护**：宿主请求串行处理；创建请求超时后保留待确认状态，不自动重复创建。

当前以文件复制传播图形库，不需要在线素材服务。相同包身份的内容或版本冲突需要明确移除旧登记后再添加。

## 环境

| 用途 | 环境与范围 |
| --- | --- |
| 开发、构建与 Node 测试 | 已记录验证环境为 Node.js 24.18.0；源码不需要安装 npm 第三方依赖 |
| CEP 面板 | Windows、After Effects 26.x、CEP 12；manifest 限定 AE 26.x |
| 既有实机记录 | AE 26.0x67、CEP 12.0.1、CEP 内置 Node 17.7.2 |

构建使用仓库内固定版本的 Adobe `CSInterface.js`。面板运行使用 CEP 内置 Node，不依赖系统 Node 或 AE MCP。当前提供未签名的开发扩展，尚无正式 ZXP 安装包。

## 快速开始

### 1. 获取源码并构建

```powershell
git clone https://github.com/MaShaoGER/ae-browse.git
cd ae-browse
npm run build
```

已有本机项目时，进入 `D:\project\ae-browse` 后直接构建。输出到 `dist/AE Browse/`；每次构建会重建这个生成目录，请在 `cep/` 和 `src/` 中修改源码。

### 2. 在浏览器预览界面

```powershell
npm run preview
```

打开 <http://127.0.0.1:4311/?demo=1>。这是界面演示，不连接 AE，导入按钮关闭。结束时按 Ctrl+C。

### 3. 安装 AE 开发扩展

在项目根目录运行：

```powershell
.\scripts\install-dev.ps1
```

脚本将构建产物复制到上面的 AE 扩展安装位置。目标已存在时会停止，不覆盖旧扩展；升级时先备份旧目录并选择替换方式。

未签名扩展需要 CEP 的开发调试设置。确认使用 CEP 12 且需要启用时，可在首次安装时改用：

```powershell
.\scripts\install-dev.ps1 -EnableDebug
```

此开关会将 `HKCU\Software\Adobe\CSXS.12\PlayerDebugMode` 设置为字符串 `1`。安装完成后重新打开 AE，从“窗口 → 扩展”菜单打开 **AE Browse**。详见 [开发安装说明](docs/CEP_DEV_SETUP.md)。

### 4. 添加示例图形库

1. 在面板添加 `examples/portable-demo/` 文件夹；本机完整路径为 `D:\project\ae-browse\examples\portable-demo`。
2. 在 AE 打开目标合成，在面板点击“刷新合成”。
3. 选择圆角卡片，调整尺寸、颜色和动画参数。
4. 点击“添加到当前合成”，查看创建与回读结果。

没有活动合成时仍可浏览图形库。面板预览不包含真实效果栈与动画渲染，实际外观以 AE 为准。

## 项目结构

```text
ae-browse/
├─ cep/                  CEP 面板、宿主通信桥、Node 图形库服务与 Adobe 依赖
├─ src/                  图形包校验器、ES3 计划编译器与 AE 执行层
├─ examples/portable-demo/ 可复制的示例图形包：pack.json + assets/
├─ scripts/              构建、开发安装、界面演示与实机测试辅助脚本
├─ tests/                Node 检查与单独调用的 AE 宿主测试
├─ docs/                 协议、实现路径、安装说明与分层验证报告
├─ test-results/         保留的报告、截图与帧证据；临时配置和样例不上传
├─ dist/                 本地生成的扩展，不纳入版本管理
└─ DEV_STATE.md          开发状态与下一步工作
```

执行流程：**CEP 面板 → Node 读取并校验素材快照 → JSON 宿主通信 → JSX 创建 → 实际属性回读**。宿主执行层不直接读取来源图形包路径。

## 验证

运行测试前，先单独说明测试范围与影响。以下命令**仅在 Node 中运行**，会生成本地测试报告与临时样例，不启动 AE，也不修改 AE 工程。CEP 包结构检查需要先构建。

```powershell
npm run build
npm test
npm run test:plan
npm run test:cep
npm run validate
```

`npm test` 只运行包边界测试；完整的 Node 检查还包括 `test:plan` 与 `test:cep`。`validate` 检查示例图形包，离线时宿主执行能力显示为待检查。

| 验证层 | 已有记录 | 证据 |
| --- | --- | --- |
| Node 包、预检、计划与模拟宿主 | 2026-10-15：重新运行，197 个用例/检查组通过，0 失败 | [包预检](test-results/boundaries.json)、[CEP 包结构](test-results/cep-build.json)、[分组说明](docs/CEP_BUILD_REPORT.md) |
| 真实 AE 属性与 CEP 最小闭环 | 2026-10-14：16 项属性检查通过，面板加载、登记、创建与回读通过 | [实机报告](docs/CEP_LIVE_TEST_REPORT.md) |
| 真实渲染 | 2026-10-14：3 个采样帧及变化范围检查；此前另有导出重建往返记录 | [实机报告](docs/CEP_LIVE_TEST_REPORT.md)、[往返报告](docs/ROUNDTRIP_TEST_REPORT.md) |

本次仓库整理只重新运行 Node 检查与示例包校验，未重新执行 AE 属性或渲染检查。这些是不同层面的证据，Node 模拟不代表真实 AE 属性或像素结果。AE 宿主测试需要单独启动：使用明确标识的临时合成，结束后扫描确认清理，不保存或覆盖用户工程；不会随普通 Node 测试自动运行。

## 后续计划与限制

- 补齐停靠、关闭重开、重复点击、超时交互与大库性能专项验收；当前按批显示，每批最多 100 项。
- 推进预制预览与动画、收藏、AE 原生选色。
- 将已有底层往返验证继续接入面板的实例更新与事务导出。
- 扩展更多图形与素材类型，制作签名 ZXP 并验证升级流程。

这些能力尚未完成面板交付或专项验收；当前开发版不代表任意图形、预合成或第三方效果均已适配。

## 相关文档

- [图形包接口](docs/PACK_INTERFACE.md)
- [CEP 实现路径](docs/CEP_IMPLEMENTATION_PATH.md)
- [开发构建与安装](docs/CEP_DEV_SETUP.md)
- [边界测试报告](docs/BOUNDARY_REPORT.md)
- [当前开发状态](DEV_STATE.md)

## 许可证

本项目暂未声明开源许可证。仓库内的 Adobe `CSInterface.js` 及其许可证单独说明于 [cep/vendor/README.md](cep/vendor/README.md)。
