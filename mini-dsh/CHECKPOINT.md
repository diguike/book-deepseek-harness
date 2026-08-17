# ch05 — 服务、注入与激活顺序

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `computeState()` — `packages/cordis/src/fiber.ts`
  三行判断，由 uid / error / epoch 推导出状态。顺序有讲究
- `refresh()` — `packages/cordis/src/fiber.ts`
  扫一遍 inject，把每个被注入服务的**提供者 uid** 串成 epoch；缺任何一个就是 INACTIVE
- `setEpoch()` — `packages/cordis/src/fiber.ts`
  epoch 没变就不动；INACTIVE→有值 = 加载，其余变化 = 卸载
- `provide()` — `packages/cordis/src/context.ts`
  存进注册表，然后把 disposer 交给当前 fiber 保管

## 自检

```sh
node --test packages/cordis/tests/fiber.spec.ts
```

## 卡住了

```sh
git checkout ch05-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
