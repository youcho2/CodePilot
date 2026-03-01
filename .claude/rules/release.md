## Release

**发版流程：** 更新 package.json version → `npm install` 同步 lock → 提交推送 → `git tag v{版本号} && git push origin v{版本号}` → CI 自动构建发布。不要手动创建 GitHub Release。

**发版纪律：** 禁止自动发版。`git push` + `git tag` 必须等用户明确指示后才执行。commit 可以正常进行。

**Release Notes 格式：** 标题 `CodePilot v{版本号}`，正文包含：更新内容、Downloads、Installation、Requirements、Changelog。

## Build Notes

- macOS 产出 DMG（arm64 + x64），Windows 产出 NSIS 安装包或 zip
- `scripts/after-pack.js` 重编译 better-sqlite3 为 Electron ABI
- 构建前清理 `rm -rf release/ .next/`；构建 Windows 包后 `npm rebuild better-sqlite3` 恢复本地环境
