# Development State

## Goal

按 `docs/CEP_IMPLEMENTATION_PATH.md` 推进 CEP + Node + JSX。第一轮实现阶段 0–2 的代码和可运行开发构建。

## Verified current state

2026-10-14：CEP 0.2.0 已构建并安装为开发扩展。已有 197 个 Node 用例/检查组通过；新增 16 个实际 AE 属性用例全通过。真实 CEP 加载、示例库登记、面板创建与回读闭环通过；内置 Node 17.7.2。3 个真实帧及变化 bbox 检查完成。所有临时合成已删除，最终扫描 0 项，无工程保存。调试配置原本已启用，本轮未修改。见 `docs/CEP_LIVE_TEST_REPORT.md`。

## Decisions and reasons

- 保持一个矩形卡片的既有执行范围；其他类型显示停用。
- 包文件只读，用户登记独立保存；同身份内容/版本冲突要求显式移除后添加。
- 执行前捕获/验证一致字节，发送所选素材片段；宿主不读取来源路径。
- 所有宿主请求串行；写入超时不重试，未确认结果保持锁。
- 当前用面板颜色控件和基础图形近似预览；大库先分批显示，虚拟滚动后续单独测量。

## Files changed

新增 `cep/` 界面、官方依赖、桥和库服务；`src/json-compat.jsxinc`、`src/host-dispatch.jsxinc`、`src/host-loader.jsx`；开发构建/安装/演示脚本；4 个 Node 检查文件；构建/安装文档。已有核心 adapter/plan/validator 的执行规则保持复用。生成目录不要手工编辑。

## Tests and results

见 `docs/CEP_BUILD_REPORT.md` 和 `test-results/{library-service,host-bridge,host-dispatch,cep-build}.json`。Node Mock 不等同实际 AE 属性结果；旧 roundtrip 报告不是本轮验收。

## Next action

推进阶段 3 预制预览与交互，并补齐停靠、重开恢复、快速重复点击、超时和大库专项验收；阶段 4 再做更新/事务导出。每次测试继续单独说明影响。

## Blockers or open questions

真实最小闭环已验证；更广的停靠/重开、交互与性能尚待专项检查。嵌入 CEP 子窗口自动点击不可靠，本轮由用户完成库选择/导入。原 MCP 端点在原进程退出后断开，维护的工具 API 可经新实例 MCP 端点继续使用；新端口需现场确认，不硬编码到正式应用。
