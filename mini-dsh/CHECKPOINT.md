# ch10 — 三段瀑布、守卫与并发确定性

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `execute()` — `packages/tools/src/index.ts`
  pre-execute → 单调守卫 → execute(around) → 工具体 → post-execute
- `executionMode()` — `packages/tools/src/index.ts`
  fail-closed：只有精确返回 true 才算可并发
- `executeBatch()` — `packages/tools/src/index.ts`
  派发可以重叠，但结果必须按模型给的顺序落位

## 自检

```sh
node --test packages/tools/tests/pipeline.spec.ts
```

## 卡住了

```sh
git checkout ch10-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
