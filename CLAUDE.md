# CLAUDE.md

## Project Overview

CodePilot — Claude Code 的原生桌面 GUI 客户端，基于 Electron + Next.js。

## Release Checklist

**发版前必须更新版本号：**

1. `package.json` 中的 `"version"` 字段
2. `package-lock.json` 中的对应版本（运行 `npm install` 会自动同步）
3. 构建命令：`npm run electron:pack:mac`（macOS）/ `npm run electron:pack:win`（Windows）
4. 上传产物到 GitHub Release 并编写 release notes

## Build Notes

- macOS 构建产出 DMG（arm64 + x64），Windows 产出 NSIS 安装包或 zip
- `scripts/after-pack.js` 会在打包时显式重编译 better-sqlite3 为 Electron ABI，确保原生模块兼容
- 构建前清理 `rm -rf release/ .next/` 可避免旧产物污染
- 构建 Windows 包后需要 `npm rebuild better-sqlite3` 恢复本地开发环境
- macOS 交叉编译 Windows 需要 Wine（Apple Silicon 上可能不可用），可用 zip 替代 NSIS
