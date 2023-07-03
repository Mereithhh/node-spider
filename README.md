# node-spider

一个通用的 nodejs 爬虫框架。

（自娱自乐）

最近写了一些爬虫玩，总结了归纳了一下爬虫的核心逻辑。无非就是获取任务，爬数据，根据数据进行解析，然后决定是保存数据，添加新任务，还是干嘛。

但我对爬取失败是不能容忍的，我也希望我每一次爬取都有迹可凶，所以我用 mongoDB 来当我的任务列表。

## 安装
```bash
npm install node-spider
```

## 使用
```typescript
import { NodeSpider } from "../src";

const spider = new NodeSpider({
  taskDB: "testSpider",
  taskCollection: "tasks",
  saveCollection: "result",
  mongoUrl: "mongodb://localhost:27017",
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