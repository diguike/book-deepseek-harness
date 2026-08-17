# ch06 — 注册即可撤销

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `waterfall()` — `packages/cordis/src/events.ts`
  递归闭包：把「下一层」包成 next 传给监听器，它决定调不调。走到底执行 final
- `bail()` — `packages/cordis/src/events.ts`
  按顺序跑，第一个返回非 undefined 的就停下并把它作为结果
- `unload()` — `packages/cordis/src/fiber.ts`
  逆序执行所有 disposer。为什么逆序见第 6.4 节
- `effect()` — `packages/cordis/src/context.ts`
  跑 setup，把它交出的 disposer 登记到当前 fiber。UNLOADING 期间要拒绝

## 自检

```sh
node --test packages/cordis/tests/events.spec.ts
```

## 卡住了

```sh
git checkout ch06-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
