# Development State

## Goal

按 `docs/CEP_IMPLEMENTATION_PATH.md` 推进 CEP + Node + JSX；本轮续测昨天新增的五种图形，并生成可运行开发构建。

## Verified current state

2026-10-16：本地 0.2.0 开发构建支持圆角矩形、圆形、椭圆、三角形、六边形、星形。223 项 Node 检查通过；AE 26.0x67 中 26 项实际属性用例通过；3 张真实帧和 9 项离线像素检查通过。临时合成已删除，扫描项目项恢复为 0，未保存工程。见 `docs/BASIC_SHAPES_TEST_REPORT.md`。

已安装的开发扩展仍是 2026-10-14 版本，本轮仅生成 `dist/AE Browse`，未覆盖安装目录或改用户库登记。旧版 CEP 加载与面板创建闭环记录仍见 `docs/CEP_LIVE_TEST_REPORT.md`，不能据此声称六图形版本已做真实面板点击验收。

## Decisions and reasons

- 扩展原生单形状层适配器到矩形、椭圆、多边形、星形；示例库提供六个预设。其他素材种类仍停用。
- 包文件只读，用户登记独立保存；同身份内容/版本冲突要求显式移除后添加。
- 执行前捕获/验证一致字节，发送所选素材片段；宿主不读取来源路径。
- 所有宿主请求串行；写入超时不重试，未确认结果保持锁。
- 当前用面板颜色控件和六种基础图形近似预览；大库先分批显示，虚拟滚动后续单独测量。
- 实机测试中避免无括号的嵌套三元表达式：本机 ExtendScript 将三角形预期边数错误算成 6，改为 if/else 后 26 项全通过。生产几何实现无需修复。

## Files changed

六图形源码在 `cep/`、`src/`、`examples/basic-shapes/`；Node 用例在 `tests/`。本轮补 `scripts/prepare-basic-shapes-test.cjs`、`scripts/check-basic-shapes-pixels.py`，修正 `tests/ae-basic-shapes.jsx` 的断言和失败清理，更新说明与报告。生成目录不要手工编辑。

## Tests and results

最终实机运行：`test-results/basic-shapes-1792127866624-56498e/`，含 `ae-properties.json`、`frames.json`、`pixels.json` 与三帧。前两轮 22/26 是测试预期错误的定位证据；旧中断轮次保留原记录。Node Mock、真实 AE 属性、渲染像素结果分开统计。

## Next action

下一轮可备份升级已安装开发扩展，登记 `examples/basic-shapes` 并做六图形真实面板点击验收；再推进停靠、重开恢复、快速重复点击、超时和大库专项验收。每次测试继续单独说明影响。

## Blockers or open questions

六图形核心创建和回读已验证，最新版本真实 CEP 面板交互尚未验收。AfterFX -r 启动方式曾出现关闭/脚本中断提示；取消关闭后，通过当前 ae-mcp 面板本地端点执行成功。后续端口从现场进程监听信息确认，不硬编码到正式应用。
