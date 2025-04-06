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
	const e = { fn, subs: void 0, subsTail: void 0, deps: void 0, depsTail: void 0, flags: 2 /* Effect */
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
	...
	// 获取 currentDep 的下一个依赖。如果 depsTail 不存在，就是当前 sub 的第一个依赖。
	// 这段逻辑主要与依赖触发后的重新依赖收集有关，暂时不会执行这个 if 里面的逻辑，主要用于复用节点。
	const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
	if (nextDep !== undefined && nextDep.dep === dep) {
		sub.depsTail = nextDep;
		return;
	}
	...
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