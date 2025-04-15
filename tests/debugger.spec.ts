import { expect, test } from 'vitest';
import { signal, computed, effect, startBatch, endBatch } from '../src';
test('debugger 2*2', () => {
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

test('debugger 3*3', () => {
	const count1 = signal(1);
	const count2 = signal(100);
	const count3 = signal(1000);
	effect(function fn1() {
		console.log(`effect1-> count1 is: ${count1()}`);
		console.log(`effect1-> count2 is: ${count2()}`);
		console.log(`effect1-> count3 is: ${count3()}`);
	});
	effect(function fn2() {
		console.log(`effect2-> count1 is: ${count1()}`);
		console.log(`effect2-> count2 is: ${count2()}`);
		console.log(`effect2-> count3 is: ${count3()}`);
	});
	effect(function fn3() {
		console.log(`effect3-> count1 is: ${count1()}`);
		console.log(`effect3-> count2 is: ${count2()}`);
		console.log(`effect3-> count3 is: ${count3()}`);
	});
	count1(2);
	count2(200);
	count3(2000);
});

test('computed', () => {
	const count1 = signal(1);
	const count2 = signal(222);
	const double = computed(function getter() {
		console.log('computed~');
		return count1() * 0;
	});
	effect(function foo() {
		console.log('count2~', count2());
		console.log('double~', double());
	});
	console.log('change1~~~~~~~~');
	count1(11);
	console.log('change2~~~~~~~~');
	count2(333);
});

test('cleanUp', () => {
	const flag = signal(true);
	const x = signal(1);
	const y = signal(2);
	effect(function foo() {
		console.log('bar~', flag() ? x() : y());
	});
	flag(false);
	x(11);
	flag(true);
});

test('nested effect', () => {
	const x = signal(1);
	const y = signal(2);
	effect(function foo() {
		console.log('foo~', y());
		effect(function bar() {
			console.log('bar~', x());
		});
	});
	// 使用新的newLink关联 effect bar 和 effect foo
	// 又会使用新的 newLink关联 effect bar 和 signals x
	// 感觉还有性能提升？
	y(20); // 依次打印 foo~ 20 bar~ 1

	// 很像computed 的流程 换成了PendingEffect
	x(10);
	console.log('change~');
	y(30); // deubgger Effect | Notified 
});

test('nested effect + cleanUp', () => {
	const flag = signal(true);
	const x = signal(1);
	effect(function foo() {
		flag() && effect(function bar() {
			console.log('bar~', x());
		});
	});
	x(10);
	flag(false);
	x(100);
	flag(true);
});


// 对比
test.todo('batch', () => {
	const a = signal(0);
	const b = signal(0);
	const order: string[] = [];


	effect(() => {
		order.push('first inner');
		a();
	});

	effect(() => {
		order.push('last inner');
		a();
		b();
	});

	order.length = 0;

	startBatch();
	b(1);
	a(1);
	endBatch();

	expect(order).toEqual(['last inner', 'first inner']);
});
// 就是在startBatch后统一收集了所有的effect，endBatch后统一执行了所有的effect
test('batch w/ nested effect', () => {
	const a = signal(0);
	const b = signal(0);
	const order: string[] = [];

	effect(/* 父组件 */() => {
		console.log('parent effect');
		effect(/* 组件1 */() => {
			order.push('first inner');
			console.log('组件1 effect');
			a();
		});

		effect(/* 组件2 */() => {
			order.push('last inner');
			console.log('组件2 effect');
			a();
			b();
		});
	});

	order.length = 0;

	console.log('batch change~');
	startBatch();
	b(1);
	a(1);
	endBatch();

	expect(order).toEqual(['first inner', 'last inner']);
});
// branchs+branchDepth 没啥必要看，就是把dfs递归改成了循环，说实话这也不是很好理解
// 图着色算法算法
test('propagate->branchs+branchDepth', () => {
	const a = signal(false);
	const b = computed(/* getter b */() => a());
	const c = computed(/* getter c */() => {
		b();
		return 0;
	});
	const d = computed(/* getter d */() => {
		c();
		return b();
	});

	expect(d()).toBe(false);
	a(true);
	expect(d()).toBe(true);
});