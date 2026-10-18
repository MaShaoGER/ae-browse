# 本地素材文件夹与面板布局

日期：2026-10-18，香港时间。版本仍为 0.2.0 开发版。

普通目录无需 pack.json：添加文件夹或输入路径后浏览 SVG、PNG、JPG/JPEG，支持子目录、文件名/路径搜索、缩略图与刷新。独立 folders.json 登记不改变原图形包登记。读取源文件只读；导入前核对内容，缓存采用内容指纹命名。移除目录登记不删除源文件或工程仍在引用的缓存。提供 assets/local 示例目录，已在本机实际面板登记。

界面沿用现有深色面板。列表与详情之间增加分隔线：拖动、方向键微调、双击/Home 恢复默认，记住比例。宽度不超过 550 时切换上下分区；两区分别滚动。新增输入路径入口，避免只能依赖原生目录选择器。

## SVG 实机边界

当前 AE 26.0x67 的 ImportOptions 对 SVG 的 COMP / FOOTAGE 均返回 false，默认 importFile 返回 null，打开活动临时合成后也未生成图层。首次探测的空返回错误与第二次无图层结果保留于 local-folder-probe-*。因此当前机器使用 CEP 的离线透明 PNG 兼容导入：四倍采样，最长边不超过 4096，AE 中还原原始显示尺寸，保留原 SVG。面板明确显示兼容图片导入结果。原生 SVG 合成分支保留但未验收，不能称任意 SVG 均可编辑。

当前支持静态自包含 SVG。脚本、外部资源、嵌入图片、DTD/实体等停用，内部渐变与路径可用。文字建议先转曲。PNG/JPG 按文件图片导入；文件素材不属于原生参数图形实例，不支持“更新所选图形”。

## 分层验证

| 验证层 | 本轮结果 | 范围 |
|---|---|---|
| Node 包、预检、模拟宿主、文件系统 | 189 通过，0 失败 | 默认 boundaries 103、本地目录 8、导入器 VM 6、构建 7、宿主分发 39、通信桥 20、实例编辑 6；不计作实机属性 |
| 实际 AE 属性 | 8 通过，0 失败 | SVG 兼容导入与尺寸、重复请求、PNG、缺失文件保护、原有图形创建/读取/更新 |
| 实际 CEP 文件夹与交互 | 通过 | 路径入口登记 assets/local、真实 Node 读取、缩略图、搜索清空、CEF 分隔线拖动 |
| 实际面板至 AE 完整链路 | 通过 | SVG → CEP canvas → Node 缓存 → JSX 导入；连续双击只创建一层，1280×800 图像以 25% 缩放还原 320×200 |
| 真实渲染与离线像素 | 1 张 AE PNG，7 项通过 | 透明背景、原始尺寸、实际 Alpha 范围 [336,236,624,404]；静态 SVG 不扩展为全动画认证 |
| 布局 | 浏览器三尺寸、真实 CEP 视口单独记录 | 780×640、560×420、300×420；检查横向溢出及底部按钮可达 |

测试先观察到目录服务缺失、导入器缺失、SVG 缓存缺失和兼容通道缺失，再实现复测。一次 VM 清理断言误把成功导入的既有素材项计作应删除项，改为确认只清理失败操作新增项。实机测试脚本曾因 native 是 ExtendScript 保留字而编译失败，修正测试变量后运行成功；产品宿主已在实际 CEP 加载执行。

## 清理、安装与限制

AE 属性测试删除临时合成及两份 PNG 项，完整 CEP 导入测试另删一个临时合成及一份 PNG 项；两次均扫描确认临时项不存在、项目恢复 0 项，未保存工程。撤销历史与 dirty 标记可能保留。

升级前逐文件备份旧扩展到 test-results/local-only/extension-backup-local-20261018-084712，校验后复制新构建。本机用户原图形包登记保留，新增普通目录登记。测试使用的 .debug 端口只用于本地 CEP 验证，收尾停用。

Windows 自动化仍拒绝将 CEP 子窗口作为主 AE 窗口的坐标输入目标，原生目录选择器与物理边框拖拽未完整验收。真实 CEP 的分隔线输入由 CEF 指针事件驱动，视口模拟不等于 Windows 外边框缩放或停靠验收。JPG 路径已实现，但本轮实机抽测使用 SVG 与 PNG；不外推大库或其他 AE 版本。

## 证据

- [AE 属性](../test-results/local-folder-final/ae-properties.json)、[清理扫描](../test-results/local-folder-final/cleanup.json)
- [真实 CEP 浏览](../test-results/local-folder-final/cep-ui.json)、[完整导入与清理](../test-results/local-folder-final/cep-import.json)
- [CEP 布局](../test-results/local-folder-final/cep-layout.json)、[像素](../test-results/local-folder-final/pixels.json)
- [实际面板](../test-results/local-folder-final/cep-local.png)、[窄面板](../test-results/local-folder-final/cep-300.png)、[AE 帧](../test-results/local-folder-final/ae-svg.png)
