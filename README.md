# task-spider

一个 nodejs 分布式爬虫框架。

最近写了一些爬虫玩，总结了归纳了一下爬虫的核心逻辑。无非就是获取任务，爬数据，根据数据进行解析，然后决定是保存数据，添加新任务，还是干嘛。

但我对爬取失败是不能容忍的，我也希望我每一次爬取都有迹可寻，所以我用 mongoDB 来当我的任务列表，所有的爬虫都先领任务，再执行，再领。

## 特色

- 任务机制，每一条任务都有迹可循，直接存库，哪条是成功，是失败，是哪个节点爬的，一清二楚，后面可以方便重试。
- 自动耗时统计。
- 自动重试机制。
- 数据都存 mongoDB，可以分布式大量部署，任务带锁，失败可回退。
- 优雅退出机制
- 每一个任务可高度自定义处理逻辑，灵活度高
- 导出 prometheus 监控指标

## 工作原理

1. 从数据库中获取任务（根据初始化爬虫时选择的获取任务参数，比如用哪个 collection 当任务列表，获取哪些状态的任务），并指定这个任务是 processing 状态，防止被别人领到。
2. 开始执行任务，使用 `taskHandler`，这个函数有一些参数，可以获取到当前任务的信息，也可以获取到一些工具函数，比如 `request`，`save`，`follow` , `convert` 等。
3. 如果每一个原子任务成功了，那就设置任务的状态 `success`，如果失败了就是 `failed`，同时也会把失败原因存库。以后可以指定选择 `failed` 的任务重新运行这次爬虫。
4. 总共有一个最大并发控制，还有一些其他控制，当所有的任务都执行完了，程序就结束了。

## 安装
```bash
npm install task-spider
```

## 使用
```typescript
import { NodeSpider } from "task-spider";

const spider = new NodeSpider({
  taskDB: "testSpider",
  taskCollection: "tasks",
  saveCollection: "result",
  mongoUrl: "mongodb://localhost:27017",
  nodeName: "testNode",
  timeCost: true,
})

spider.taskHandler = async (ctx) => {
  const { url } = ctx.task;
  const res = await ctx.request({
    method: "GET",
    url,
    responseType: "arraybuffer"
  });
  // 需要的话可以转码
  const string = ctx.convert(res.data, "gbk")
  const html = ctx.cheerio.load(string)
  const title = html("title").text();
  const content = html(".content").text();
  // 保存结果
  await ctx.save({
    result: {
      title,
      content,
    }
  })
  // 我也可以增加新任务
  await ctx.followTask({
    url: "https://www.biquge.co/0_410/9449247.html",
  })
  return {
    success: true
  }
}

const main = async () => {
  const success = await spider.addTask({
    url: "https://www.biquge.co/0_410/9449247.html",
  })
  if (success) {
    await spider.run();
  }

}

main();

```

## 初始化参数列表

```typescript
export interface InitNodeSpiderOptions {
  sleep?: number;
  maxConnection?: number;
  maxRetry?: number;
  maxTimeout?: number;
  taskDB: string;
  // 任务搜集的集合
  taskCollection: string;
  // 需要处理的任务状态
  getTaskStatus?: string;
  // 保存的任务集合
  saveCollection: string;
  debug?: boolean;
  logFilter?: string | null;
  mongoUrl?: string;
}
```