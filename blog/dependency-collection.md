> 众所周知，Vue 3.6 计划引入一个全新的响应式机制：`alien-signals`，用来进一步优化 Vue 的响应式系统。
>
> 目前 vue3.6 还没正式发布，但可以先通过以下命令打包`alien-signals`源码：
>
> esbuild src/index.ts --bundle --format=esm --outfile=esm/index.mjs
>
> 打包后的代码还不到 500 行，体积小、结构也比较清晰。趁现在还不**那么**复杂，我正在尝试解析一下 `alien-signals` 的源码，顺便记录一些理解过程

首先我们先有一个 `2x2` 的单元测试，其中 fn1 和 fn2 分别有两个依赖 count1、count2

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

这是 signal 的源码(build 后)如下，重点关心这个 this，也就是 dep，后续我们用`蓝色表示dep`

```js
function signal(initialValue) {
  return signalGetterSetter.bind({
    currentValue: initialValue,
    subs: void 0,
    subsTail: void 0,
  });
}
```

这是 effect 的源码(build 后)如下，重点关心这个 e，也就是 sub，后续我们用`黄色表示sub`

```js
function effect(fn) {
  // sub
  const e = { fn, subs: void 0, subsTail: void 0, deps: void 0, depsTail: void 0, flags: 2 /* Effect */
  };
  ... 省略部分与当前单元测试无关的代码
  const prevSub = activeSub;
  activeSub = e;
  try {
    e.fn();
  } finally {
    activeSub = prevSub;
  }
  ...省略部分与当前单元测试无关的代码
}
```

在 effect 中会默认执行一次 fn 进行初始的依赖收集，当执行 fn1 时，我们可以得到这几个数据
![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/615274f606de42bf9b96d73499ac6a55~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743947922&x-orig-sign=sXN9P1MMPnZlQD%2ByMLVfF6dJvc4%3D)

在 fn1 中访问 count1()时就会`link(this, activeSub)`，将当前的依赖和订阅关联起来

```diff
function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
  if (activeSub !== undefined) {
+   关注这个link
    link(this, activeSub);
  }
  return this.currentValue;
}
```
link这个函数会复用节点，如果无法复用，说明这是一个新的link，当前是第一次执行依赖收集，当然是新的一个link，所以会执行linkNewDep(dep1,sub1,undefined,undefined)
```ts
function link(dep: Dependency, sub: Subscriber): Link | undefined {
  // 获取当前这个sub的最后一个依赖
  const currentDep = sub.depsTail; 
  ...
  // 获取currentDep的下一个依赖，如果depsTail不存在，就是当前这个sub的第一个依赖
  // 这段逻辑主要在依赖触发后重新依赖收集有关，暂时不会执行这个if里面的逻辑，主要用于复用节点
  const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    sub.depsTail = nextDep;
    return;
  }
  ...
  return linkNewDep(dep, sub, nextDep, currentDep);
}
```
linkNewDep会创建一个newLink节点，用于关联dep和sub
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
  // 没有depsTail，表示currentDep不存在，表示这是一个新的sub，那么sub1的deps就指向dep1
  if (depsTail === undefined) {
    sub.deps = newLink;
  } else {
    depsTail.nextDep = newLink;
  }
  // 如果当前的dep没有订阅，那么dep1的subs指向第一个订阅sub1
  if (dep.subs === undefined) {
    dep.subs = newLink;
  } else {
    const oldTail = dep.subsTail!;
    newLink.prevSub = oldTail;
    oldTail.nextSub = newLink;
  }
  // 更新尾部指针
  sub.depsTail = newLink;
  // 更新尾部指针
  dep.subsTail = newLink;
  return newLink;
}
```

第一次linkNewDep后的依赖收集如下

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/54a3510b7c2d466a83fc0e8954d08a8d~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743949749&x-orig-sign=u7paRrdCDW02gqrUm7RPr3CsAqE%3D)

开始收集count2了，又进行link和linkNewDep这两个函数，根据上一次的依赖关系图，可以知道
linkNewDep(dep2, sub1, undefined, dep1.depsTail)
```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
) {
  // 根据上述可知，depsTail -> dep1-> depsTail的newLink
  if (depsTail === undefined) {
    // 不会执行
    sub.deps = newLink;
  } else {
    // 这次执行这个
    depsTail.nextDep = newLink;
  }
  // 当前的dep2没有被订阅，那么dep2的subs指向第一个订阅sub1
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
  // 更新尾部指针
  dep.subsTail = newLink;
}
```
第二次linkNewDep后的依赖收集如下
![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/ccb263fffb7b488a8506fd04d63a478b~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743950437&x-orig-sign=AgJAY%2BBcnpR2foUJ9ThLcwSlG0M%3D)

第一个effect就依赖收集完成了，现在准备开始第二个effect的依赖收集，根据effect的源码，我们知道会创建一个sub2的订阅，现在的依赖关系图如下图所示，就单纯的多了个sub2

```ts
effect(function fn2() {
  console.log(`effect2-> count1 is: ${count1()}`);
  console.log(`effect2-> count2 is: ${count2()}`);
});
```
![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/794ecb9d90cb4234aa799c94d2d8836c~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743950552&x-orig-sign=rV8kA0x3ytlRVRKw5Jb3XKG5lhE%3D)

执行fn2，正式进行依赖收集

- 访问count1()，同样依次执行link和linkNewDep这两个函数，根据上一次的依赖关系图，可以知道
linkNewDep(dep1, sub2, undefined, undefined)
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
  // 当前的dep1已经被订阅,subs指向newLink-sub->sub1
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
  // 更新尾部指针
  dep.subsTail = newLink;
}
```
这次依赖收集后，最新的关系图如下：
![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/e6ad4c9ca0dd4ca4bb2a48ef30372269~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743951243&x-orig-sign=XiWkn6ZaNJMNQjTICWNszx4pc14%3D)

- 访问count2()，同样依次执行link和linkNewDep这两个函数，根据上一次的依赖关系图，可以知道
linkNewDep(dep2, sub2, undefined, dep1.depsTail)
```ts
function linkNewDep(
  dep: Dependency,
  sub: Subscriber,
  nextDep: Link | undefined,
  depsTail: Link | undefined
) {
  // 根据上述可知，depsTail -> dep1-> depsTail的newLink
  if (depsTail === undefined) {
    // 不会执行
    sub.deps = newLink;
  } else {
    // 这次执行这个
    depsTail.nextDep = newLink;
  }
  // 当前的已经被sub1订阅了
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
  // 更新尾部指针
  dep.subsTail = newLink;
}
```
至此所有的依赖收集都完成了。
![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/42ff94053e5a49048ba8fe6ad282407c~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAg5reL552AMTQx:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNDU3MDEzNjExNDY3NDE2In0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1743951848&x-orig-sign=MgUmgpYEBQNTFc9G4Wyg1eM0QIc%3D)