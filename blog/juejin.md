> 众所周知，Vue 3.6 计划引入一个全新的响应式机制：`alien-signals`，用来进一步优化 Vue 的响应式系统。
>
> 目前 vue3.6 还没正式发布，但可以先通过以下命令打包`alien-signals`源码：
>
> esbuild src/index.ts --bundle --format=esm --outfile=esm/index.mjs
>
> 打包后的代码还不到 500 行，体积小、结构也比较清晰。`趁现在还不那么复杂`，我正在尝试解析一下 `alien-signals` 的源码，顺便记录一些理解过程
