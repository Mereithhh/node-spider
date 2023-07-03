import { TaskSpider } from "../src";


const spider = new TaskSpider({
  taskDB: "testSpider",
  taskCollection: "tasks",
  saveCollection: "result",
  debug: true,
  appName: "task-spider",
  metrics: true,
  metricsPort: 9999,
})

spider.taskHandler = async (ctx) => {
  const { url } = ctx.taskContext.task;
  const res = await ctx.request({
    method: "GET",
    url,
    responseType: "arraybuffer"
  });
  const string = ctx.convert(res.data, "gbk")
  const html = ctx.parser.load(string)
  const title = html("title").text();
  const content = html(".content").text();
  console.log(title, content)
  await ctx.save({
    result: {
      title,
      content
    }
  });
  const nextLink = html(".bottem2 a").eq(3).attr("href")!;
  await ctx.follow({
    url: nextLink
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
