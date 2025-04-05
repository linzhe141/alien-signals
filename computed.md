# alien-signals computed 原理

### computed 的依赖收集

```ts
const count1 = signal(1);
const count2 = signal(222);

const double = computed(function getter() {
  console.log("computed~");
  return count1() * 2;
});

effect(function foo() {
  console.log("count2~", count2());
  console.log("double~", double());
});
```

大致流程如下：

- `computed` 的初始 `flags` 是 `SubscriberFlags.Computed | SubscriberFlags.Dirty`
- `effect` 的初始 `flags` 是 `SubscriberFlags.Effect`，并且默认会执行一次 `fn`（副作用函数），进行依赖收集
- 在收集到 `double` 时，由于该 `computed` 的 `flags` 是 `Computed | Dirty`，因此会触发计算 `processComputedUpdate`（懒计算，只有在读取时才会真正计算）并进行 `computed` 的依赖收集，同时在 `startTracking` 中取消 `Dirty` 标签：

```ts
if (flags & (SubscriberFlags.Dirty | SubscriberFlags.PendingComputed)) {
  processComputedUpdate(this, flags);
}
```

### computed 的依赖变化

```diff
+ compute依赖变化
console.log("change1~~~~~~~~");
count1(11);
```

大致流程如下：

- 首先获取到当前 `count1` 的 `subs` -> `newLink(sub->computed)`，发现只有一个订阅者
- 然后通过 `propagate(subs)` 传播依赖变化，第一次迭代时 `targetFlag` 默认为 `Dirty`：

  ```ts
  let targetFlag = SubscriberFlags.Dirty;
  ```

- 把当前的 `computed` 订阅打上 `Computed | Dirty | Notified` 的标记，默认认为 `computed` 是 Dirty 的
- 接着发现该 `computed` 也有对应的 `sub`，这个 `sub` 是一个 `Effect`，此时 `targetFlag` 被设置为 `PendingComputed`：

```ts
targetFlag =
  subFlags & SubscriberFlags.Effect
    ? SubscriberFlags.PendingEffect
    : SubscriberFlags.PendingComputed;
```

- 继续迭代这个 `Effect` 的 `sub`，其 `flags` 变成 `Effect | PendingComputed | Notified`，并被收集到 `notifyBuffer` 中
- 在 `processEffectNotifications` -> `notifyEffect` 阶段，进入`updateDirtyFlag`：

```ts
if (
  flags & SubscriberFlags.Dirty ||
  (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
) {
}
```

```diff
function updateDirtyFlag(sub: Subscriber, flags: SubscriberFlags): boolean {
+ 重点在这里：
+ 会再次遍历该副作用的依赖 deps，检查其中是否有 dirty 的项，如果有，就需要重新执行该副作用
  if (checkDirty(sub.deps!)) {
    sub.flags = flags | SubscriberFlags.Dirty;
    return true;
  } else {
    sub.flags = flags & ~SubscriberFlags.PendingComputed;
    return false;
  }
}
```

在 `checkDirty` 中遍历到 `computed` 时（此时 `flags -> Computed | Dirty`），会执行 `updateComputed(dep)`，并重新进行一次依赖收集，在`startTracking`中取消`Dirty`标签：

最终 `updateDirtyFlag` 会返回 `true` 或 `false`：

- 返回 `true` 表示需要重新执行 `effect` 副作用，并进行新一轮依赖收集
- 返回 `false` 表示该副作用不需要执行

---

```ts
if (
  flags & SubscriberFlags.Dirty ||
  // updateDirtyFlag 返回 true
  (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
) {
  const prevSub = activeSub;
  activeSub = e;
  startTracking(e);
  try {
    e.fn();
  } finally {
    activeSub = prevSub;
    endTracking(e);
  }
}
```

### 总结

这个 `computed` 的原理大致如下：

在触发 `computed` 的依赖更新时，会先将该 `computed` 打上 `Dirty` 标签，然后判断它是否在某个 `effect` 中被使用：

- 如果使用了，会将该 `effect` 标记为 `PendingComputed`（注意此时该 `effect` 并未打上 `Dirty` 标签）
- 同时，这个 `effect` 会被加入 `notifyBuffer`，等待进一步处理

在 `processEffectNotifications` 中处理 `effect` 时，虽然它还不是 `Dirty`，但由于有 `PendingComputed` 标签，会执行 `updateDirtyFlag -> checkDirty` 判断该副作用是否真的需要重新执行。

- 在 `checkDirty` 中检查该 `effect` 的所有依赖（如 `count2` 和 `double`），关键是 `double`
- 因为 `count1` 改变了，起初就把 `computed`（即 `double`）标记为了 Dirty，因此需要重新计算它（`updateComputed`），并进行一次新的依赖收集，执行后会取消 Dirty 标签
- 若 `computed` 的值发生变化，`checkDirty(sub.deps)` 返回 `true`，否则返回 `false`

```ts
function updateDirtyFlag(sub: Subscriber, flags: SubscriberFlags): boolean {
  if (checkDirty(sub.deps!)) {
    // 打上 Dirty 标签
    sub.flags = flags | SubscriberFlags.Dirty;
    return true;
  } else {
    // 取消 PendingComputed 标签
    sub.flags = flags & ~SubscriberFlags.PendingComputed;
    return false;
  }
}
```

如果 `checkDirty` 返回 `true`，会重新执行 `effect` 副作用并进行新一轮依赖收集，最后移除 `Dirty` 标签。

**这个很重要**，每一次执行 effect 和 computed 都会干掉`Dirty | PendingComputed | PendingEffect`这几个标签，表示处理过了

```diff
function startTracking(sub: Subscriber): void {
  sub.depsTail = undefined;
+ 重点在这里：Propagated = Dirty | PendingComputed | PendingEffect
+ 清除一些传播相关标志，设置为 Tracking 状态
  sub.flags =
    (sub.flags &
      ~(
        SubscriberFlags.Notified |
        SubscriberFlags.Recursed |
        SubscriberFlags.Propagated
      )) |
    SubscriberFlags.Tracking;
}
```
