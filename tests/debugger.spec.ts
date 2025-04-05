import { expect, test } from 'vitest';
import { signal, computed, effect } from '../src';
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
	flag(false)
	x(11)
	flag(true)
});
