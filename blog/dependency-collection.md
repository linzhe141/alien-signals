```ts
test("debugger 2*2", () => {
  const count1 = signal(1);
  const count2 = signal(100);
  effect(function fn1() {
    console.log(`effect1-> count1 is: ${count1()}`);
    console.log(`effect1-> count2 is: ${count2()}`);
  });
  effect(function fn2() {
    console.log(`effect2-> count1 is: ${count1()}`);
    console.log(`effect2-> count2 is: ${count2()}`);
  });
  count1(2);
  count2(200);
});
```

### 依赖收集

以下是 `signal` 的源码（build 后），我们重点关注 `this`，也就是 `dep`，后续我们用 **蓝色** 表示 `dep`。

```js
function signal(initialValue) {
  return signalGetterSetter.bind({
    currentValue: initialValue,
    subs: void 0,
    subsTail: void 0,
  });
}
```

接下来是 `effect` 的源码（build 后），这里我们重点关注 `e`，也就是 `sub`，后续我们用 **黄色** 表示 `sub`。

```js
function effect(fn) {
  // sub
  const e = {
    fn,
    subs: void 0,
    subsTail: void 0,
    deps: void 0,
    depsTail: void 0,
    flags: 2 /* Effect */,
  };
  // 省略部分与当前单元测试无关的代码
  const prevSub = activeSub;
  activeSub = e;
  try {
    e.fn();
  } finally {
    activeSub = prevSub;
  }
  // 省略部分与当前单元测试无关的代码
}
```

在 `effect` 中，`fn` 会被默认执行一次以进行初始的依赖收集。当执行 `fn1` 时，我们可以得到以下数据：

