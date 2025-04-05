### computed 依赖收集

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

大致流程：
computed 的初始`flags: SubscriberFlags.Computed | SubscriberFlags.Dirty`，
effect 的初始`flags: SubscriberFlags.Effect`，并且默认会执行 fn(副作用函数)，进行依赖收集。
当收集到 double 时，由于这个 computed 的 `flags: Computed | Dirty`，就会执行计算`processComputedUpdate`（懒计算，只有取值时才进行计算）进行 computed 的依赖收集，并且也会在 startTracking 这个函数取消 Dirty 这个标签

```ts
if (flags & (SubscriberFlags.Dirty | SubscriberFlags.PendingComputed)) {
  processComputedUpdate(this, flags);
}
```

### compute 依赖变化

```diff
+ compute依赖变化
console.log("change1~~~~~~~~");
count1(11);
console.log("change2~~~~~~~~");
count2(333);
```

大致流程：

首先获取到当前这个 count1 的 subs->`newLink(sub->computed)`，就这有这一个订阅

然后`propagate(subs)`收集对应的 effect，第一次迭代的时候 targetFlag 默认都是`Dirty`(`let targetFlag = SubscriberFlags.Dirty`)，把当前的 computed 订阅打上标记`flags = Computed | Dirty | Notified`，默认当前的 computed 是 Dirty 的

发现这个 computed 也有对应的 sub，并且这个 sub 是一个 Effect，那么 targetFlag 就是`PendingComputed`

```ts
targetFlag =
  subFlags & SubscriberFlags.Effect
    ? SubscriberFlags.PendingEffect
    : SubscriberFlags.PendingComputed;
```

继续迭代 sub(`Effect:flags->Effect | PendingComputed(targetFlag) | Notified`)，然后把这个 Effect 收集到 notifyBuffer 中

处理`processEffectNotifications`->`notifyEffect`，因为现在的 effect 的 flags 是`Effect | PendingComputed(targetFlag) | Notified`，就会走这个逻辑`updateDirtyFlag`

```ts
if (
  flags & SubscriberFlags.Dirty ||
  (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
) {
}
```

```diff
function updateDirtyFlag(sub: Subscriber, flags: SubscriberFlags): boolean {
+ 重点是这个,
+ 又是一个迭代，判断当前的deps是否是dirty的，如果是dirty就要重新执行该副作用
  if (checkDirty(sub.deps!)) {
    sub.flags = flags | SubscriberFlags.Dirty;
    return true;
  } else {
    sub.flags = flags & ~SubscriberFlags.PendingComputed;
    return false;
  }
}
```

在 checkDirty 中迭代到 computed：flags -> Computed | Dirty 这个依赖时，会执行`updateComputed(dep)`，并且重新进行依赖收集，判断 oldValue === newValue，并且会取消`Dirty`这个标签，
并且 updateDirtyFlag 返回 true，就会重新执行副作用，重新依赖收集

```ts
if (
  flags & SubscriberFlags.Dirty ||
  // updateDirtyFlag -> true
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

这个 computed 的原理大概时这样的，就是在触发 computed 的依赖更新时，默认把这个 computd 打上 Dirty 的标签，然后看这个 computd 是不是在 effect 中使用了，如果使用了，就把这个 effect 打上 PendingComputed 标签（注意在此时，这个 effect 并没有 Dirty 标签），但会把这个 effect 收集到 notifyBuffer 中，在 processEffectNotifications 处理收集到的 effect，由于当前的 effect 不是 Dirty，但是有个 PendingComputed 标签，就要`updateDirtyFlag->checkDirty`判断这个副作用是否真的需要重新执行，
在 checkDirty 中检查这个 effect 的 deps，及 count2 和 double，重点是这个 computed。又因为 count1 改变后，就一开始给这个 computed 就打上了 Dirty 的标签，我们需要重新计算`updateComputed`这个 computed, 进行新的一次依赖收集，并取消 Dirty 标签，因为计算后就是确定的了。

如果这个 computed 真的改变了，那么`checkDirty(sub.deps)->true`，否则`checkDirty(sub.deps)->false`

```ts
function updateDirtyFlag(sub: Subscriber, flags: SubscriberFlags): boolean {
  if (checkDirty(sub.deps!)) {
    // 打上Dirty标签
    sub.flags = flags | SubscriberFlags.Dirty;
    return true;
  } else {
    // 取消PendingComputed标签
    sub.flags = flags & ~SubscriberFlags.PendingComputed;
    return false;
  }
}
```

如果`updateDirtyFlag->checkDirty->true`，就会重新执行 effect 副作用，进行新的依赖收集，并取消 Dirty 标签

```diff
function startTracking(sub: Subscriber): void {
  sub.depsTail = undefined;
+ Propagated = Dirty | PendingComputed | PendingEffect
+ 重点是这个
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
