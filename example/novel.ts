import { TaskSpider } from "../src";


const spider = new TaskSpider({
  taskDB: "testSpider",
  taskCollection: "tasks",
  saveCollection: "result",
  debug: false,
  appName: "task-spider",
  metrics: true,
  metricsPort: 9999,
  maxCount: 10,
})

spider.taskHandler = async (ctx) => {
  const { save, follow, request, convert, parser, log } = ctx;
  const { task } = ctx.taskContext;
  const { url } = ctx.taskContext.task;
  const res = await request({
    method: "GET",
    url,
    responseType: "arraybuffer"
  });
  const string = convert(res.data, "gbk")
  const html = parser.load(string)
  const title = html("title").text();
  const content = html(".content").text();
  log(title, content)
  await save({
    result: {
      title,
      content
    }
  });
  const nextLink = html(".bottem2 a").eq(3).attr("href")!;
  await follow({
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