![Image](https://github.com/user-attachments/assets/b5d833df-02ba-4e2f-b4fa-05589db8f550)

在 `fn1` 中访问 `count1()` 时，会触发 `link(this, activeSub)`，将当前的依赖和订阅关联起来。

```diff
function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
  if (activeSub !== undefined) {
+   注意这里的 link
    link(this, activeSub);
  }
  return this.currentValue;
}
```

`link` 函数会尝试复用节点。如果无法复用，说明这是一个新的 `link`，因此会执行 `linkNewDep(dep1, sub1, undefined, undefined)`。

```ts
function link(dep: Dependency, sub: Subscriber): Link | undefined {
  // 获取当前 sub 的最后一个依赖
  const currentDep = sub.depsTail;
  // ...
  // 获取 currentDep 的下一个依赖。如果 depsTail 不存在，就是当前 sub 的第一个依赖。
  // 这段逻辑主要与依赖触发后的重新依赖收集有关，暂时不会执行这个 if 里面的逻辑，主要用于复用节点。
  const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    sub.depsTail = nextDep;
    return;
  }
  // ...
  return linkNewDep(dep, sub, nextDep, currentDep);
}
```

`linkNewDep` 会创建一个 `newLink` 节点，用于关联 `dep` 和 `sub`。

```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
): Link {
  const newLink: Link = {
    dep,
    sub,
    nextDep,
    prevSub: undefined,
    nextSub: undefined,
  };
  // 如果 depsTail 不存在，表示 currentDep 不存在，这是一个新的 sub。
  if (depsTail === undefined) {
    sub.deps = newLink;
  } else {
    depsTail.nextDep = newLink;
  }
  // 如果当前 dep 没有订阅，那么 dep1 的 subs 指向第一个订阅 sub1。
  if (dep.subs === undefined) {
    dep.subs = newLink;
  } else {
    const oldTail = dep.subsTail!;
    newLink.prevSub = oldTail;
    oldTail.nextSub = newLink;
  }
  // 更新尾部指针
  sub.depsTail = newLink;
  dep.subsTail = newLink;
  return newLink;
}
```

第一次 `linkNewDep` 后的依赖收集结果如下：

![Image](https://github.com/user-attachments/assets/8d2a02fc-c787-47e6-9d12-e84349bdc553)

接下来开始收集 `count2` 的依赖，同样会调用 `link` 和 `linkNewDep` 函数。根据上一次的依赖关系图，可以推导出：

`linkNewDep(dep2, sub1, undefined, dep1.depsTail)`

```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
) {
  // 根据上述可知，depsTail -> dep1 -> depsTail 的 newLink
  if (depsTail === undefined) {
    // 不会执行
    sub.deps = newLink;
  } else {
    // 这次执行这个
    depsTail.nextDep = newLink;
  }
  // 当前的 dep2 没有被订阅，那么 dep2 的 subs 指向第一个订阅 sub1。
  if (dep.subs === undefined) {
    dep.subs = newLink;
  } else {
    // 不会执行
    const oldTail = dep.subsTail!;
    newLink.prevSub = oldTail;
    oldTail.nextSub = newLink;
  }
  // 更新尾部指针
  sub.depsTail = newLink;
  dep.subsTail = newLink;
}
```

第二次 `linkNewDep` 后的依赖收集结果如下：

![Image](https://github.com/user-attachments/assets/4624f566-15f3-43d1-a1ed-c3c4cc22c5fd)

至此，第一个 `effect` 的依赖收集完成。接下来开始第二个 `effect` 的依赖收集。根据 `effect` 的源码，我们知道会创建一个新的订阅 `sub2`，此时的依赖关系图如下：

```ts
effect(function fn2() {
  console.log(`effect2-> count1 is: ${count1()}`);
  console.log(`effect2-> count2 is: ${count2()}`);
});
```

![Image](https://github.com/user-attachments/assets/b4fc99f9-2f6e-4275-8f58-7f67d8164d86)

执行 `fn2`，正式开始依赖收集：

- 访问 `count1()` 时，同样会依次执行 `link` 和 `linkNewDep` 函数。根据上一次的依赖关系图，可以推导出：

`linkNewDep(dep1, sub2, undefined, undefined)`

```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
) {
  // 根据上述可知，depsTail -> undefined
  if (depsTail === undefined) {
    // 这次执行这个
    sub.deps = newLink;
  } else {
    // 不会执行这个
    depsTail.nextDep = newLink;
  }
  // 当前的 dep1 已经被订阅，subs 指向 newLink-sub->sub1。
  if (dep.subs === undefined) {
    dep.subs = newLink;
  } else {
    // 执行这个
    const oldTail = dep.subsTail!;
    newLink.prevSub = oldTail;
    oldTail.nextSub = newLink;
  }
  // 更新尾部指针
  sub.depsTail = newLink;
  dep.subsTail = newLink;
}
```

此时的依赖关系图更新为：

![Image](https://github.com/user-attachments/assets/b7d88c44-412d-4011-97d5-116f9c2e8879)

- 访问 `count2()` 时，同样会依次执行 `link` 和 `linkNewDep` 函数。根据上一次的依赖关系图，可以推导出：

`linkNewDep(dep2, sub2, undefined, dep1.depsTail)`

```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
) {
  // 根据上述可知，depsTail -> dep1 -> depsTail 的 newLink
  if (depsTail === undefined) {
    // 不会执行
    sub.deps = newLink;
  } else {
    // 这次执行这个
    depsTail.nextDep = newLink;
  }
  // 当前的 dep2 已经被 sub1 订阅了
  if (dep.subs === undefined) {
    // 不会执行
    dep.subs = newLink;
  } else {
    // 这次执行这个
    const oldTail = dep.subsTail!;
    newLink.prevSub = oldTail;
    oldTail.nextSub = newLink;
  }
  // 更新尾部指针
  sub.depsTail = newLink;
  dep.subsTail = newLink;
}
```

至此，所有的依赖收集完成，最终的依赖关系图如下：

![Image](https://github.com/user-attachments/assets/1506876a-c6a5-4102-9a93-23bcd0eabe12)

### 依赖变化触发更新

```ts
count1(2);
```

当依赖的值发生变化后，首先会获取当前依赖的第一个订阅`this.subs`，根据关系图可知，也就是这个`红色箭头执行`的 newLink

```js
function signalGetterSetter(...value) {
  if (value.length) {
    if (this.currentValue !== (this.currentValue = value[0])) {
      const subs = this.subs;
      if (subs !== void 0) {
        propagate(subs);
        // ...
        processEffectNotifications();
      }
    }
  }
  // ...
}
```

![Image](https://github.com/user-attachments/assets/63500041-99ac-4ca1-ac0c-44b95a0b5325)

接着在`propagate(subs)`函数中遍历这个 dep1 依赖所有的 sub

```ts
//! 删除了部分无关代码
function propagate(current: Link): void {
  let next = current.nextSub;
  let targetFlag = SubscriberFlags.Dirty;
  // ...
  top: do {
    const sub = current.sub;
    const subFlags = sub.flags; // Effect

    let shouldNotify = false;

    if (
      !(
        subFlags &
        (SubscriberFlags.Tracking |
          SubscriberFlags.Recursed |
          // Dirty | PendingComputed | PendingEffect
          SubscriberFlags.Propagated)
      )
    ) {
      // Effect | Dirty | Notified
      sub.flags = subFlags | targetFlag | SubscriberFlags.Notified;
      shouldNotify = true;
    }
    // ...
    if (shouldNotify) {
      const subSubs = (sub as Dependency).subs;
      if (subSubs !== undefined) {
        // ... 嵌套的effect，当前的单元测试不会执行到这里
      }
      if (subFlags & SubscriberFlags.Effect) {
        notifyBuffer[notifyBufferLength++] = sub;
      }
    }
    // ...

    if ((current = next!) !== undefined) {
      next = current.nextSub;
      // 现在这个单元测试没有 branchDepth
      targetFlag = branchDepth
        ? SubscriberFlags.PendingComputed
        : SubscriberFlags.Dirty;
      continue;
    }
    // ...
    break;
  } while (true);
}
```

第一次 do while ：sub1 后如下，并且`targetFlag = SubscriberFlags.Dirty`
![Image](https://github.com/user-attachments/assets/d3731b00-4a14-4984-9339-3acac977f7c3)
第二次 do while ：sub2 后如下

![Image](https://github.com/user-attachments/assets/7f289ca8-e24e-4f04-80a1-fb259ac313bf)

现在我们就收集到了 dep1 的两个订阅，既`notifyBuffer->[sub1,sub2]`，然后通过这个函数`processEffectNotifications和notifyEffect`开始处理`notifyBuffer`中的订阅

```ts
function processEffectNotifications(): void {
  while (notifyIndex < notifyBufferLength) {
    const effect = notifyBuffer[notifyIndex]!;
    notifyBuffer[notifyIndex++] = undefined;
    if (!notifyEffect(effect)) {
      effect.flags &= ~SubscriberFlags.Notified;
    }
  }
  notifyIndex = 0;
  notifyBufferLength = 0;
}
function notifyEffect(e: Effect): boolean {
  const flags = e.flags;
  if (
    flags & SubscriberFlags.Dirty ||
    // 如果是computed在effect使用就会走这个分支，当前不会
    (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
  ) {
    const prevSub = activeSub;
    activeSub = e;
    startTracking(e);
    try {
      // 执行副作用函数，并重新依赖收集
      e.fn();
    } finally {
      activeSub = prevSub;
      endTracking(e);
    }
  }
  // ...
  return true;
}
```

在执行副作用函数之前，会执行`startTracking`函数，将该 sub 的 depsTail 置为 undefined，表示需要重新依赖收集，并且取消`Notified 和Dirty`这两个标签，新增一个`Tracking`标签

```ts
function startTracking(sub: Subscriber): void {
  sub.depsTail = undefined;
  sub.flags =
    (sub.flags &
      ~(
        SubscriberFlags.Notified |
        SubscriberFlags.Recursed |
        //  Dirty | PendingComputed | PendingEffect
        SubscriberFlags.Propagated
      )) |
    SubscriberFlags.Tracking;
}
```

![Image](https://github.com/user-attachments/assets/41f1d2b3-bb43-4c78-913d-5a0bfa0fe9ea)

现在`e.fn()`重新执行`fn1`

```ts
function fn1() {
  console.log(`effect1-> count1 is: ${count1()}`);
  console.log(`effect1-> count2 is: ${count2()}`);
}
```

当执行到`count1()`，重新 link(dep1,sub1)

```ts
function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
  if (value.length) {
    // ...
  } else {
    if (activeSub !== undefined) {
      link(this, activeSub);
    }
    return this.currentValue;
  }
}

function link(dep: Dependency, sub: Subscriber): Link | undefined {
  // sub.depsTail -> undefined
  const currentDep = sub.depsTail;
  // ...
  // nextDep -> sub.deps -> dep1
  const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    // sub.depsTail -> dep1
    sub.depsTail = nextDep;
    return;
  }
  // ...
  // 复用以前的节点，不会执行这个
  return linkNewDep(dep, sub, nextDep, currentDep);
}
```

link 后如下所示

![Image](https://github.com/user-attachments/assets/c6539a38-0b63-4120-b707-37dc1c85302f)

然后`count2()`进行依赖收集`link(dep2,sub1)`，link 后如图所示

![Image](https://github.com/user-attachments/assets/08adb968-8142-4dbf-a41f-95edf828b4e2)
然后这个 fn1 就执行完了，并且也重新完成了新的依赖收集，然后使用`endTracking(sub1)`做清理，取消`Tracking`标签

```ts
function endTracking(sub: Subscriber): void {
  // ...
  // 取消 Tracking 标签
  sub.flags &= ~SubscriberFlags.Tracking;
}
```

![Image](https://github.com/user-attachments/assets/e5fd4de1-8307-41a8-ba75-156bfab38547)

接下来处理 notifyBuffer 的的 sub2，同样也会在执行副作用函数之前，会执行`startTracking`函数，将该 sub2 的 depsTail 置为 undefined，表示需要重新依赖收集，并且取消`Notified 和Dirty`这两个标签，新增一个`Tracking`标签

![Image](https://github.com/user-attachments/assets/36adfc53-a426-478c-a468-b4de109f3883)
然后重新执行`fn2`，重新进行依赖收集，先收集`count1()`，既`link(dep1,sub2)`

```ts
function link(dep: Dependency, sub: Subscriber): Link | undefined {
  //sub2.depsTail -> undefined
  const currentDep = sub.depsTail;
  // ...
  // nextDep -> sub2.deps -> dep1
  const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    // sub.depsTail -> dep1
    sub.depsTail = nextDep;
    return;
  }
  // ...
  // 复用以前的节点，不会执行这个
  return linkNewDep(dep, sub, nextDep, currentDep);
}
```

link 后如图所示：
![Image](https://github.com/user-attachments/assets/8c3c1da2-9c37-42d6-b6c8-025074f918a0)

然后收集`count2()`，既`link(dep2,sub2)`，link 后如图所示：

![Image](https://github.com/user-attachments/assets/0b75d7d5-a01a-4f55-a569-6b3f72beb534)
现在这个 fn12 也执行完了，并且也重新完成了新的依赖收集，同样也需要使用`endTracking(sub2)`做清理，取消`Tracking`标签。如图所示：

![Image](https://github.com/user-attachments/assets/695beeb3-d1ee-4654-a6ab-3eeb2e782ace)

到现在`count1(2)`就正在的完成了。

后面的`count2(200)`，其实也是`count1(2)`，一模一样的流程
