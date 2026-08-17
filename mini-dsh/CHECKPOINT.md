# ch07 — 会话日志即真相

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `validateEvent()` — `packages/session/src/invariant.ts`
  纯转移函数：算出下一个状态但不改传进来的。四条不变式见 7.5 节
- `deriveMessages()` — `packages/session/src/index.ts`
  先折出 surface，再把 surface 上的事件转成消息
- `surfaceOf()` — `packages/session/src/index.ts`
  只留 SURFACE_TYPES；遇到 surfaceOp:replace 就 splice 掉那一段
- `fork()` — `packages/session/src/index.ts`
  取前缀重放，但要先判断这个前缀合不合法

## 自检

```sh
node --test packages/session/tests/session.spec.ts
```

## 卡住了

```sh
git checkout ch07-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
