# 为什么先把遥测变可信，而不是先做用户分析

> 技术实现见 [docs/handover/sentry-error-reporting.md](../handover/sentry-error-reporting.md)。

用户最初看到的是“Sentry 报错很多”，但总量混合了开发环境、旧 release、衍生产品、用户配置错误和真实产品缺陷。此时增加更多采集只会让数字更大，不会让判断更准。

这轮选择先做 U0：只回答“当前官方 stable 版本是否健康”。同一次应用运行只保留 Electron main 的一个 session，因此 crash-free sessions 与版本采用趋势有了相对稳定的分母；但它不代表真实用户，更不代表活跃用户。CodePilot 是托盘常驻应用，启动、驻留和有意义使用天然不是一回事，所以产品文案必须明确“不追踪功能使用、不识别用户”。

另一个取舍是保留用户可见的真实错误，同时不把原始 provider body 送进 Sentry。用户排查模型/网关问题需要上游原因，遥测只需要 status class、protocol、provider class、runtime 和 call scene。两条数据路径因此被明确拆开，而不是为了隐私把 UI 也降级成“未知错误”。

Source Map 也遵循同样原则：能产生 map 不等于可交付。必须证明上传的是最终 packaged bundle、debug ID 对得上、安装包不携带源码，并记录真实构建代价。本轮 POC 已证明三层 map 和 0-map package 可实现，但 Next production 编译开销超过预设红线；在用户接受这个取舍或找到更轻方案前，不把它写成已经闭合。

未来若要看用户量或活跃度，应单独做 U1/U2：独立 consent、诚实的启动/行为口径、可验证的数据集和成本。不能把错误上报开关扩张成行为分析授权，也不能用 Sentry session 数冒充 DAU/MAU。
