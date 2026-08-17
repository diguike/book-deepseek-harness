# ch09 — 主循环：turn 与 step

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `runTurn()` — `packages/agent-loop/src/index.ts`
  开 turn → 认领 inbox → pre-step 决策 → 跑 step → 关 turn。零 step 的 turn 是合法的
- `runStep()` — `packages/agent-loop/src/index.ts`
  落消息 → 装配请求 → 断言不变式 → 请求 → 工具 → 结束
- `assertRequestDerivesFromLog()` — `packages/agent-loop/src/index.ts`
  那条等式：请求里的消息必须逐字节等于从日志推导的结果

## 自检

```sh
node --test packages/agent-loop/tests/loop.spec.ts
```

## 卡住了

```sh
git checkout ch09-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
