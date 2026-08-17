# ch13 — 换一个 provider，搬走整个执行世界

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `run()` — `packages/shell/src/index.ts`
  按 spec 跑一条命令。两个 provider 各自实现，消费者不知道区别

## 自检

```sh
node --test packages/shell/tests/seam.spec.ts
```

## 卡住了

```sh
git checkout ch13-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
