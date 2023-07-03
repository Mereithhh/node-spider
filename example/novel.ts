import { NodeSpider } from "../src";


const spider = new NodeSpider({
  taskDB: "testSpider",
  taskCollection: "tasks",
  saveCollection: "result",
  debug: true,
})

spider.taskHandler = async (ctx) => {
  const { url } = ctx.taskContext.task;
  const res = await ctx.request({
    method: "GET",
    url,
    responseType: "arraybuffer"
  });
  const string = ctx.convert(res.data, "gbk")
  const html = ctx.cheerio.load(string)
  const title = html("title").text();
  const content = html(".content").text();
  console.log(title, content)
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
